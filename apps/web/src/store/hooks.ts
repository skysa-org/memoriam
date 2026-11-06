import { useLiveQuery } from 'dexie-react-hooks';

import { useDb } from './database.js';
import { LOCAL_CONNECTION_ID, type NoteRecord } from './db.js';
import { type LibraryView, libraryView } from './library.js';
import { rowsOf } from './rows.js';
import { isLive } from './rowStates.js';

/**
 * The store, as components read it: live, so a write anywhere — this tab or
 * another — is on screen without anyone asking. `undefined` while the first
 * answer is on its way.
 *
 * Each reads the database it is drawn over (`useDb`), which does not change
 * under it: a provider given another draws what it holds afresh
 * (`DatabaseProvider`).
 */

export const useLibrary = (connectionId: string = LOCAL_CONNECTION_ID): LibraryView | undefined => {
	const db = useDb();
	return useLiveQuery(async () => {
		const notes = await rowsOf(db.notes, connectionId).filter(isLive).toArray();
		const folders = await rowsOf(db.folders, connectionId).toArray();
		return libraryView(notes, folders);
	}, [db, connectionId]);
};

/** A passage by id, or `null` when there is none: deleted, or never was. */
export const usePassage = (
	id: string,
	connectionId: string = LOCAL_CONNECTION_ID
): NoteRecord | null | undefined => {
	const db = useDb();
	return useLiveQuery(async () => {
		const row = await db.notes.get([connectionId, id]);
		// A tombstone is deleted, as far as anything shown is concerned.
		return row !== undefined && isLive(row) ? row : null;
	}, [db, connectionId, id]);
};
