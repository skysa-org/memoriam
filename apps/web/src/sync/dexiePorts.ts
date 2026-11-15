import type { ClientStore, TokenStates } from '@skysa/client';
import { liveQuery } from 'dexie';

import { bindingCount, boundConnection, updateBinding } from '../store/connection.js';
import { LOCAL_CONNECTION_ID, type MemoriamDatabase } from '../store/db.js';
import { MAX_OP_ATTEMPTS, outOfAttempts } from '../store/queue.js';
import { rowsOf } from '../store/rows.js';
import { createDexieSyncStore, toSyncOp } from './store.js';

/**
 * The sync client's ports, over this app's database. The client is the shared
 * kit's (`@skysa/client`) and reaches IndexedDB only through ports
 * (skysa-notes' record 0018); the tables they are made over, and these, are
 * the app's. The scheduler is handed `clientStoreOf`, which carries the rest.
 * The credentials need no adapter: the database fits `CredentialStore` as it
 * is.
 *
 * Memoriam has one library, bound to one connection at a time
 * (`store/connection.ts`), so what the kit asks of several sources is simpler
 * here: the source shown is the binding, none is ever kept detached, there is
 * no resume to verify and no first import to finish, and no tab's reads wait
 * on another's. The connection's `syncState` row is keyed by its id; the
 * library's rows, its queue among them, stay under `LOCAL_CONNECTION_ID`
 * whatever it is bound to (`sync/store.ts`), so the queue a port reads is the
 * library's. The scheduler only ever asks about the connection it is shown,
 * which is the binding.
 */

/** Where the library's rows are, whatever connection it syncs with. */
const LIBRARY = LOCAL_CONNECTION_ID;

/**
 * The binding's token, kept on its `syncState` row so a reload need not ask
 * the server again. Written only while the library is still bound to the
 * connection (`updateBinding`): one let go while its token was on the way has
 * no row and must not get one back.
 */
const tokenStatesOf = (db: MemoriamDatabase): TokenStates => ({
	read: async (connectionId) => {
		const state = await db.syncState.get(connectionId);
		const token =
			state?.accessToken === undefined || state.accessTokenExpiresAt === undefined
				? undefined
				: { accessToken: state.accessToken, expiresAt: state.accessTokenExpiresAt };
		return { detached: false, token };
	},
	keep: (connectionId, token) =>
		updateBinding(
			db,
			connectionId,
			({ accessToken: _token, accessTokenExpiresAt: _expiry, ...rest }) =>
				token === undefined
					? rest
					: {
							...rest,
							accessToken: token.accessToken,
							accessTokenExpiresAt: token.expiresAt,
						}
		),
});

/** Every op gets its attempts back. Inside a transaction. */
const resetAttempts = async (db: MemoriamDatabase): Promise<void> => {
	const tried = await rowsOf(db.opQueue, LIBRARY)
		.filter((op) => op.attempts > 0)
		.toArray();
	await db.opQueue.bulkPut(tried.map((op) => ({ ...op, attempts: 0 })));
};

/** Follow a live query until told to stop. */
const watching = <T>(query: () => Promise<T>, next: (value: T) => void): (() => void) => {
	const subscription = liveQuery(query).subscribe({ next });
	return () => {
		subscription.unsubscribe();
	};
};

/**
 * The scheduler's side of the device (`ClientStore`), over the tables the app
 * owns: the binding's `syncState` row, its queue and its store.
 */
export const clientStoreOf = (db: MemoriamDatabase): ClientStore => ({
	watchShown: (next) =>
		watching(
			() => boundConnection(db),
			(state) => {
				next(
					state === undefined
						? undefined
						: {
								connectionId: state.connectionId,
								provider: state.provider,
								clientId: state.clientId,
								lastSyncAt: state.lastSyncAt,
								detached: false,
							}
				);
			}
		),
	bindings: () => bindingCount(db),
	verifyResume: () => Promise.resolve({ superseded: false }),
	needsRoot: async (connectionId) => {
		const state = await db.syncState.get(connectionId);
		return state !== undefined && state.rootId === undefined;
	},
	keepRoot: (connectionId, rootId) =>
		updateBinding(db, connectionId, (bound) => ({ ...bound, rootId })),
	pulled: (connectionId, at) =>
		updateBinding(db, connectionId, (bound) => ({ ...bound, lastSyncAt: at })),
	finishImport: () => Promise.resolve(),
	rescan: (connectionId) =>
		// One transaction: the cursor and the attempts go together, so a scan
		// about to run cannot start against a half-reset queue.
		db.transaction('rw', db.syncState, db.opQueue, async () => {
			const state = await db.syncState.get(connectionId);
			// Let go of meanwhile: there is nothing to re-scan, and a `put` would
			// bring the row back.
			if (state === undefined) return;
			// `rootId` is kept: it is the same folder, and finding it again costs
			// a search whose answer is already here.
			const { cursor: _cursor, ...kept } = state;
			await db.syncState.put(kept);
			await resetAttempts(db);
		}),
	releaseOps: () =>
		// One transaction, so an op the engine completes meanwhile is not put back.
		db.transaction('rw', db.opQueue, () => resetAttempts(db)),
	failingOps: async (_connectionId, maxAttempts) => {
		const failing = await rowsOf(db.opQueue, LIBRARY)
			.filter((op) => outOfAttempts(op, maxAttempts))
			.toArray();
		return failing.map((row) => ({ op: toSyncOp(row), lastError: row.lastError }));
	},
	watchQueue: (_connectionId, next) =>
		watching(() => rowsOf(db.opQueue, LIBRARY).primaryKeys(), next),
	queuedAfter: (_connectionId, seq) =>
		// By the key, since it is asked after every op queued: a practice
		// session queues one every few seconds, and the queue may hold the whole
		// library just after it is bound.
		db.opQueue
			.where('seq')
			.above(seq)
			.filter((op) => op.connectionId === LIBRARY)
			.toArray(),
	syncStore: (connectionId) => createDexieSyncStore(db, { connectionId }),
	credentials: db,
	tokens: tokenStatesOf(db),
	heldUp: () => undefined,
	maxAttempts: MAX_OP_ATTEMPTS,
});
