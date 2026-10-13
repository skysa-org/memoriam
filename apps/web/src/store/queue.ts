import { ancestorPaths, foldName, isWithin, parentPath, pathSegments } from '@memoriam/core';
import Dexie, { type PromiseExtended } from 'dexie';

import {
	type FileRecord,
	type MemoriamDatabase,
	type NoteRecord,
	type OpQueueRecord,
} from './db.js';

/**
 * The push queue: what the sync engine owes the remote, in the order it has to
 * happen. Ported from skysa-notes' `store/queue.ts`, whose rules these are.
 * Every writer in `store/` that changes a passage or a collection calls one of
 * these in the same transaction as the change itself, so a change and the op
 * that carries it land together or not at all. Pulls never do: what a pull
 * writes came from the remote.
 *
 * **Nothing is queued while the library is bound to no connection** (§10, "The
 * web store"). There is nowhere to send it, and binding queues the whole
 * library afresh (`queueByNotebook`), so an op kept from before would only be
 * sent twice. Every helper here asks through `add`, inside the writer's
 * transaction, which binding locks too.
 *
 * The engine reads the queue once, asks for each op again just before sending
 * it — so one withdrawn here in the meantime is never sent — and holds it while
 * it is at the network, and the user can go on meanwhile. So what is queued is
 * kept to what the engine needs, and every rule below has to hold even for an
 * op that is already on its way:
 *
 * - **A write carries no content.** The engine reads the passage when it runs
 *   the op, so one queued write covers every edit and every pass made before it
 *   runs, and one made while its write is in flight is left dirty by the store
 *   and owed a fresh write (`settle` in `sync/store.ts`).
 * - **A move says where the passage is going, so a second rename replaces
 *   it.** Two moves queued for one passage would move the file to the first
 *   name and back again.
 * - **A passage never sent is not moved.** There is nothing at the old path;
 *   its write creates the file wherever the passage is by then.
 * - **A delete withdraws the passage's writes and keeps its moves, and a
 *   deleted passage is still moved.** A tombstone owes the remote its delete
 *   and nothing else. The moves stay because the file is still at the name it
 *   had, and a tombstone carried along by a collection's rename can be
 *   restored, when its write needs the file where the passage is.
 *
 * A collection's rename or delete goes up as the passages inside it moving or
 * being deleted one by one — the engine has no op that moves a whole folder —
 * and an `rmdir` queued behind them removes the directory they left.
 */

type QueueDb = Pick<MemoriamDatabase, 'opQueue' | 'syncState'>;

/**
 * Failures in a row before an op is left alone and the sync says `blocked`.
 * Enough that an outage has to outlast the scheduler's backoff on its climb to
 * its cap before an op is given up on.
 */
export const MAX_OP_ATTEMPTS = 8;

/**
 * Whether an op has been given up on for now, and is holding up everything
 * queued behind it: the engine stops a batch at `attempts >= maxAttempts`.
 * Never an `rmdir`, which the engine completes and steps over instead.
 */
export const outOfAttempts = (
	op: Pick<OpQueueRecord, 'op' | 'attempts'>,
	maxAttempts: number = MAX_OP_ATTEMPTS
): boolean => op.op !== 'rmdir' && op.attempts >= maxAttempts;

// Every helper here returns the promise Dexie made rather than being an `async`
// function. They run inside the writers' transactions, and Dexie follows its
// own promises through a transaction reliably but native ones only for a
// limited number of hops (skysa-notes lost one to a `PrematureCommitError`).
type Queued = PromiseExtended<void>;

/** Whether the library is bound to a connection, and so owed anything. */
export const isBound = (db: Pick<MemoriamDatabase, 'syncState'>): PromiseExtended<boolean> =>
	db.syncState.count().then((count) => count > 0);

/** The ops queued for one passage. */
const opsFor = (
	db: QueueDb,
	note: Pick<NoteRecord, 'connectionId' | 'id'>
): PromiseExtended<OpQueueRecord[]> =>
	db.opQueue
		.where('noteId')
		.equals(note.id)
		.filter((op) => op.connectionId === note.connectionId)
		.toArray();

const seqsOf = (ops: readonly OpQueueRecord[]): number[] =>
	ops.flatMap((op) => (op.seq === undefined ? [] : [op.seq]));

/** The library's ops about one path, by the `path` index. */
const atPath = (
	db: QueueDb,
	connectionId: string,
	path: string
): PromiseExtended<OpQueueRecord[]> =>
	db.opQueue
		.where('path')
		.equals(path)
		.filter((op) => op.connectionId === connectionId)
		.toArray();

const nothing = (): Queued => Dexie.Promise.resolve();

const add = (
	db: QueueDb,
	op: Pick<
		OpQueueRecord,
		'connectionId' | 'op' | 'noteId' | 'fileId' | 'path' | 'targetPath' | 'remoteId'
	>
): Queued =>
	isBound(db).then((bound) =>
		bound
			? db.opQueue.add({ attempts: 0, queuedAt: Date.now(), ...op }).then(() => undefined)
			: undefined
	);

/**
 * The passage's file has changed. One queued write is enough, however many
 * edits land before it runs. `except` is an op that is finishing, which does
 * not count as still queued.
 */
export const queueWrite = (db: QueueDb, note: NoteRecord, except?: number): Queued =>
	// A tombstone owes the remote its delete and nothing else.
	note.deletedLocally === 1
		? nothing()
		: opsFor(db, note).then((queued) =>
				queued.some((op) => op.op === 'write' && op.seq !== except)
					? undefined
					: add(db, {
							connectionId: note.connectionId,
							op: 'write',
							noteId: note.id,
							path: note.path,
						})
			);

/**
 * The passage is now at `note.path`, having been at `from`. Replaces any move
 * already queued for it, keeping that move's origin: the file is still
 * wherever the first move would have taken it from.
 */
export const queueMove = (db: QueueDb, note: NoteRecord, from: string): Queued =>
	opsFor(db, note).then((ops) => {
		const moves = ops.filter((op) => op.op === 'move');
		// Already on its way to where the passage is: left where it stands in
		// the queue rather than sent to the back.
		if (moves.length === 1 && moves[0]?.targetPath === note.path) return undefined;
		const origin = moves[0]?.path ?? from;
		// A tombstone is moved too: it can be restored, and its write is then
		// addressed to where the passage has got to.
		const owed = note.remoteId !== undefined && origin !== note.path;
		return db.opQueue.bulkDelete(seqsOf(moves)).then(() =>
			owed
				? add(db, {
						connectionId: note.connectionId,
						op: 'move',
						noteId: note.id,
						path: origin,
						targetPath: note.path,
					})
				: undefined
		);
	});

/**
 * The passage is deleted. Any write still queued for it is withdrawn first: a
 * passage made and deleted before either op was sent would otherwise have its
 * file created, and another device's passage of the same name bind to that
 * file and go with the delete behind it (skysa-notes' two-browser soak found
 * it). A write already at the network is withdrawn from the queue only, and
 * the `remoteId` it records on the row is what this delete needs.
 */
export const queueDelete = (db: QueueDb, note: NoteRecord): Queued =>
	opsFor(db, note)
		.then((queued) => db.opQueue.bulkDelete(seqsOf(queued.filter((op) => op.op === 'write'))))
		.then(() =>
			add(db, {
				connectionId: note.connectionId,
				op: 'delete',
				noteId: note.id,
				path: note.path,
			})
		);

/**
 * A deleted passage is the user's again. A delete still queued is withdrawn —
 * if it was already on its way, the file is gone and the write makes it again —
 * and the passage is owed a write either way.
 */
export const queueRestore = (db: QueueDb, note: NoteRecord): Queued =>
	opsFor(db, note)
		.then((ops) => db.opQueue.bulkDelete(seqsOf(ops.filter((op) => op.op === 'delete'))))
		.then(() => queueWrite(db, note));

/**
 * A collection that has to exist on the remote even with nothing in it yet.
 * An `rmdir` queued for this path or one above it is withdrawn: the directory
 * it would remove is the one this needs, or holds it.
 */
export const queueMkdir = (db: QueueDb, connectionId: string, path: string): Queued =>
	db.opQueue
		.where('path')
		.anyOf([path, ...ancestorPaths(path)])
		.filter((op) => op.connectionId === connectionId && op.op === 'rmdir')
		.toArray()
		.then((stale) =>
			db.opQueue
				.bulkDelete(seqsOf(stale))
				.then(() => atPath(db, connectionId, path))
				.then((queued) =>
					queued.some((op) => op.op === 'mkdir')
						? undefined
						: add(db, { connectionId, op: 'mkdir', path })
				)
		);

/**
 * A collection gone from this device before its `mkdir` was sent. Withdrawn,
 * with everything under it: sent, it would make a directory nothing here will
 * ever remove, and the next pull would make the collection again, empty.
 */
export const withdrawMkdirs = (db: QueueDb, connectionId: string, path: string): Queued =>
	db.opQueue
		.where('connectionId')
		.equals(connectionId)
		.filter((op) => op.op === 'mkdir' && isWithin(op.path, path))
		.toArray()
		.then((inside) => db.opQueue.bulkDelete(seqsOf(inside)))
		.then(() => undefined);

/**
 * A collection removed from this device, whose directory the remote still has
 * — deleted, or left behind by a rename. Queued after the ops that empty it,
 * and with the folder's `remoteId` as it was: the row is gone, so nothing else
 * can say which directory this is about. Nothing for a collection the remote
 * never had.
 */
export const queueRmdir = (
	db: QueueDb,
	connectionId: string,
	path: string,
	remoteId: string | undefined
): Queued =>
	remoteId === undefined
		? nothing()
		: atPath(db, connectionId, path).then((queued) =>
				// By path and id together, as skysa-notes matches them.
				queued.some((op) => op.op === 'rmdir' && op.remoteId === remoteId)
					? undefined
					: add(db, { connectionId, op: 'rmdir', path, remoteId })
			);

/** The ops queued for one file, as `opsFor` for a passage. */
const opsForFile = (
	db: QueueDb,
	file: Pick<FileRecord, 'connectionId' | 'id'>
): PromiseExtended<OpQueueRecord[]> =>
	db.opQueue
		.where('fileId')
		.equals(file.id)
		.filter((op) => op.connectionId === file.connectionId)
		.toArray();

/**
 * A file beside the passages, carried to `file.path` by a collection's rename,
 * having been at `from`. `queueMove`'s rules: an earlier move is replaced and
 * its origin kept, and one already going there is left where it stands.
 * Nothing here makes a file, so every one has a `remoteId`; one without is
 * left alone.
 */
export const queueMoveFile = (db: QueueDb, file: FileRecord, from: string): Queued =>
	opsForFile(db, file).then((ops) => {
		if (file.remoteId === undefined) return undefined;
		const moves = ops.filter((op) => op.op === 'move-file');
		if (moves.length === 1 && moves[0]?.targetPath === file.path) return undefined;
		const origin = moves[0]?.path ?? from;
		return db.opQueue.bulkDelete(seqsOf(moves)).then(() =>
			origin === file.path
				? undefined
				: add(db, {
						connectionId: file.connectionId,
						op: 'move-file',
						fileId: file.id,
						path: origin,
						targetPath: file.path,
					})
		);
	});

/** What a library owes the remote at once: collections to make, passages to write. */
export interface Owed {
	readonly folders: readonly string[];
	readonly notes: readonly NoteRecord[];
}

/** One owed op, by the collection it is in (folded segments) and which of its ops it is. */
interface InCollection {
	readonly collection: readonly string[];
	readonly rank: number;
	readonly queue: () => Queued;
}

const collectionOf = (path: string): string[] => pathSegments(path).map(foldName);

/** Collections in depth-first pre-order: each before every one inside it, siblings by name. */
const preOrder = (a: readonly string[], b: readonly string[]): number => {
	const [name, ...insideA] = a;
	const [other, ...insideB] = b;
	if (name === undefined || other === undefined) return a.length - b.length;
	return name.localeCompare(other) || preOrder(insideA, insideB);
};

/**
 * What a whole library owes the remote, queued collection by collection: the
 * passages a backup brought in, or the library a bind owes its connection. The
 * passages in no collection first, then each collection in turn — its `mkdir`,
 * then the writes of the passages directly in it — and the collections inside
 * it after it. So another device fills in a collection at a time, rather than
 * showing every one of them empty long before the first passage arrives.
 */
export const queueByNotebook = (db: QueueDb, connectionId: string, owed: Owed): Queued =>
	[
		...owed.folders.map((path): InCollection => ({
			collection: collectionOf(path),
			rank: 0,
			queue: () => queueMkdir(db, connectionId, path),
		})),
		...owed.notes.map((note): InCollection => ({
			collection: collectionOf(parentPath(note.path)),
			rank: 1,
			queue: () => queueWrite(db, note),
		})),
	]
		.sort((a, b) => preOrder(a.collection, b.collection) || a.rank - b.rank)
		.reduce<Queued>((queued, next) => queued.then(next.queue), nothing());
