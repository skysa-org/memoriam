import {
	chunkPassage,
	contentHash,
	createFakeProvider,
	createSyncEngine,
	type FakeProvider,
	mergeFile,
	parsePassageFile,
	readProgress,
	type RemoteEntry,
} from '@memoriam/core';
import { afterEach, describe, expect, it } from 'vitest';

// The suite lives beside the port it checks, in `packages/core`, and is not a
// `*.test.ts` there so that it runs only where a store registers it. `core`
// cannot import `apps/*`, so this store registers here instead.
import { describeSyncStoreContract } from '../../../packages/core/tests/sync/storeContract.js';
import { createDatabase, LOCAL_CONNECTION_ID, type MemoriamDatabase } from '../src/store/db.js';
import { createPassage, deletePassage, pulledRow } from '../src/store/passages.js';
import { recordPass } from '../src/store/practice.js';
import { createDexieSyncStore, UnboundConnectionError } from '../src/sync/store.js';

const CONNECTION = 'dropbox-1';

const opened: MemoriamDatabase[] = [];

afterEach(async () => {
	await Promise.all(opened.splice(0).map((db) => db.delete()));
});

/** A database of its own for every test, so nothing leaks between them. */
const freshDatabase = (): MemoriamDatabase => {
	const db = createDatabase(`sync-store-${crypto.randomUUID()}`);
	opened.push(db);
	return db;
};

/** The library bound to `CONNECTION`, and a store for it: the only kind that writes. */
const boundStore = async (db: MemoriamDatabase) => {
	await db.syncState.put({ connectionId: CONNECTION, clientId: 'this-browser', boundAt: 0 });
	return createDexieSyncStore(db, { connectionId: CONNECTION, now: () => 0 });
};

describeSyncStoreContract('Dexie', async () => {
	const db = freshDatabase();
	const store = await boundStore(db);
	return {
		store,
		seed: async (note) => {
			await db.notes.put({
				...pulledRow({
					id: note.id,
					connectionId: LOCAL_CONNECTION_ID,
					path: note.path,
					source: note.content,
					existing: undefined,
					now: 0,
				}),
				...(note.remoteId === undefined ? {} : { remoteId: note.remoteId }),
				...(note.remoteVersion === undefined ? {} : { remoteVersion: note.remoteVersion }),
				...(note.syncedHash === undefined ? {} : { syncedHash: note.syncedHash }),
				dirty: note.dirty === true ? 1 : 0,
			});
		},
		// Nothing here holds rows for anything but the library; a row under
		// another id is the nearest there is.
		seedElsewhere: async (id) => {
			await db.notes.put(
				pulledRow({
					id,
					connectionId: 'elsewhere',
					path: 'theirs.md',
					source: 'theirs\n',
					existing: undefined,
					now: 0,
				})
			);
		},
		seedFolder: async (folder) => {
			await db.folders.put({ connectionId: LOCAL_CONNECTION_ID, createdAt: 0, ...folder });
		},
		seedFile: async (file, held) => {
			await db.files.put({ connectionId: LOCAL_CONNECTION_ID, ...file });
			if (held === undefined) return;
			await db.fileBytes.put({
				connectionId: LOCAL_CONNECTION_ID,
				id: file.id,
				bytes: held.bytes.slice().buffer,
				...(held.version === undefined ? {} : { version: held.version }),
				pinned: held.pinned === true ? 1 : 0,
				lastUsedAt: 0,
			});
		},
		dropFile: async (id) => {
			await db.files.delete([LOCAL_CONNECTION_ID, id]);
			await db.fileBytes.delete([LOCAL_CONNECTION_ID, id]);
		},
		seedOp: async (op) => {
			// In the app a queued delete always comes with its tombstone.
			if (op.op === 'delete' && op.noteId !== undefined) {
				await db.notes.update([LOCAL_CONNECTION_ID, op.noteId], {
					deletedLocally: 1,
					dirty: 1,
				});
			}
			return db.opQueue.add({
				connectionId: LOCAL_CONNECTION_ID,
				attempts: 0,
				queuedAt: 0,
				...op,
			});
		},
		withdrawOp: (seq) => db.opQueue.delete(seq),
	};
});

const remote = (path: string, version = 'v2'): RemoteEntry => ({
	remoteId: 'r1',
	path,
	kind: 'file',
	version,
	modifiedAt: '2026-10-13T09:00:00.000Z',
	size: 1,
});

const BODY = '\nJesus wept.\n\nRejoice always.\n';
const [FIRST = '', SECOND = ''] = chunkPassage(BODY, 1)?.chunks.map((chunk) => chunk.key) ?? [];

const passage = (progress: string, updated = '2026-10-01T09:00:00Z') =>
	`---\nid: p1\ntitle: Two verses\ncreated: 2026-10-01T09:00:00Z\nupdated: ${updated}\nchunker: 1\n${progress}---\n${BODY}`;

describe('the Dexie sync store, beyond the contract', () => {
	it('writes nothing once the library is bound to another connection, or none', async () => {
		const db = freshDatabase();
		const store = await boundStore(db);
		await db.syncState.delete(CONNECTION);
		await db.syncState.put({ connectionId: 'gdrive-2', clientId: 'this-browser', boundAt: 1 });

		await expect(store.applyPull({ changes: [], cursor: 'c1' })).rejects.toBeInstanceOf(
			UnboundConnectionError
		);
		expect(await db.syncState.get('gdrive-2')).not.toHaveProperty('cursor');
	});

	it('keeps when a passage was edited where a pull brought only practice', async () => {
		const db = freshDatabase();
		const store = await boundStore(db);
		const before = passage('');
		await db.notes.put({
			...pulledRow({
				id: 'p1',
				connectionId: LOCAL_CONNECTION_ID,
				path: 'two.md',
				source: before,
				existing: undefined,
				now: 0,
			}),
			remoteId: 'r1',
			remoteVersion: 'v1',
		});
		const edited = Date.parse('2026-10-01T09:00:00Z');
		expect((await db.notes.get([LOCAL_CONNECTION_ID, 'p1']))?.updatedAt).toBe(edited);

		const practised = passage(`progress:\n  ${FIRST}: { level: 2 }\n`);
		await store.applyPull({
			changes: [
				{
					kind: 'upsert-note',
					id: 'p1',
					path: 'two.md',
					content: practised,
					remote: remote('two.md'),
					syncedHash: await contentHash(practised),
				},
			],
		});
		expect(await db.notes.get([LOCAL_CONNECTION_ID, 'p1'])).toMatchObject({
			source: practised,
			updatedAt: edited,
		});

		const reworded = passage('', '2026-10-12T09:00:00Z').replace('Jesus wept.', 'Jesus wept!');
		await store.applyPull({
			changes: [
				{
					kind: 'upsert-note',
					id: 'p1',
					path: 'two.md',
					content: reworded,
					remote: remote('two.md', 'v3'),
					syncedHash: await contentHash(reworded),
				},
			],
		});
		expect((await db.notes.get([LOCAL_CONNECTION_ID, 'p1']))?.updatedAt).toBe(
			Date.parse('2026-10-12T09:00:00Z')
		);
	});
});

describe('the engine over the Dexie store', () => {
	const sync = (db: MemoriamDatabase, provider: FakeProvider) =>
		createSyncEngine({
			provider,
			store: createDexieSyncStore(db, { connectionId: CONNECTION }),
			merge: mergeFile,
		}).sync();

	const bound = async () => {
		const db = freshDatabase();
		await db.syncState.put({ connectionId: CONNECTION, clientId: 'this-browser', boundAt: 0 });
		const provider = createFakeProvider();
		await provider.ensureRoot();
		return { db, provider };
	};

	it('sends a passage, its collection and the practice recorded in it', async () => {
		const { db, provider } = await bound();
		const made = await createPassage(db, {
			title: 'Two verses',
			reference: '',
			collection: 'Verses',
			text: BODY,
		});
		expect(await sync(db, provider)).toMatchObject({ status: 'ok', conflicts: [] });
		expect(provider.contentAt(made.path)).toBe(made.source);

		const [key = ''] =
			chunkPassage(parsePassageFile(made.source).body, 1)?.chunks.map((chunk) => chunk.key) ??
			[];
		await recordPass(db, {
			id: made.id,
			key,
			device: 'here',
			update: () => ({ level: 1, reviewed: '2026-10-13T09:00:00Z' }),
			activity: { words: 2, passes: 1, reviews: 0, ms: 1000 },
		});
		expect(await db.opQueue.count()).toBe(2);
		expect(await sync(db, provider)).toMatchObject({ status: 'ok', conflicts: [] });
		const sent = provider.contentAt(made.path) ?? '';
		expect([...readProgress(parsePassageFile(sent).progress).chunks.keys()]).toEqual([key]);
		expect(provider.snapshot().map((entry) => entry.path)).toContain(
			'.memoriam/activity-2026.md'
		);
		expect(await db.opQueue.count()).toBe(0);
	});

	it('sends a delete, and forgets the tombstone once it has gone', async () => {
		const { db, provider } = await bound();
		const made = await createPassage(db, {
			title: 'Two verses',
			reference: '',
			collection: '',
			text: BODY,
		});
		await sync(db, provider);
		await deletePassage(db, made.id);
		expect(await db.notes.get([LOCAL_CONNECTION_ID, made.id])).toMatchObject({
			deletedLocally: 1,
		});

		expect(await sync(db, provider)).toMatchObject({ status: 'ok' });
		expect(provider.contentAt(made.path)).toBeUndefined();
		expect(await db.notes.count()).toBe(0);
	});

	it('merges what two devices practised of one passage', async () => {
		const { db, provider } = await bound();
		const other = freshDatabase();
		await other.syncState.put({ connectionId: CONNECTION, clientId: 'other', boundAt: 0 });
		const made = await createPassage(db, {
			title: 'Two verses',
			reference: '',
			collection: '',
			text: BODY,
		});
		await sync(db, provider);
		await sync(other, provider);

		const practise = (on: MemoriamDatabase, key: string, level: number) =>
			recordPass(on, {
				id: made.id,
				key,
				device: on === db ? 'here' : 'there',
				update: () => ({ level, reviewed: '2026-10-13T09:00:00Z' }),
				activity: { words: 2, passes: 1, reviews: 0, ms: 1000 },
			});
		const keys = chunkPassage(parsePassageFile(made.source).body, 1)?.chunks ?? [];
		await practise(db, keys[0]?.key ?? FIRST, 2);
		await practise(other, keys[1]?.key ?? SECOND, 3);
		await sync(db, provider);
		expect(await sync(other, provider)).toMatchObject({ status: 'ok', conflicts: [] });
		await sync(db, provider);

		const levels = (text: string | undefined) =>
			[...readProgress(parsePassageFile(text ?? '').progress).chunks.values()].map(
				(entry) => entry.level
			);
		expect(levels(provider.contentAt(made.path))).toEqual([2, 3]);
		expect((await db.notes.get([LOCAL_CONNECTION_ID, made.id]))?.source).toBe(
			provider.contentAt(made.path)
		);
		expect(await db.notes.count()).toBe(2);
	});
});
