import { useLiveQuery } from 'dexie-react-hooks';

import {
	db as defaultDb,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
} from './db.js';
import { type LibraryView, libraryView } from './library.js';

/**
 * The store, as components read it: live, so a write anywhere — this tab or
 * another — is on screen without anyone asking. `undefined` while the first
 * answer is on its way.
 */

export const useLibrary = (
	db: MemoriamDatabase = defaultDb,
	connectionId: string = LOCAL_CONNECTION_ID
): LibraryView | undefined =>
	useLiveQuery(async () => {
		const notes = await db.notes.where('connectionId').equals(connectionId).toArray();
		const folders = await db.folders.where('connectionId').equals(connectionId).toArray();
		return libraryView(notes, folders);
	}, [db, connectionId]);

/** A passage by id, or `null` when there is none: deleted, or never was. */
export const usePassage = (
	id: string,
	db: MemoriamDatabase = defaultDb,
	connectionId: string = LOCAL_CONNECTION_ID
): NoteRecord | null | undefined =>
	useLiveQuery(
		async () => (await db.notes.get([connectionId, id])) ?? null,
		[db, connectionId, id]
	);
