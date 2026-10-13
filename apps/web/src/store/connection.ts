import { type ProviderKind } from '@memoriam/core';
import { type PromiseExtended } from 'dexie';

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

/**
 * How many times the library has been bound or let go, here. A sync or a
 * question to the server that began before the count moved is about a binding
 * that has gone, whatever connection is bound now — the same one again
 * included — and its answer is not acted on (`sync/scheduler.ts`,
 * `sync/account.ts`). As skysa-notes counts them.
 */
export const BINDINGS_KEY = 'sync.bindings';

export const bindingCount = (db: Pick<MemoriamDatabase, 'prefs'>): PromiseExtended<number> =>
	db.prefs.get(BINDINGS_KEY).then((record) => Number(record?.value ?? 0));

const countBinding = (db: Pick<MemoriamDatabase, 'prefs'>): PromiseExtended<string> =>
	bindingCount(db).then((count) => db.prefs.put({ key: BINDINGS_KEY, value: String(count + 1) }));

/**
 * Change the binding's row, if the library is still bound to `connectionId`:
 * what a sync learns on its way — a root, when it last pulled, a token — is
 * about that connection, and a row let go of meanwhile must not come back.
 */
export const updateBinding = (
	db: Pick<MemoriamDatabase, 'syncState' | 'transaction'>,
	connectionId: string,
	change: (state: SyncStateRecord) => SyncStateRecord
): Promise<void> =>
	db.transaction('rw', db.syncState, async () => {
		const state = await db.syncState.get(connectionId);
		if (state !== undefined) await db.syncState.put(change(state));
	});

/**
 * What the server says of the account the library is bound to: its id at the
 * provider, and what it is called, each only where it was said. Only if the
 * library is still bound as it was when the server was asked (`since`, from
 * `bindingCount`); answers whether it was.
 */
export const rememberAccount = (
	db: MemoriamDatabase,
	account: {
		connectionId: string;
		accountId?: string | null;
		displayName?: string | null;
		since: number;
	}
): Promise<boolean> =>
	db.transaction('rw', [db.syncState, db.prefs], async () => {
		if ((await bindingCount(db)) !== account.since) return false;
		const state = await db.syncState.get(account.connectionId);
		if (state === undefined) return false;
		const said = <T>(value: T | null | undefined): value is T =>
			value !== null && value !== undefined && value !== '';
		await db.syncState.put({
			...state,
			...(said(account.accountId) ? { accountId: account.accountId } : {}),
			...(said(account.displayName) ? { displayName: account.displayName } : {}),
		});
		return true;
	});

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
		await countBinding(db);

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
 *
 * `only` is for a decision made from a server's answer, about one connection:
 * nothing is let go unless the library is still bound to it, and, given
 * `since`, has not been bound or let go meanwhile. Answers whether the library
 * was let go of.
 */
export const unbindLibrary = (
	db: MemoriamDatabase,
	only?: { connectionId: string; since?: number }
): Promise<boolean> =>
	db.transaction('rw', [...writerTables(db), db.fileBytes, db.prefs], async () => {
		const bound = await boundConnection(db);
		if (only !== undefined) {
			const moved = only.since !== undefined && (await bindingCount(db)) !== only.since;
			if (moved || bound?.connectionId !== only.connectionId) return false;
		}
		if (bound !== undefined) await countBinding(db);
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
		return true;
	});
