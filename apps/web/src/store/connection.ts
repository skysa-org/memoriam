import { type ProviderKind } from '@memoriam/core';

import {
	isLive,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
	type SyncStateRecord,
	writerTables,
} from './db.js';
import { deviceId } from './device.js';
import { queueByNotebook } from './queue.js';

/**
 * Binding the library to a connection, and letting it go (docs/ARCHITECTURE.md
 * §10, "The web store").
 *
 * skysa-notes connects sources: each is a silo of its own, the device's own
 * pile is copied into the first, and one let go keeps only what it never sent.
 * Memoriam has one library, so a connection is where that library syncs to:
 * binding queues the whole of it for the remote, and unbinding cuts it loose,
 * every passage kept. Neither touches a passage's file.
 *
 * Each is one transaction over every table a writer uses, so a write is queued
 * wholly before or wholly after, and a store made for the connection (sync's)
 * checks the binding in its own transactions.
 */

/** The library is bound to a connection already: let that one go first. */
export class AlreadyBoundError extends Error {
	override readonly name = 'AlreadyBoundError';

	constructor(readonly connectionId: string) {
		super(`The library already syncs with connection ${connectionId}`);
	}
}

export interface Binding {
	/** The id `apps/api` gave the connection. */
	readonly connectionId: string;
	readonly provider: ProviderKind;
	readonly accountId?: string;
	readonly displayName?: string;
}

/** The connection the library is bound to, if any. */
export const boundConnection = async (
	db: Pick<MemoriamDatabase, 'syncState'>
): Promise<SyncStateRecord | undefined> => (await db.syncState.toArray())[0];

/** Cut loose from the remote: nothing it says about a file is true once the binding has gone. */
const loose = ({
	remoteId: _remoteId,
	remoteVersion: _remoteVersion,
	syncedHash: _syncedHash,
	...row
}: NoteRecord): NoteRecord => row;

/**
 * Bind the library to a connection, and queue everything it has for it,
 * collection by collection: the first sync then pulls what the remote has and
 * sends the rest. A passage the remote has too is merged on that pull (§10,
 * "Merge before a conflict copy"), or kept twice where the two differ in their
 * words. Binding again to the connection it is bound to does nothing.
 */
export const bindLibrary = (
	db: MemoriamDatabase,
	binding: Binding,
	now: number = Date.now()
): Promise<SyncStateRecord> =>
	db.transaction('rw', [...writerTables(db), db.prefs], async () => {
		const bound = await boundConnection(db);
		if (bound?.connectionId === binding.connectionId) return bound;
		if (bound !== undefined) throw new AlreadyBoundError(bound.connectionId);

		const state: SyncStateRecord = {
			connectionId: binding.connectionId,
			provider: binding.provider,
			...(binding.accountId === undefined ? {} : { accountId: binding.accountId }),
			...(binding.displayName === undefined ? {} : { displayName: binding.displayName }),
			clientId: await deviceId(db),
			boundAt: now,
		};
		await db.syncState.add(state);

		// Unbound, nothing was queued and nothing was buried (`store/queue.ts`):
		// every row is a live one the remote has never seen, and owed.
		const notes = (
			await db.notes.where('connectionId').equals(LOCAL_CONNECTION_ID).toArray()
		).filter(isLive);
		const owed = notes.map((note) => ({ ...loose(note), dirty: 1 as const }));
		await db.notes.bulkPut(owed);
		const folders = await db.folders
			.where('connectionId')
			.equals(LOCAL_CONNECTION_ID)
			.toArray();
		await queueByNotebook(db, LOCAL_CONNECTION_ID, {
			folders: folders.map((folder) => folder.path),
			notes: owed,
		});
		return state;
	});

/**
 * Let the connection go, and keep the library as it is here. Everything the
 * remote was owed is forgotten: there is nowhere to send it, and binding again
 * queues the whole library afresh. A passage deleted here and not yet deleted
 * there goes for good, here; the remote keeps its file, which a later binding
 * to the same account brings back.
 *
 * The files sync kept beside the passages go with the binding: they were the
 * remote's, and nothing here ever held their bytes.
 */
export const unbindLibrary = (db: MemoriamDatabase): Promise<void> =>
	db.transaction('rw', [...writerTables(db), db.fileBytes], async () => {
		await db.syncState.clear();
		await db.opQueue.where('connectionId').equals(LOCAL_CONNECTION_ID).delete();

		const notes = await db.notes.where('connectionId').equals(LOCAL_CONNECTION_ID).toArray();
		await db.notes.bulkDelete(
			notes.filter((note) => !isLive(note)).map((note) => [note.connectionId, note.id])
		);
		await db.notes.bulkPut(notes.filter(isLive).map(loose));

		const folders = await db.folders
			.where('connectionId')
			.equals(LOCAL_CONNECTION_ID)
			.toArray();
		await db.folders.bulkPut(folders.map(({ remoteId: _remoteId, ...folder }) => folder));

		await db.files.where('connectionId').equals(LOCAL_CONNECTION_ID).delete();
		await db.fileBytes.where('connectionId').equals(LOCAL_CONNECTION_ID).delete();
	});
