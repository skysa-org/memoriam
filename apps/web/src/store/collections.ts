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
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
} from './db.js';
import { restorePassages } from './passages.js';

/**
 * Collections: the folders of the library (docs/ARCHITECTURE.md §3). One is
 * named as the user typed it, less only what a provider would refuse
 * (`sanitizeFolderName`), and kept as a row of its own so it outlives the last
 * passage taken out of it.
 *
 * Every writer here is one transaction: a name is checked against those taken
 * and claimed in the same breath, and a rename moves a collection's passages
 * with it or not at all.
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
	const notes = await db.notes.where('connectionId').equals(connectionId).toArray();
	return [
		...folders.map((folder) => folder.path),
		...notes.map((note) => parentPath(note.path)).filter((path) => path !== ROOT),
	];
};

/** The collection already at `path`, however it spells the name. */
const takenBy = (paths: readonly string[], path: string): string | undefined =>
	paths.find((each) => foldName(each) === foldName(path));

/**
 * A row for each of `paths` and each collection above them, where there is none
 * yet. For a writer already in a transaction over `folders`.
 */
export const ensureCollections = async (
	db: MemoriamDatabase,
	paths: readonly string[],
	connectionId: string,
	now: number
): Promise<void> => {
	const wanted = [
		...new Set(paths.flatMap((path) => [...ancestorPaths(path), normalizePath(path)])),
	].filter((each) => each !== ROOT);
	const have = await db.folders.bulkGet(wanted.map((each) => [connectionId, each]));
	const missing = wanted.filter((_, at) => have[at] === undefined);
	await db.folders.bulkAdd(missing.map((each) => ({ connectionId, path: each, createdAt: now })));
};

export const createCollection = (
	db: MemoriamDatabase,
	name: string,
	{ connectionId = LOCAL_CONNECTION_ID }: CollectionScope = {},
	now: number = Date.now()
): Promise<Named> =>
	db.transaction('rw', db.folders, db.notes, async () => {
		const path = collectionPath(name);
		const existing = takenBy(await takenPaths(db, connectionId), path);
		if (existing !== undefined) return { ok: false, reason: 'exists', path: existing } as const;
		await ensureCollections(db, [path], connectionId, now);
		return { ok: true, path } as const;
	});

/**
 * Give a collection a new name, and move every passage in it there. Only the
 * paths change: a passage's file says nothing of where it is, so neither its
 * text nor its `updated` moves.
 */
export const renameCollection = (
	db: MemoriamDatabase,
	from: string,
	name: string,
	{ connectionId = LOCAL_CONNECTION_ID }: CollectionScope = {}
): Promise<Named> =>
	db.transaction('rw', db.folders, db.notes, async () => {
		const to = collectionPath(name);
		if (to === from) return { ok: true, path: to } as const;
		// The same name in other letters is this collection, and may be respelled.
		const others = (await takenPaths(db, connectionId)).filter((path) => !isWithin(path, from));
		const existing = takenBy(others, to);
		if (existing !== undefined) return { ok: false, reason: 'exists', path: existing } as const;

		const folders = (
			await db.folders.where('connectionId').equals(connectionId).toArray()
		).filter((folder) => isWithin(folder.path, from));
		const notes = (await db.notes.where('connectionId').equals(connectionId).toArray()).filter(
			(note) => isWithin(note.path, from)
		);
		await db.folders.bulkDelete(folders.map((folder) => [connectionId, folder.path]));
		await db.folders.bulkPut(
			folders.map((folder) => ({ ...folder, path: rebasePath(folder.path, from, to) }))
		);
		await db.notes.bulkPut(
			notes.map((note) => ({ ...note, path: rebasePath(note.path, from, to), dirty: 1 }))
		);
		return { ok: true, path: to } as const;
	});

/** What deleting a collection took, for its undo to put back. */
export interface RemovedCollection {
	readonly path: string;
	readonly folders: readonly FolderRecord[];
	readonly passages: readonly NoteRecord[];
}

/** Delete a collection and every passage in it. Undone by `restoreCollection`. */
export const deleteCollection = (
	db: MemoriamDatabase,
	path: string,
	{ connectionId = LOCAL_CONNECTION_ID }: CollectionScope = {}
): Promise<RemovedCollection> =>
	db.transaction('rw', db.folders, db.notes, async () => {
		const folders = (
			await db.folders.where('connectionId').equals(connectionId).toArray()
		).filter((folder) => isWithin(folder.path, path));
		const passages = (
			await db.notes.where('connectionId').equals(connectionId).toArray()
		).filter((note) => isWithin(note.path, path));
		await db.folders.bulkDelete(folders.map((folder) => [connectionId, folder.path]));
		await db.notes.bulkDelete(passages.map((note) => [note.connectionId, note.id]));
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
	db.transaction('rw', db.folders, db.notes, async () => {
		const existing = await db.folders.bulkGet(
			removed.folders.map((folder) => [folder.connectionId, folder.path])
		);
		await db.folders.bulkAdd(removed.folders.filter((_, at) => existing[at] === undefined));
		await restorePassages(db, removed.passages);
	});
