import {
	PASSAGE_FORMAT,
	serializePassageFile,
	splitFrontmatter,
	syncsHidden,
} from '@memoriam/core';
import { forgetCredential } from '@skysa/client';
import type { AppSchedulerOptions, ClientDevice } from '@skysa/client/testing';
import { joinPath, parentPath, ROOT } from '@skysa/storage';

import { bindLibrary, unbindLibrary } from '../../src/store/connection.js';
import { LOCAL_CONNECTION_ID, type MemoriamDatabase } from '../../src/store/db.js';
import { createPassage, updatePassage } from '../../src/store/passages.js';
import { queueWrite } from '../../src/store/queue.js';
import { clientStoreOf } from '../../src/sync/dexiePorts.js';
import { createLibraryScheduler } from '../../src/sync/libraryScheduler.js';
import { SYNC_LOCK } from '../../src/sync/lock.js';
import { holdCredential } from './connection.js';
import { watchedDatabase } from './db.js';

/** What this app hands its scheduler of its own. */
const APP: AppSchedulerOptions = { lockName: SYNC_LOCK, document: PASSAGE_FORMAT, syncsHidden };

/** Where the library's rows are, whatever connection it syncs with. */
const LIBRARY = LOCAL_CONNECTION_ID;

/** A passage's file holding `body`, claiming `id` where one is given. */
const passageOf = (body: string, id?: string): string =>
	serializePassageFile({ frontmatter: null, body, metadata: id === undefined ? {} : { id } });

const passageById = async (db: MemoriamDatabase, id: string) => {
	const row = await db.notes.get([LIBRARY, id]);
	if (row === undefined) throw new Error(`No passage with id ${id}`);
	return row;
};

/**
 * A change to a passage's words made the way practice makes one: the file
 * written and its write queued lazily (`queuePracticeWrite`), so that it goes
 * with the next sync.
 */
const lazily = (db: MemoriamDatabase, id: string, body: string): Promise<void> =>
	db.transaction('rw', db.notes, db.opQueue, db.syncState, async () => {
		const row = await passageById(db, id);
		const written = {
			...row,
			source: serializePassageFile({
				frontmatter: splitFrontmatter(row.source).frontmatter,
				body,
				metadata: {},
			}),
			dirty: 1 as const,
		};
		await db.notes.put(written);
		await queueWrite(db, written, undefined, 'lazy');
	});

/**
 * A device over this app's database, fresh for each call: the client's
 * suites (`ClientDevice`, `@skysa/client/testing`) run over it as the app runs
 * them, through the ports in `sync/dexiePorts.ts` and with the app's own
 * scheduler (`sync/libraryScheduler.ts`). A document is a passage, made and
 * edited as the library makes and edits one, and so is one another device
 * writes (`written`). Memoriam has one library, so whatever connection a suite
 * names, the rows are the library's, under `LOCAL_CONNECTION_ID`, and only the
 * connection it is bound to is shown. The database is watched, as the app's
 * is.
 */
export const dexieDevice = (): ClientDevice => {
	const db = watchedDatabase();
	return {
		store: clientStoreOf(db),
		app: APP,
		written: passageOf,
		schedule: (options) => createLibraryScheduler(db, options),
		create: async (_connectionId, name, body) => {
			const passage = await createPassage(db, {
				title: name,
				reference: '',
				collection: ROOT,
				text: body,
			});
			return { id: passage.id, path: passage.path };
		},
		edit: async (_connectionId, id, body, { lazy = false } = {}) => {
			if (lazy) {
				await lazily(db, id, body);
				return;
			}
			const row = await passageById(db, id);
			const edited = await updatePassage(db, id, {
				title: row.title,
				reference: row.reference ?? '',
				collection: parentPath(row.path),
				text: body,
			});
			if (!edited.ok) throw new Error(`Passage ${id} was not edited: ${edited.reason}`);
		},
		attach: async (_connectionId, documentId, name, bytes) => {
			// This app adds no file beside a passage; what adding one would do
			// stands in: its row, its bytes held until they are up, and its upload
			// queued.
			const passage = await passageById(db, documentId);
			const id = crypto.randomUUID();
			const path = joinPath(parentPath(passage.path), name);
			await db.transaction('rw', db.files, db.fileBytes, db.opQueue, async () => {
				await db.files.add({ connectionId: LIBRARY, id, path, size: bytes.byteLength });
				await db.fileBytes.add({
					connectionId: LIBRARY,
					id,
					bytes: bytes.buffer,
					pinned: 1,
					lastUsedAt: 0,
				});
				await db.opQueue.add({
					connectionId: LIBRARY,
					op: 'upload',
					fileId: id,
					path,
					attempts: 0,
					queuedAt: 0,
				});
			});
		},
		queued: async () =>
			(await db.opQueue.where('connectionId').equals(LIBRARY).sortBy('seq')).map((op) => ({
				seq: op.seq ?? 0,
				lazy: op.lazy === true,
			})),
		lastSyncAt: async (connectionId) => (await db.syncState.get(connectionId))?.lastSyncAt,
		bind: async (connectionId, credential) => {
			await bindLibrary(db, { connectionId, provider: 'dropbox' });
			await holdCredential(db, connectionId, credential === undefined ? {} : { credential });
		},
		show: async (connectionId) => {
			// The library shows the connection it is bound to, and no other.
			if ((await db.syncState.get(connectionId)) === undefined) {
				throw new Error(`The library is not bound to ${connectionId}, so cannot show it`);
			}
		},
		queue: (_connectionId, op, { lazy = false } = {}) =>
			db.opQueue.add({
				...op,
				connectionId: LIBRARY,
				attempts: 0,
				queuedAt: 0,
				...(lazy ? { lazy: true as const } : {}),
			}),
		keptToken: async (connectionId) => {
			const state = await db.syncState.get(connectionId);
			return state?.accessToken === undefined || state.accessTokenExpiresAt === undefined
				? undefined
				: { accessToken: state.accessToken, expiresAt: state.accessTokenExpiresAt };
		},
		keepElsewhere: async (connectionId, token) => {
			await db.syncState.update(connectionId, {
				accessToken: token.accessToken,
				accessTokenExpiresAt: token.expiresAt,
			});
		},
		letGo: async (connectionId) => {
			// Every passage is kept, unsent work or none: the library is cut loose,
			// never kept detached (`unbindLibrary`).
			await unbindLibrary(db, { connectionId });
			await forgetCredential(db, connectionId);
		},
		reconnect: (connectionId) =>
			// One transaction, which a live query may never show the middle of.
			db.transaction('rw', db.tables, async () => {
				await unbindLibrary(db, { connectionId });
				await bindLibrary(db, { connectionId, provider: 'dropbox' });
				await holdCredential(db, connectionId);
			}),
		connection: async (connectionId) =>
			(await db.syncState.get(connectionId)) === undefined ? undefined : 'live',
		importing: () => Promise.resolve(false),
		holdUp: () =>
			Promise.reject(new Error('Memoriam does not follow another tab’s transactions')),
		dropCredential: async (connectionId) => {
			await db.credentials.delete(connectionId);
		},
	};
};
