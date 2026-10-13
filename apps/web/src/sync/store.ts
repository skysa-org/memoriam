import {
	basename,
	conflictContent,
	type ConflictResolution,
	foldName,
	isWithin,
	normalizePath,
	type OpOutcome,
	parentPath,
	type ParsedPassageFile,
	parsePassageFile,
	type PullBatch,
	type PullChange,
	rebasePath,
	ROOT,
	type SyncFile,
	type SyncFolder,
	type SyncNote,
	type SyncOp,
	type SyncStore,
	type UnreadableFile,
} from '@memoriam/core';

import {
	type FileBytesRecord,
	type FileRecord,
	type FolderRecord,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	noteKey,
	type NoteRecord,
	type OpQueueRecord,
	type SyncStateRecord,
} from '../store/db.js';
import { pulledRow } from '../store/passages.js';
import { queueMove, queueWrite } from '../store/queue.js';
import { eachInSlices } from '../store/slices.js';

/**
 * The sync engine's `SyncStore` port, over the app's own IndexedDB tables:
 * skysa-notes' `sync/store.ts`, ported (docs/ARCHITECTURE.md §10, "The web
 * store"). The engine's promises that the type cannot state are checked by the
 * contract suite in `packages/core/tests/sync/storeContract.ts`, registered
 * against this store in `apps/web/tests/syncStore.test.ts`.
 *
 * Where it differs from skysa-notes':
 * - **One library.** Its rows stay under `LOCAL_CONNECTION_ID` whatever it is
 *   bound to, and the connection is the one `syncState` row. A store is made
 *   for a connection, and writes only while the library is still bound to it:
 *   one that was at the network when the library was let go, or bound to
 *   another account, brings back what belongs to nothing shown.
 * - **A merge** (`merge-note`) is carried out here, as a pull's change.
 * - **No pictures, pins or open notebooks**, which Memoriam has none of.
 *
 * Tombstones are notes like any other here. The port asks every read to see a
 * passage whose delete is still queued, because the row is what carries the
 * `remoteId` the delete needs; the screens are what hide them.
 */

/** The library is no longer bound to the connection this store was made for. */
export class UnboundConnectionError extends Error {
	override readonly name = 'UnboundConnectionError';

	constructor(readonly connectionId: string) {
		super(`The library no longer syncs with connection ${connectionId}`);
	}
}

export interface DexieSyncStoreOptions {
	connectionId: string;
	/** For `createdAt` and friends; injectable so tests are deterministic. */
	now?: () => number;
}

type Scope = Pick<
	MemoriamDatabase,
	'notes' | 'folders' | 'opQueue' | 'syncState' | 'files' | 'fileBytes'
>;

/** Every row the library has, whichever connection it is bound to. */
const LIBRARY = LOCAL_CONNECTION_ID;

/**
 * Dirty as the engine means it: writing here that has not reached the remote.
 * A tombstone is never that, whatever its flag says: it has nothing left to
 * send but its delete, which is the queued op. Reported dirty, a tombstone
 * meeting a remote change would be a conflict, whose copy is a new passage
 * holding the text the user deleted. Reported clean, the pull writes the row
 * back and the delete behind it purges it: skysa-notes' "the delete wins".
 */
const isDirty = (note: NoteRecord): boolean => note.dirty === 1 && note.deletedLocally === 0;

const toSyncNote = (note: NoteRecord): SyncNote => ({
	id: note.id,
	path: note.path,
	content: note.source,
	...(note.remoteId === undefined ? {} : { remoteId: note.remoteId }),
	...(note.remoteVersion === undefined ? {} : { remoteVersion: note.remoteVersion }),
	...(note.syncedHash === undefined ? {} : { syncedHash: note.syncedHash }),
	dirty: isDirty(note),
});

const toSyncFolder = (folder: FolderRecord): SyncFolder => ({
	path: folder.path,
	...(folder.remoteId === undefined ? {} : { remoteId: folder.remoteId }),
});

const toSyncOp = (record: OpQueueRecord): SyncOp => {
	if (record.seq === undefined) throw new Error('A queued op was read back without its seq');
	return {
		seq: record.seq,
		op: record.op,
		...(record.noteId === undefined ? {} : { noteId: record.noteId }),
		...(record.fileId === undefined ? {} : { fileId: record.fileId }),
		path: record.path,
		...(record.targetPath === undefined ? {} : { targetPath: record.targetPath }),
		...(record.remoteId === undefined ? {} : { remoteId: record.remoteId }),
		...(record.copyOf === undefined ? {} : { copyOf: record.copyOf }),
		attempts: record.attempts,
	};
};

const toSyncFile = (file: FileRecord): SyncFile => ({
	id: file.id,
	path: file.path,
	...(file.remoteId === undefined ? {} : { remoteId: file.remoteId }),
	...(file.remoteVersion === undefined ? {} : { remoteVersion: file.remoteVersion }),
	size: file.size,
});

type FileChange = Extract<
	PullChange,
	{ kind: 'upsert-file' | 'displace-file' | 'delete-file' | 'reupload-file' }
>;

const FILE_CHANGES: ReadonlySet<PullChange['kind']> = new Set([
	'upsert-file',
	'displace-file',
	'delete-file',
	'reupload-file',
]);

const isFileChange = (change: PullChange): change is FileChange => FILE_CHANGES.has(change.kind);

type FileOutcome = Extract<OpOutcome, { kind: 'uploaded' | 'moved-file' | 'lost-file' }>;

const FILE_OUTCOMES: ReadonlySet<OpOutcome['kind']> = new Set([
	'uploaded',
	'moved-file',
	'lost-file',
]);

const isFileOutcome = (outcome: OpOutcome): outcome is FileOutcome =>
	FILE_OUTCOMES.has(outcome.kind);

/**
 * Whether held bytes are the file's: held because they are not up yet, or
 * cached under the version the row is bound to.
 */
const heldBytesAreCurrent = (file: FileRecord, held: FileBytesRecord): boolean =>
	held.pinned === 1 || (held.version !== undefined && held.version === file.remoteVersion);

/** Cached rather than held: the version they are, and nothing pinning them. */
const cachedAs = (
	{ version: _version, ...held }: FileBytesRecord,
	version: string
): FileBytesRecord => ({ ...held, version, pinned: 0 });

/** Cut loose from its file, and so from the bytes it last agreed with it on. */
const withoutRemote = ({
	remoteId: _remoteId,
	remoteVersion: _remoteVersion,
	syncedHash: _syncedHash,
	...note
}: NoteRecord): NoteRecord => note;

/** Absent says the hash already stored still holds (`PullChange`). */
const syncedHashOf = (syncedHash: string | undefined) =>
	syncedHash === undefined ? {} : { syncedHash };

type ListedFile = NonNullable<SyncStateRecord['unreadable']>[number];

const sameFile = (one: ListedFile, two: ListedFile | undefined): boolean =>
	one.remoteId === two?.remoteId &&
	one.path === two.path &&
	(one.movedAside ?? []).length === (two.movedAside ?? []).length &&
	(one.movedAside ?? []).every((path, at) => path === two.movedAside?.[at]);

const listed = (file: UnreadableFile): ListedFile => ({
	remoteId: file.remoteId,
	path: file.path,
	...(file.movedAside === undefined ? {} : { movedAside: [...file.movedAside] }),
});

/** Every file a pull brings in whole, read before its transaction opens, by its change. */
type Read = ReadonlyMap<PullChange, ParsedPassageFile>;

/** What a change brings in whole: an upsert's file, or a merge. */
const broughtIn = (change: PullChange): { path: string; content: string } | undefined =>
	change.kind === 'upsert-note' || change.kind === 'merge-note' ? change : undefined;

export const createDexieSyncStore = (
	db: MemoriamDatabase,
	options: DexieSyncStoreOptions
): SyncStore => {
	const { connectionId } = options;
	const now = options.now ?? Date.now;

	/**
	 * Every pulled file read, before the transaction opens and a slice at a
	 * time (`store/slices.ts`). A read is most of what a passage costs to apply:
	 * read in the transaction, a first pull of a few thousand held every other
	 * reader off for as long as all of them took (skysa-notes #275).
	 */
	const readAll = async (changes: readonly PullChange[]): Promise<Read> => {
		const read = new Map<PullChange, ParsedPassageFile>();
		await eachInSlices(changes, (change) => {
			const file = broughtIn(change);
			if (file === undefined) return;
			read.set(change, parsePassageFile(file.content, { filename: basename(file.path) }));
		});
		return read;
	};

	/**
	 * Every write, and only while the library is still bound to this
	 * connection. Checked in the transaction, which binding locks too, so the
	 * two cannot interleave.
	 */
	const inTransaction = <T>(work: () => Promise<T>): Promise<T> =>
		db.transaction(
			'rw',
			[db.notes, db.folders, db.opQueue, db.syncState, db.files, db.fileBytes],
			async () => {
				if ((await db.syncState.get(connectionId)) === undefined) {
					throw new UnboundConnectionError(connectionId);
				}
				return work();
			}
		);

	const notesOf = (scope: Scope): Promise<NoteRecord[]> =>
		scope.notes.where('connectionId').equals(LIBRARY).toArray();

	const foldersOf = (scope: Scope): Promise<FolderRecord[]> =>
		scope.folders.where('connectionId').equals(LIBRARY).toArray();

	const opsOf = (scope: Scope): Promise<OpQueueRecord[]> =>
		scope.opQueue.where('connectionId').equals(LIBRARY).toArray();

	const filesOf = (scope: Scope): Promise<FileRecord[]> =>
		scope.files.where('connectionId').equals(LIBRARY).toArray();

	const fileKey = (id: string): [string, string] => [LIBRARY, id];

	const ownFile = (scope: Scope, id: string): Promise<FileRecord | undefined> =>
		scope.files.get(fileKey(id));

	/** A row and whatever is held for it, together. */
	const dropFile = async (scope: Scope, id: string): Promise<void> => {
		await scope.files.delete(fileKey(id));
		await scope.fileBytes.delete(fileKey(id));
	};

	const fileOpsOf = async (scope: Scope, fileId: string): Promise<OpQueueRecord[]> =>
		(await scope.opQueue.where('fileId').equals(fileId).toArray()).filter(
			(op) => op.connectionId === LIBRARY
		);

	const withdraw = (scope: Scope, ops: readonly OpQueueRecord[]) =>
		scope.opQueue.bulkDelete(ops.flatMap((op) => (op.seq === undefined ? [] : [op.seq])));

	/** The same, and the ops queued for it: there is nothing left to send or move. */
	const forgetFile = async (scope: Scope, id: string): Promise<void> => {
		await dropFile(scope, id);
		const owed = await fileOpsOf(scope, id);
		await withdraw(
			scope,
			owed.filter((op) => op.op === 'upload' || op.op === 'move-file')
		);
	};

	/**
	 * A bound row a pull is about to take or cut loose. An upload that copies
	 * its file (`copyOf`) would read the bytes from the remote, which has just
	 * said the file is gone — so whatever this device holds of them goes to
	 * each copy, held until it is sent, and the copy no longer reads anything.
	 */
	const handOver = async (scope: Scope, file: FileRecord): Promise<void> => {
		const held = await scope.fileBytes.get(fileKey(file.id));
		if (held === undefined || !heldBytesAreCurrent(file, held) || file.remoteId === undefined)
			return;
		const { version: _version, ...bytes } = held;
		const copies = (await opsOf(scope)).filter(
			(op) => op.op === 'upload' && op.copyOf === file.remoteId
		);
		await scope.fileBytes.bulkPut(
			copies.flatMap((op) =>
				op.fileId === undefined ? [] : [{ ...bytes, id: op.fileId, pinned: 1 as const }]
			)
		);
		await scope.opQueue.bulkPut(copies.map(({ copyOf: _copyOf, ...op }) => op));
	};

	/** A row is another's file, which only an engine that has lost track makes. */
	const refuseTwin = async (scope: Scope, fileId: string, remoteId: string) => {
		const twin = await scope.files
			.where('[connectionId+remoteId]')
			.equals([LIBRARY, remoteId])
			.filter((each) => each.id !== fileId)
			.first();
		if (twin !== undefined) throw new Error(`File ${remoteId} is ${twin.id}'s already`);
	};

	/** A queued `move-file`'s origin, pointed at where the remote says the file is. */
	const fileOriginIsNow = async (scope: Scope, fileId: string, at: string): Promise<void> => {
		const ops = await fileOpsOf(scope, fileId);
		await scope.opQueue.bulkPut(
			ops.filter((op) => op.op === 'move-file').map((op) => ({ ...op, path: at }))
		);
	};

	/** One file's queued ops, after it as it moves. */
	const rebaseFileOps = async (scope: Scope, fileId: string, from: string, to: string) => {
		const ops = await fileOpsOf(scope, fileId);
		await scope.opQueue.bulkPut(
			ops.map((op) => ({
				...op,
				path: op.path === from ? to : op.path,
				...(op.targetPath === from ? { targetPath: to } : {}),
			}))
		);
	};

	/** The library's row with this id, or nothing. */
	const ownNote = (scope: Scope, id: string): Promise<NoteRecord | undefined> =>
		scope.notes.get([LIBRARY, id]);

	const requireNote = async (scope: Scope, id: string): Promise<NoteRecord> => {
		const note = await ownNote(scope, id);
		if (note === undefined) throw new Error(`No note with id ${id}`);
		return note;
	};

	const ensureFolderChain = async (scope: Scope, path: string): Promise<void> => {
		if (path === ROOT) return;
		if ((await scope.folders.get([LIBRARY, path])) !== undefined) return;
		await ensureFolderChain(scope, parentPath(path));
		await scope.folders.put({ connectionId: LIBRARY, path, createdAt: now() });
	};

	const queue = async (
		scope: Scope,
		op: Pick<OpQueueRecord, 'op' | 'noteId' | 'fileId' | 'path' | 'targetPath' | 'remoteId'>
	): Promise<void> => {
		await scope.opQueue.add({ connectionId: LIBRARY, attempts: 0, queuedAt: now(), ...op });
	};

	/** One passage's queued ops. */
	const noteOpsOf = async (scope: Scope, noteId: string): Promise<OpQueueRecord[]> =>
		(await scope.opQueue.where('noteId').equals(noteId).toArray()).filter(
			(op) => op.connectionId === LIBRARY
		);

	/**
	 * Point a queued rename's *origin* at where the pull says the passage's file
	 * is. The origin is where the file was when the user renamed it, and a pull
	 * that carries the remote's own path for it has just said it is somewhere
	 * else. The target is left as it is: it is the name the user chose.
	 */
	const originIsNow = async (scope: Scope, noteId: string, at: string): Promise<void> => {
		const ops = await noteOpsOf(scope, noteId);
		await scope.opQueue.bulkPut(
			ops.filter((op) => op.op === 'move').map((op) => ({ ...op, path: at }))
		);
	};

	/** Point one passage's queued ops at where it has just been moved to. */
	const rebaseOwnOps = async (scope: Scope, noteId: string, from: string, to: string) => {
		const ops = await noteOpsOf(scope, noteId);
		await scope.opQueue.bulkPut(
			ops.map((op) => ({
				...op,
				path: op.path === from ? to : op.path,
				...(op.targetPath === from ? { targetPath: to } : {}),
			}))
		);
	};

	const applyConflict = async (scope: Scope, resolution: ConflictResolution): Promise<void> => {
		const note = await requireNote(scope, resolution.noteId);
		// The remote takes the path it claims, which need not be where the local
		// passage was: one can be moved and edited between syncs.
		await ensureFolderChain(scope, parentPath(resolution.remote.path));
		await scope.notes.put({
			...pulledRow({
				id: note.id,
				connectionId: LIBRARY,
				path: resolution.remote.path,
				source: resolution.remoteContent,
				existing: note,
				now: now(),
			}),
			remoteId: resolution.remote.remoteId,
			remoteVersion: resolution.remote.version,
			syncedHash: resolution.remoteHash,
		});

		// The edit that lost is in the copy now, and the row holds the remote's
		// bytes. A queued write would put the old text straight back. A queued
		// move is the user's rename, and stays, from where the remote has it.
		const ops = await noteOpsOf(scope, resolution.noteId);
		await withdraw(
			scope,
			ops.filter((op) => op.op === 'write')
		);
		await originIsNow(scope, resolution.noteId, resolution.remote.path);

		// Deleted by the time the conflict lands: the delete wins, and the row is
		// written back for the queued delete to purge. A copy would be a new
		// passage holding the text the user just deleted.
		if (note.deletedLocally === 1) return;

		// The copy is made from the passage as it stands, not as the engine read
		// it: a pass recorded while the engine was at the network is in it.
		const copyContent = conflictContent(note.source, resolution.copyId);
		// A fresh id is the engine's promise. Writing over whatever held it would
		// be losing a passage to save one.
		if ((await ownNote(scope, resolution.copyId)) !== undefined) {
			throw new Error(`The conflict copy's id ${resolution.copyId} is taken`);
		}
		await ensureFolderChain(scope, parentPath(resolution.copyPath));
		await scope.notes.add({
			...pulledRow({
				id: resolution.copyId,
				connectionId: LIBRARY,
				path: resolution.copyPath,
				source: copyContent,
				existing: undefined,
				now: now(),
			}),
			// The copy is the user's, and exists nowhere else yet.
			dirty: 1,
		});
		await queue(scope, { op: 'write', noteId: resolution.copyId, path: resolution.copyPath });
	};

	/**
	 * A merge (§10, "Merge before a conflict copy"): the passage takes the text
	 * the engine merged from it and the remote's, and is bound to the remote's
	 * file. Refused where the passage no longer holds what the merge was made
	 * from — a pass recorded while the engine was at the network — so the batch
	 * rolls back with its cursor and the next pull merges again from the
	 * passage as it is. A pass is never written over.
	 */
	const applyMerge = async (
		scope: Scope,
		change: Extract<PullChange, { kind: 'merge-note' }>,
		read: Read
	): Promise<void> => {
		const note = await ownNote(scope, change.id);
		if (note?.source !== change.base) {
			throw new Error(`Note ${change.id} changed after its merge was made`);
		}
		await ensureFolderChain(scope, parentPath(change.path));
		await scope.notes.put({
			...pulledRow({
				id: note.id,
				connectionId: LIBRARY,
				path: change.path,
				source: change.content,
				existing: note,
				now: now(),
				parsed: readFor(read, change),
			}),
			remoteId: change.remote.remoteId,
			remoteVersion: change.remote.version,
			syncedHash: change.syncedHash,
			// What the remote has not got yet is still owed.
			dirty: change.clean ? 0 : 1,
		});
		await rebaseOwnOps(scope, note.id, note.path, change.path);
		await originIsNow(scope, note.id, change.remote.path);
		const writes = (await noteOpsOf(scope, note.id)).filter((op) => op.op === 'write');
		if (change.clean) {
			await withdraw(scope, writes);
			return;
		}
		if (writes.length === 0)
			await queue(scope, { op: 'write', noteId: note.id, path: change.path });
	};

	/** Rewrite the list of files that could not be read, where it changes. */
	const relist = async (
		scope: Scope,
		change: (files: readonly ListedFile[]) => ListedFile[]
	): Promise<void> => {
		const state = await scope.syncState.get(connectionId);
		if (state === undefined) return;
		const { unreadable: before = [], ...rest } = state;
		const after = change(before);
		const same =
			after.length === before.length && after.every((file, at) => sameFile(file, before[at]));
		if (same) return;
		// Absent rather than empty, as the row was before it ever had one.
		await scope.syncState.put(after.length === 0 ? rest : { ...rest, unreadable: after });
	};

	const moveFolder = async (scope: Scope, from: string, to: string, remoteId?: string) => {
		const folders = (await foldersOf(scope)).filter((folder) => isWithin(folder.path, from));
		await scope.folders.bulkDelete(folders.map((folder) => [LIBRARY, folder.path]));
		await scope.folders.bulkPut(
			folders.map((folder) => ({
				...folder,
				path: rebasePath(folder.path, from, to),
				...(folder.path === from && remoteId !== undefined ? { remoteId } : {}),
			}))
		);

		// Passages move with the collection even when dirty: the move is
		// metadata and cannot conflict with an edit to the words.
		const notes = (await notesOf(scope)).filter((note) => isWithin(note.path, from));
		await scope.notes.bulkPut(
			notes.map((note) => ({ ...note, path: rebasePath(note.path, from, to) }))
		);

		// And both halves of every op's address, or a queued move stays aimed at
		// a folder that no longer exists and strands the ordered queue behind it.
		const ops = await opsOf(scope);
		await scope.opQueue.bulkPut(
			ops
				.filter(
					(op) =>
						isWithin(op.path, from) ||
						(op.targetPath !== undefined && isWithin(op.targetPath, from))
				)
				.map((op) => ({
					...op,
					path: isWithin(op.path, from) ? rebasePath(op.path, from, to) : op.path,
					...(op.targetPath !== undefined && isWithin(op.targetPath, from)
						? { targetPath: rebasePath(op.targetPath, from, to) }
						: {}),
				}))
		);

		// Files, bound and pending: an id-only feed names none of them.
		const files = (await filesOf(scope)).filter((file) => isWithin(file.path, from));
		await scope.files.bulkPut(
			files.map((file) => ({ ...file, path: rebasePath(file.path, from, to) }))
		);

		await relist(scope, (files) =>
			files.map((file) =>
				isWithin(file.path, from)
					? { ...file, path: rebasePath(file.path, from, to) }
					: file
			)
		);
	};

	/**
	 * The ids, first among `ops` of `kind` per item, whose queued rename says
	 * the item is somewhere other than under `path` (or `was`, the directory's
	 * other spelling where the batch moved it).
	 */
	const movedOut = async (
		scope: Scope,
		kind: 'move' | 'move-file',
		idOf: (op: OpQueueRecord) => string | undefined,
		path: string,
		was: string | undefined
	): Promise<string[]> => {
		const first = [...(await opsOf(scope))]
			.sort((one, two) => (one.seq ?? 0) - (two.seq ?? 0))
			.reduce<Map<string, string>>((map, op) => {
				const id = idOf(op);
				return op.op !== kind || id === undefined || map.has(id)
					? map
					: map.set(id, op.path);
			}, new Map());
		return [...first]
			.filter(
				([, from]) => !isWithin(from, path) && (was === undefined || !isWithin(from, was))
			)
			.map(([id]) => id);
	};

	const deleteFolder = async (
		scope: Scope,
		path: string,
		keep: readonly string[] = [],
		was?: string,
		keepFiles: readonly string[] = []
	): Promise<void> => {
		// The app folder is not a collection, and every path is within it.
		if (normalizePath(path) === ROOT) return;
		// Before asking whether the folder is one we hold: the unreadable files
		// under it are gone with it either way.
		await relist(scope, (files) => files.filter((file) => !isWithin(file.path, path)));
		if ((await scope.folders.get([LIBRARY, path])) === undefined) return;

		const folders = (await foldersOf(scope)).filter((folder) => isWithin(folder.path, path));
		await scope.folders.bulkDelete(folders.map((folder) => [LIBRARY, folder.path]));

		// A clean passage goes with its collection. A dirty one is the user's
		// and exists nowhere else, so it stays, cut loose from the file that is
		// gone. One the engine spared, or whose queued rename says its file is
		// elsewhere, is left as it is, remote and all.
		const spared = new Set([
			...keep,
			...(await movedOut(scope, 'move', (op) => op.noteId, path, was)),
		]);
		const inside = (await notesOf(scope)).filter(
			(note) => isWithin(note.path, path) && !spared.has(note.id)
		);
		await scope.notes.bulkDelete(inside.filter((note) => !isDirty(note)).map(noteKey));
		await scope.notes.bulkPut(inside.filter(isDirty).map(withoutRemote));

		// A bound file goes, with its bytes, unless spared the same way. A
		// pending one stays: it exists nowhere else.
		const sparedFiles = new Set([
			...keepFiles,
			...(await movedOut(scope, 'move-file', (op) => op.fileId, path, was)),
		]);
		const goneFiles = (await filesOf(scope)).filter(
			(file) =>
				isWithin(file.path, path) &&
				file.remoteId !== undefined &&
				!sparedFiles.has(file.id)
		);
		await goneFiles.reduce<Promise<void>>(async (pending, file) => {
			await pending;
			await handOver(scope, file);
			await forgetFile(scope, file.id);
		}, Promise.resolve());
	};

	/** Bytes that were held, kept as the remote version's now that it has them. */
	const releaseBytes = async (scope: Scope, id: string, version: string): Promise<void> => {
		const held = await scope.fileBytes.get(fileKey(id));
		if (held === undefined) return;
		await scope.fileBytes.put(cachedAs(held, version));
	};

	const upsertFile = async (
		scope: Scope,
		change: Extract<PullChange, { kind: 'upsert-file' }>
	): Promise<void> => {
		// The user's word that it should go, said since the batch was decided:
		// passed over rather than refused, or a delete stuck at the network would
		// stop every pull that mentioned it.
		const ops = await opsOf(scope);
		const deleting = ops.some(
			(op) => op.op === 'delete-file' && op.remoteId === change.remote.remoteId
		);
		if (deleting) return;
		const existing = await ownFile(scope, change.fileId);
		const adoptable =
			existing?.remoteId === undefined &&
			existing?.path === change.path &&
			existing.size === (change.remote.size ?? 0);
		if (change.adopt === true && !adoptable) {
			throw new Error(`File ${change.fileId} is not one to adopt as that file`);
		}
		if (change.adopt !== true && existing !== undefined && existing.remoteId === undefined) {
			throw new Error(`File ${change.fileId} is pending, and only an adoption binds it`);
		}
		// Moved here and not yet there: the row stays where the user put it.
		const moving = ops.some((op) => op.op === 'move-file' && op.fileId === change.fileId);
		const path = moving && existing !== undefined ? existing.path : change.path;
		await ensureFolderChain(scope, parentPath(path));
		await scope.files.put({
			connectionId: LIBRARY,
			id: change.fileId,
			path,
			remoteId: change.remote.remoteId,
			remoteVersion: change.remote.version,
			size: change.remote.size ?? 0,
		});
		if (change.adopt === true) {
			await releaseBytes(scope, change.fileId, change.remote.version);
			const uploads = (await fileOpsOf(scope, change.fileId)).filter(
				(op) => op.op === 'upload'
			);
			await withdraw(scope, uploads);
		}
		await fileOriginIsNow(scope, change.fileId, change.remote.path);
	};

	const applyFileChange = async (
		scope: Scope,
		change: Extract<PullChange, { kind: 'displace-file' | 'delete-file' | 'reupload-file' }>
	): Promise<void> => {
		const file = await ownFile(scope, change.fileId);
		// An id that is not here is a no-op, as for a passage.
		if (file === undefined) return;
		if (change.kind === 'displace-file') {
			await ensureFolderChain(scope, parentPath(change.path));
			await scope.files.put({ ...file, path: change.path });
			await rebaseFileOps(scope, file.id, file.path, change.path);
			return;
		}
		if (file.remoteId === undefined) {
			// Never the remote's to take: a pending file exists nowhere else.
			if (change.kind === 'delete-file') {
				throw new Error(`File ${file.id} is pending, and not the remote's to delete`);
			}
			return;
		}
		await handOver(scope, file);
		if (change.kind === 'delete-file') {
			await forgetFile(scope, file.id);
			return;
		}
		// Gone from the remote, and wanted there: sent again from here.
		const held = await scope.fileBytes.get(fileKey(file.id));
		await forgetFile(scope, file.id);
		await scope.files.put({
			connectionId: LIBRARY,
			id: file.id,
			path: file.path,
			size: file.size,
		});
		if (held !== undefined && heldBytesAreCurrent(file, held)) {
			const { version: _version, ...bytes } = held;
			await scope.fileBytes.put({ ...bytes, pinned: 1 });
		}
		await queue(scope, { op: 'upload', fileId: file.id, path: file.path });
	};

	/**
	 * Every `rmdir` over `path`, sent to the back of the queue, behind the op
	 * just queued to take the file out of it.
	 */
	const rmdirsBehind = async (scope: Scope, path: string): Promise<void> => {
		const ops = await scope.opQueue.where('connectionId').equals(LIBRARY).sortBy('seq');
		const fold = (each: string) => foldName(normalizePath(each));
		const over = ops.filter((op) => op.op === 'rmdir' && isWithin(fold(path), fold(op.path)));
		await scope.opQueue.bulkDelete(
			over.flatMap((op) => (op.seq === undefined ? [] : [op.seq]))
		);
		await scope.opQueue.bulkAdd(over.map(({ seq: _seq, ...op }) => op));
	};

	const settleUpload = async (
		scope: Scope,
		outcome: Extract<OpOutcome, { kind: 'uploaded' }>
	): Promise<void> => {
		const file = await ownFile(scope, outcome.fileId);
		// Deleted while its bytes were on the way: what they made goes too.
		if (file === undefined) {
			await queue(scope, {
				op: 'delete-file',
				path: outcome.remote.path,
				remoteId: outcome.remote.remoteId,
			});
			await rmdirsBehind(scope, outcome.remote.path);
			return;
		}
		await refuseTwin(scope, file.id, outcome.remote.remoteId);
		const moved = file.path !== outcome.sentAs;
		await scope.files.put({
			...file,
			path: moved ? file.path : outcome.remote.path,
			remoteId: outcome.remote.remoteId,
			remoteVersion: outcome.remote.version,
			size: outcome.remote.size ?? file.size,
		});
		await releaseBytes(scope, file.id, outcome.remote.version);
		if (moved) {
			await queue(scope, {
				op: 'move-file',
				fileId: file.id,
				path: outcome.remote.path,
				targetPath: file.path,
			});
			await rmdirsBehind(scope, outcome.remote.path);
		}
	};

	const settleFileMove = async (
		scope: Scope,
		outcome: Extract<OpOutcome, { kind: 'moved-file' }>,
		withdrawn: boolean
	): Promise<void> => {
		const file = await ownFile(scope, outcome.fileId);
		if (file === undefined) return;
		await refuseTwin(scope, file.id, outcome.remote.remoteId);
		// A move leaves the bytes as they were — unless it landed on another file
		// and took that one for its own, whose bytes nobody here has read.
		const held = await scope.fileBytes.get(fileKey(file.id));
		const same = outcome.remote.remoteId === file.remoteId;
		if (held !== undefined && held.pinned === 0 && !same) {
			await scope.fileBytes.delete(fileKey(file.id));
		}
		if (held !== undefined && held.pinned === 0 && same && heldBytesAreCurrent(file, held)) {
			await scope.fileBytes.put(cachedAs(held, outcome.remote.version));
		}
		const landed: FileRecord = {
			...file,
			remoteId: outcome.remote.remoteId,
			remoteVersion: outcome.remote.version,
		};
		const queued = (await fileOpsOf(scope, file.id)).some(
			(op) => op.op === 'move-file' && op.seq !== undefined
		);
		await scope.files.put(withdrawn ? landed : { ...landed, path: outcome.remote.path });
		await fileOriginIsNow(scope, file.id, outcome.remote.path);
		if (withdrawn && !queued && file.path !== outcome.remote.path) {
			await queue(scope, {
				op: 'move-file',
				fileId: file.id,
				path: outcome.remote.path,
				targetPath: file.path,
			});
		}
	};

	const settleFile = async (
		scope: Scope,
		outcome: FileOutcome,
		withdrawn: boolean
	): Promise<void> => {
		if (outcome.kind === 'uploaded') {
			await settleUpload(scope, outcome);
			return;
		}
		if (outcome.kind === 'moved-file') {
			await settleFileMove(scope, outcome, withdrawn);
			return;
		}
		await forgetFile(scope, outcome.fileId);
	};

	const readFor = (read: Read, change: PullChange): ParsedPassageFile => {
		const parsed = read.get(change);
		if (parsed === undefined) throw new Error('A file reached the store without being read');
		return parsed;
	};

	const upsertNote = async (
		scope: Scope,
		change: Extract<PullChange, { kind: 'upsert-note' }>,
		read: Read
	): Promise<void> => {
		// The engine names the passage; the store never guesses by path.
		const existing = await ownNote(scope, change.id);
		// Decided against a clean passage that has been written since.
		if (existing !== undefined && isDirty(existing)) {
			throw new Error(`Note ${change.id} changed after its upsert was decided`);
		}
		await ensureFolderChain(scope, parentPath(change.path));
		await scope.notes.put({
			...pulledRow({
				id: change.id,
				connectionId: LIBRARY,
				path: change.path,
				source: change.content,
				existing,
				now: now(),
				parsed: readFor(read, change),
			}),
			remoteId: change.remote.remoteId,
			remoteVersion: change.remote.version,
			syncedHash: change.syncedHash,
		});
		// The remote has just said where this passage's file is.
		await originIsNow(scope, change.id, change.path);
	};

	const deleteNote = async (scope: Scope, id: string): Promise<void> => {
		const note = await ownNote(scope, id);
		// An id that is not here is a no-op: a rejected batch is retried for
		// ever, because the cursor moves only with it.
		if (note === undefined) return;
		if (isDirty(note)) throw new Error(`Note ${id} changed after its delete was decided`);
		await scope.notes.delete(noteKey(note));
	};

	/**
	 * A passage the rescan did not return, where the provider said its own copy
	 * may be what lost it. Everything the remote gave the row goes, and the
	 * write that puts it back is queued here, since a clean passage is owed no
	 * op. A tombstone owes its delete and nothing else, and keeps the
	 * `remoteId` that delete is addressed by.
	 */
	const reuploadNote = async (scope: Scope, id: string): Promise<void> => {
		const note = await ownNote(scope, id);
		if (note === undefined || note.deletedLocally === 1) return;
		await scope.notes.put({ ...withoutRemote(note), dirty: 1 });
		await queue(scope, { op: 'write', noteId: note.id, path: note.path });
	};

	/** The same for a collection, which never cascades: its passages are named too. */
	const reuploadFolder = async (scope: Scope, path: string): Promise<void> => {
		const folder = await scope.folders.get([LIBRARY, path]);
		if (folder === undefined) return;
		const { remoteId: _remoteId, ...rest } = folder;
		await scope.folders.put(rest);
		await queue(scope, { op: 'mkdir', path });
	};

	/** The collection a pulled file needs, made if the library has not got it. */
	const ensureFolder = async (
		scope: Scope,
		path: string,
		remoteId: string | undefined
	): Promise<void> => {
		if (path === ROOT) return;
		await ensureFolderChain(scope, parentPath(path));
		const existing = await scope.folders.get([LIBRARY, path]);
		await scope.folders.put({
			connectionId: LIBRARY,
			path,
			createdAt: existing?.createdAt ?? now(),
			// An `ensure-folder` without an id says nothing about the one the row
			// already has, so it is kept rather than forgotten.
			...(remoteId === undefined
				? existing?.remoteId === undefined
					? {}
					: { remoteId: existing.remoteId }
				: { remoteId }),
		});
	};

	const applyChange = async (scope: Scope, change: PullChange, read: Read): Promise<void> => {
		if (isFileChange(change)) {
			await (change.kind === 'upsert-file'
				? upsertFile(scope, change)
				: applyFileChange(scope, change));
			return;
		}
		switch (change.kind) {
			case 'upsert-note':
				await upsertNote(scope, change, read);
				return;
			case 'merge-note':
				await applyMerge(scope, change, read);
				return;
			case 'adopt-version': {
				const note = await requireNote(scope, change.id);
				await scope.notes.put({
					...note,
					remoteId: change.remote.remoteId,
					remoteVersion: change.remote.version,
					...syncedHashOf(change.syncedHash),
				});
				await originIsNow(scope, change.id, change.remote.path);
				return;
			}
			case 'move-note': {
				const note = await requireNote(scope, change.id);
				await ensureFolderChain(scope, parentPath(change.path));
				await scope.notes.put({
					...note,
					path: change.path,
					remoteId: change.remote.remoteId,
					remoteVersion: change.remote.version,
					...syncedHashOf(change.syncedHash),
				});
				await rebaseOwnOps(scope, note.id, note.path, change.path);
				return;
			}
			case 'delete-note':
				await deleteNote(scope, change.id);
				return;
			case 'detach-note': {
				const note = await ownNote(scope, change.id);
				if (note !== undefined) await scope.notes.put(withoutRemote(note));
				return;
			}
			case 'displace-note': {
				const note = await ownNote(scope, change.id);
				if (note === undefined) return;
				// Words and dirty flag untouched: it is only moving out of the way.
				await ensureFolderChain(scope, parentPath(change.path));
				await scope.notes.put({ ...note, path: change.path });
				await rebaseOwnOps(scope, note.id, note.path, change.path);
				return;
			}
			case 'ensure-folder':
				await ensureFolder(scope, change.path, change.remoteId);
				return;
			case 'reupload-note':
				await reuploadNote(scope, change.id);
				return;
			case 'reupload-folder':
				await reuploadFolder(scope, change.path);
				return;
			case 'move-folder':
				await moveFolder(scope, change.from, change.to, change.remoteId);
				return;
			case 'delete-folder':
				await deleteFolder(scope, change.path, change.keep, change.was, change.keepFiles);
				return;
			// One record per file: a second for the same id is the file renamed.
			case 'unreadable':
				await relist(scope, (files) => {
					const { remoteId } = change.file;
					const record = listed(change.file);
					return files.some((file) => file.remoteId === remoteId)
						? files.map((file) => (file.remoteId === remoteId ? record : file))
						: [...files, record];
				});
				return;
			case 'forget-unreadable':
				await relist(scope, (files) =>
					files.filter((file) => file.remoteId !== change.remoteId)
				);
				return;
			case 'conflict':
				await applyConflict(scope, change.resolution);
				return;
		}
	};

	/**
	 * Record what an op achieved, against the passage as it now stands. The
	 * engine held the op while it was at the network, and the user may have
	 * gone on meanwhile; `withdrawn` says the op itself is gone from the queue,
	 * which only a later change of the user's does (`store/queue.ts`).
	 */
	const settle = async (
		scope: Scope,
		seq: number,
		outcome: OpOutcome,
		op: OpQueueRecord | undefined
	): Promise<void> => {
		const withdrawn = op === undefined;
		if (outcome.kind === 'done') return;
		if (outcome.kind === 'made-folder') {
			const folder = await scope.folders.get([LIBRARY, outcome.path]);
			if (folder !== undefined) {
				await scope.folders.put({ ...folder, remoteId: outcome.remote.remoteId });
			}
			return;
		}
		if (outcome.kind === 'purged') {
			const note = await ownNote(scope, outcome.noteId);
			if (note === undefined) return;
			if (note.deletedLocally === 1) {
				await scope.notes.delete(noteKey(note));
				return;
			}
			// Restored while its delete was on the way. The remote copy is gone,
			// but the passage is the user's again: kept, cut loose from the file,
			// and owed a write that makes the file again.
			const restored: NoteRecord = { ...withoutRemote(note), dirty: 1 };
			await scope.notes.put(restored);
			await queueWrite(scope, restored);
			return;
		}
		if (isFileOutcome(outcome)) {
			await settleFile(scope, outcome, withdrawn);
			return;
		}
		const note = await requireNote(scope, outcome.noteId);
		const remote = {
			remoteId: outcome.remote.remoteId,
			remoteVersion: outcome.remote.version,
		};
		if (outcome.kind === 'moved' && !withdrawn) {
			// Where it landed, which is not always where it was sent: a name the
			// remote would not give up puts the rename beside it.
			await scope.notes.put({ ...note, ...remote, path: outcome.remote.path });
			return;
		}
		if (outcome.kind === 'moved') {
			// Renamed again while this move was on its way.
			const moved: NoteRecord = { ...note, ...remote };
			await scope.notes.put(moved);
			await queueMove(scope, moved, outcome.remote.path);
			return;
		}
		// Written again while the request was in flight — practised, most
		// likely: the remote's bytes are not these, so the passage stays dirty
		// and is owed another write.
		const same = note.source === outcome.content;
		const pushed: NoteRecord = {
			...note,
			...remote,
			// The remote holds these bytes whether or not the passage still does.
			syncedHash: outcome.syncedHash,
			...(same ? { dirty: 0 as const } : {}),
		};
		await scope.notes.put(pushed);
		// As lazy as the write that is landing: a pass made while it was on its
		// way waits for the next sync as the pass before it did. An edit has
		// queued a write that is not lazy already.
		if (!same) await queueWrite(scope, pushed, seq, op?.lazy === true ? 'lazy' : 'soon');
		// Renamed while its write was in flight: the file is where the write put
		// it; the passage stays where the user put it, and moves there.
		if (note.path !== outcome.remote.path) {
			await queueMove(scope, pushed, outcome.remote.path);
		}
	};

	/** The op, or `undefined` if it has been withdrawn. */
	const queuedOp = async (scope: Scope, seq: number): Promise<OpQueueRecord | undefined> => {
		const op = await scope.opQueue.get(seq);
		if (op !== undefined && op.connectionId !== LIBRARY) {
			throw new Error(`Queued op ${String(seq)} is not the library's`);
		}
		return op;
	};

	return {
		cursor: async () => (await db.syncState.get(connectionId))?.cursor,

		noteById: async (id) => {
			const note = await ownNote(db, id);
			return note === undefined ? undefined : toSyncNote(note);
		},

		noteByPath: async (path) => {
			const notes = await db.notes
				.where('[connectionId+path]')
				.equals([LIBRARY, path])
				.toArray();
			// A passage made at a name a tombstone still holds: the live one is
			// the answer. Handing back the tombstone would have a file arriving
			// at that path written into a row its queued delete is about to purge.
			const note = notes.find((each) => each.deletedLocally === 0) ?? notes[0];
			return note === undefined ? undefined : toSyncNote(note);
		},

		noteByRemoteId: async (remoteId) => {
			const notes = await db.notes.where('remoteId').equals(remoteId).toArray();
			const note = notes.find((each) => each.connectionId === LIBRARY);
			return note === undefined ? undefined : toSyncNote(note);
		},

		allNotes: async () => (await notesOf(db)).map(toSyncNote),

		notesUnder: async (folderPath) =>
			(await notesOf(db)).filter((note) => isWithin(note.path, folderPath)).map(toSyncNote),

		folderByRemoteId: async (remoteId) => {
			const folder = (await foldersOf(db)).find((each) => each.remoteId === remoteId);
			return folder === undefined ? undefined : toSyncFolder(folder);
		},

		folderByPath: async (path) => {
			const folder = await db.folders.get([LIBRARY, path]);
			return folder === undefined ? undefined : toSyncFolder(folder);
		},

		foldersWithRemote: async () =>
			(await foldersOf(db))
				.filter((folder) => folder.remoteId !== undefined)
				.map(toSyncFolder),

		unreadable: async () => (await db.syncState.get(connectionId))?.unreadable ?? [],

		fileById: async (id) => {
			const file = await ownFile(db, id);
			return file === undefined ? undefined : toSyncFile(file);
		},

		fileByPath: async (path) => {
			const file = await db.files
				.where('[connectionId+path]')
				.equals([LIBRARY, path])
				.first();
			return file === undefined ? undefined : toSyncFile(file);
		},

		fileByRemoteId: async (remoteId) => {
			const file = await db.files
				.where('[connectionId+remoteId]')
				.equals([LIBRARY, remoteId])
				.first();
			return file === undefined ? undefined : toSyncFile(file);
		},

		allFiles: async () => (await filesOf(db)).map(toSyncFile),

		filesUnder: async (folderPath) =>
			(await filesOf(db)).filter((file) => isWithin(file.path, folderPath)).map(toSyncFile),

		fileBytes: (id) =>
			// One read of the two, so the bytes are judged against the row they
			// were read beside.
			db.transaction('r', db.files, db.fileBytes, async () => {
				const file = await ownFile(db, id);
				const held = await db.fileBytes.get(fileKey(id));
				if (file === undefined || held === undefined || !heldBytesAreCurrent(file, held)) {
					return undefined;
				}
				return new Uint8Array(held.bytes);
			}),

		applyPull: async (batch: PullBatch) => {
			const read = await readAll(batch.changes);
			await inTransaction(async () => {
				// One after another, in the order given: the engine decided each
				// change against the store as the ones before it left it.
				await batch.changes.reduce<Promise<void>>(async (pending, change) => {
					await pending;
					await applyChange(db, change, read);
				}, Promise.resolve());

				if (batch.cursor === undefined) return;
				await db.syncState.update(connectionId, { cursor: batch.cursor });
			});
		},

		pendingOps: async () => (await opsOf(db)).map(toSyncOp).sort((a, b) => a.seq - b.seq),

		opBySeq: async (seq) => {
			const op = await db.opQueue.get(seq);
			return op?.connectionId === LIBRARY ? toSyncOp(op) : undefined;
		},

		completeOp: (seq, outcome) =>
			inTransaction(async () => {
				// Gone is not an error: a change the user made while the op was in
				// flight withdrew it. See `settle`.
				const op = await queuedOp(db, seq);
				await settle(db, seq, outcome, op);
				if (op !== undefined) await db.opQueue.delete(seq);
			}),

		failOp: (seq, error) =>
			inTransaction(async () => {
				const op = await queuedOp(db, seq);
				// Withdrawn while it was failing: there is nothing left to retry.
				if (op === undefined) return;
				await db.opQueue.put({ ...op, attempts: op.attempts + 1, lastError: error });
			}),

		resolveConflict: (seq, resolution) =>
			inTransaction(async () => {
				// Not required to be there: the user can delete the passage while
				// its write is at the network, which withdraws the write. The
				// conflict still lands, and makes no copy for a tombstone.
				await queuedOp(db, seq);
				await applyConflict(db, resolution);
				await db.opQueue.delete(seq);
			}),
	};
};
