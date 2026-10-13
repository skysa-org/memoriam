import {
	ancestorPaths,
	foldName,
	isWithin,
	normalizePath,
	parentPath,
	rebasePath,
	ROOT,
	sanitizeFolderName,
} from '@memoriam/core';

import { t } from '../i18n/t.js';
import {
	type FolderRecord,
	isLive,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
	writerTables,
} from './db.js';
import { buryOrDrop, restorePassages } from './passages.js';
import { queueMkdir, queueMove, queueMoveFile, queueRmdir, withdrawMkdirs } from './queue.js';

/**
 * Collections: the folders of the library (docs/ARCHITECTURE.md §3). One is
 * named as the user typed it, less only what a provider would refuse
 * (`sanitizeFolderName`), and kept as a row of its own so it outlives the last
 * passage taken out of it.
 *
 * Every writer here is one transaction: a name is checked against those taken
 * and claimed in the same breath, and a rename moves a collection's passages
 * with it or not at all. What the remote is owed is queued in the same
 * transaction (`store/queue.ts`), in skysa-notes' order: a collection's
 * `mkdir` before anything goes into it, and an `rmdir` behind the moves and
 * deletes that empty it.
 */

export interface CollectionScope {
	connectionId?: string;
}

/** What naming a collection came to. */
export type Named =
	| Readonly<{ ok: true; path: string }>
	/** Another collection, at `path`, already has the name, as a provider compares names. */
	| Readonly<{ ok: false; reason: 'exists'; path: string }>;

/** A collection's path for the name the user typed. One level: a name has no `/`. */
export const collectionPath = (name: string): string =>
	sanitizeFolderName(name, t('library.unnamedCollection'));

/** Every collection there is: the rows, and the folders passages are in. */
const takenPaths = async (db: MemoriamDatabase, connectionId: string): Promise<string[]> => {
	const folders = await db.folders.where('connectionId').equals(connectionId).toArray();
	const notes = (await db.notes.where('connectionId').equals(connectionId).toArray()).filter(
		isLive
	);
	return [
		...folders.map((folder) => folder.path),
		...notes.map((note) => parentPath(note.path)).filter((path) => path !== ROOT),
	];
};

/** The collection already at `path`, however it spells the name. */
const takenBy = (paths: readonly string[], path: string): string | undefined =>
	paths.find((each) => foldName(each) === foldName(path));

/** Outermost first: a collection's `mkdir` before any inside it. */
const outermostFirst = (a: string, b: string): number => a.split('/').length - b.split('/').length;

/** Each path's `mkdir`, outermost first. */
const queueMkdirs = (db: MemoriamDatabase, connectionId: string, paths: readonly string[]) =>
	[...paths].sort(outermostFirst).reduce<Promise<void>>(async (pending, path) => {
		await pending;
		await queueMkdir(db, connectionId, path);
	}, Promise.resolve());

/** Each folder's `rmdir`, outermost first: removing one takes those inside, which find nothing. */
const queueRmdirs = (
	db: MemoriamDatabase,
	connectionId: string,
	folders: readonly FolderRecord[]
) =>
	[...folders]
		.sort((a, b) => outermostFirst(a.path, b.path))
		.reduce<Promise<void>>(async (pending, folder) => {
			await pending;
			await queueRmdir(db, connectionId, folder.path, folder.remoteId);
		}, Promise.resolve());

/**
 * A row for each of `paths` and each collection above them, where there is none
 * yet; answers the paths it made, whose `mkdir` the caller owes. For a writer
 * already in a transaction over `writerTables`.
 */
export const addCollections = async (
	db: MemoriamDatabase,
	paths: readonly string[],
	connectionId: string,
	now: number
): Promise<string[]> => {
	const wanted = [
		...new Set(paths.flatMap((path) => [...ancestorPaths(path), normalizePath(path)])),
	].filter((each) => each !== ROOT);
	const have = await db.folders.bulkGet(wanted.map((each) => [connectionId, each]));
	const missing = wanted.filter((_, at) => have[at] === undefined);
	await db.folders.bulkAdd(missing.map((each) => ({ connectionId, path: each, createdAt: now })));
	return missing;
};

/** `addCollections`, and the `mkdir` of each collection it made. */
export const ensureCollections = async (
	db: MemoriamDatabase,
	paths: readonly string[],
	connectionId: string,
	now: number
): Promise<void> => {
	await queueMkdirs(db, connectionId, await addCollections(db, paths, connectionId, now));
};

export const createCollection = (
	db: MemoriamDatabase,
	name: string,
	{ connectionId = LOCAL_CONNECTION_ID }: CollectionScope = {},
	now: number = Date.now()
): Promise<Named> =>
	db.transaction('rw', writerTables(db), async () => {
		const path = collectionPath(name);
		const existing = takenBy(await takenPaths(db, connectionId), path);
		if (existing !== undefined) return { ok: false, reason: 'exists', path: existing } as const;
		await ensureCollections(db, [path], connectionId, now);
		return { ok: true, path } as const;
	});

/**
 * Give a collection a new name, and move every passage in it there. Only the
 * paths change: a passage's file says nothing of where it is, so neither its
 * text nor its `updated` moves, and it is no more owed a write than it was.
 * Tombstones move too, as skysa-notes' do: one can still be restored.
 *
 * The files sync keeps beside the passages move with them, ahead of them, as
 * the collection's own: left behind, they would hold the old directory open.
 */
export const renameCollection = (
	db: MemoriamDatabase,
	from: string,
	name: string,
	{ connectionId = LOCAL_CONNECTION_ID }: CollectionScope = {}
): Promise<Named> =>
	db.transaction('rw', writerTables(db), async () => {
		const to = collectionPath(name);
		if (to === from) return { ok: true, path: to } as const;
		// The same name in other letters is this collection, and may be respelled.
		const others = (await takenPaths(db, connectionId)).filter((path) => !isWithin(path, from));
		const existing = takenBy(others, to);
		if (existing !== undefined) return { ok: false, reason: 'exists', path: existing } as const;

		const leaving = (
			await db.folders.where('connectionId').equals(connectionId).toArray()
		).filter((folder) => isWithin(folder.path, from));
		// By path, so the moves go in an order that can be told in advance.
		const notes = (await db.notes.where('connectionId').equals(connectionId).toArray())
			.filter((note) => isWithin(note.path, from))
			.sort((a, b) => a.path.localeCompare(b.path));
		const files = (await db.files.where('connectionId').equals(connectionId).toArray()).filter(
			(file) => isWithin(file.path, from)
		);
		await db.folders.bulkDelete(leaving.map((folder) => [connectionId, folder.path]));
		// Without their `remoteId`: the directory that id names is still at the
		// old path until the queued moves have run.
		const arrived = leaving.map(({ remoteId: _remoteId, ...folder }) => ({
			...folder,
			path: rebasePath(folder.path, from, to),
		}));
		await db.folders.bulkPut(arrived);
		await queueMkdirs(
			db,
			connectionId,
			arrived.map((folder) => folder.path)
		);

		const carried = files.map((file) => ({ ...file, path: rebasePath(file.path, from, to) }));
		await db.files.bulkPut(carried);
		await carried.reduce<Promise<void>>(async (pending, file, at) => {
			await pending;
			await queueMoveFile(db, file, files[at]?.path ?? file.path);
		}, Promise.resolve());

		const moved = notes.map((note) => ({ ...note, path: rebasePath(note.path, from, to) }));
		await db.notes.bulkPut(moved);
		await moved.reduce<Promise<void>>(async (pending, note, at) => {
			await pending;
			await queueMove(db, note, notes[at]?.path ?? note.path);
		}, Promise.resolve());

		// One never sent leaves no directory to remove; and last, every one
		// left, behind the moves that empty it.
		await withdrawMkdirs(db, connectionId, from);
		await queueRmdirs(db, connectionId, leaving);
		return { ok: true, path: to } as const;
	});

/** What deleting a collection took, for its undo to put back. */
export interface RemovedCollection {
	readonly path: string;
	readonly folders: readonly FolderRecord[];
	readonly passages: readonly NoteRecord[];
}

/**
 * Delete a collection and every passage in it. Undone by `restoreCollection`.
 *
 * Only the passages. A file sync keeps beside them (§10, "Files, kept
 * dormant") is the user's, and nothing here shows it, so nothing here deletes
 * it: its directory stays on the remote while it holds one, and the engine
 * leaves a directory that holds a file standing.
 */
export const deleteCollection = (
	db: MemoriamDatabase,
	path: string,
	{ connectionId = LOCAL_CONNECTION_ID }: CollectionScope = {}
): Promise<RemovedCollection> =>
	db.transaction('rw', writerTables(db), async () => {
		const folders = (
			await db.folders.where('connectionId').equals(connectionId).toArray()
		).filter((folder) => isWithin(folder.path, path));
		const passages = (await db.notes.where('connectionId').equals(connectionId).toArray())
			.filter(isLive)
			.filter((note) => isWithin(note.path, path));
		await db.folders.bulkDelete(folders.map((folder) => [connectionId, folder.path]));
		await buryOrDrop(db, passages);
		await withdrawMkdirs(db, connectionId, path);
		await queueRmdirs(db, connectionId, folders);
		return { path, folders, passages };
	});

/**
 * Put back what `deleteCollection` took. A collection made under the same name
 * in the meantime takes the passages in with its own; one of them whose name is
 * taken there now is given the next free one, as anything added is.
 */
export const restoreCollection = (
	db: MemoriamDatabase,
	removed: RemovedCollection
): Promise<void> =>
	db.transaction('rw', writerTables(db), async () => {
		const existing = await db.folders.bulkGet(
			removed.folders.map((folder) => [folder.connectionId, folder.path])
		);
		// Cut loose: the `rmdir` may have run. If it has not, the `mkdir`
		// withdraws it, and finds the directory still there.
		const back = removed.folders
			.filter((_, at) => existing[at] === undefined)
			.map(({ remoteId: _remoteId, ...folder }) => folder);
		await db.folders.bulkAdd(back);
		await queueMkdirs(
			db,
			removed.folders[0]?.connectionId ?? LOCAL_CONNECTION_ID,
			back.map((folder) => folder.path)
		);
		await restorePassages(db, removed.passages);
	});
