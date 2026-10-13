import {
	chunkPassage,
	createFakeProvider,
	createSyncEngine,
	type FakeProvider,
	isHidden,
	mergeFile,
	parsePassageFile,
	ROOT,
	type StorageProvider,
	type SyncStore,
} from '@memoriam/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createCollection, deleteCollection, renameCollection } from '../src/store/collections.js';
import { bindLibrary } from '../src/store/connection.js';
import {
	createDatabase,
	isLive,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
} from '../src/store/db.js';
import {
	createPassage,
	deletePassage,
	type PassageDetails,
	restorePassages,
	updatePassage,
} from '../src/store/passages.js';
import { recordPass } from '../src/store/practice.js';
import { createDexieSyncStore } from '../src/sync/store.js';

/**
 * The push queue a change here leaves behind, sent: skysa-notes'
 * `tests/queue.test.ts`, as Memoriam's writers make the changes. Each ends with
 * the device and the remote agreeing, and nothing left to send.
 */

const CONNECTION = 'dropbox-1';
const NOW = () => new Date('2026-10-13T10:00:00Z');

const opened: MemoriamDatabase[] = [];

afterEach(async () => {
	await Promise.all(opened.splice(0).map((db) => db.delete()));
});

const freshDatabase = (): MemoriamDatabase => {
	const db = createDatabase(`push-${crypto.randomUUID()}`);
	opened.push(db);
	return db;
};

const details = (title: string, text = `${title}, the words.\n`, collection = ROOT) =>
	({ title, reference: '', collection, text }) satisfies PassageDetails;

const engineFor = (store: SyncStore, provider: StorageProvider) =>
	createSyncEngine({ provider, store, now: NOW, merge: mergeFile });

const connected = async () => {
	const db = freshDatabase();
	await bindLibrary(db, { connectionId: CONNECTION, provider: 'dropbox' });
	const store = createDexieSyncStore(db, { connectionId: CONNECTION });
	const fake = createFakeProvider();
	await fake.ensureRoot();
	const engineOver = (provider: StorageProvider) => engineFor(store, provider);
	return { db, store, fake, engine: engineOver(fake), engineOver };
};

/** Every file on the remote, by path, leaving out the app's own. */
const remoteFiles = (fake: FakeProvider) =>
	Object.fromEntries(
		fake
			.snapshot()
			.filter((entry) => entry.kind === 'file' && !isHidden(entry.path))
			.map((entry) => [entry.path, fake.contentAt(entry.path)])
	);

/** Every live passage, by path, as its file. */
const localFiles = async (db: MemoriamDatabase) =>
	Object.fromEntries(
		(await db.notes.toArray())
			.filter((note) => isLive(note) && !isHidden(note.path))
			.map((note) => [note.path, note.source])
	);

/** Both sides agree, and nothing is left to send. */
const expectMirrored = async (db: MemoriamDatabase, fake: FakeProvider) => {
	expect(remoteFiles(fake)).toEqual(await localFiles(db));
	expect(await db.opQueue.count()).toBe(0);
	expect((await db.notes.toArray()).filter((note) => note.dirty === 1)).toEqual([]);
};

/**
 * The provider, with `action` run the first time `operation` has reached the
 * remote and before the engine hears back: the user carrying on while a
 * request is in flight.
 */
const inFlight = (
	fake: FakeProvider,
	operation: 'write' | 'move' | 'delete',
	action: () => Promise<unknown>
): StorageProvider => {
	const fired = new Set<string>();
	const once = async () => {
		if (fired.has(operation)) return;
		fired.add(operation);
		await action();
	};
	return {
		...fake,
		write: async (path, content, options) => {
			const entry = await fake.write(path, content, options);
			if (operation === 'write') await once();
			return entry;
		},
		move: async (entry, target) => {
			const moved = await fake.move(entry, target);
			if (operation === 'move') await once();
			return moved;
		},
		delete: async (entry) => {
			await fake.delete(entry);
			if (operation === 'delete') await once();
		},
	};
};

const row = (db: MemoriamDatabase, id: string) => db.notes.get([LOCAL_CONNECTION_ID, id]);

/** A pass on the passage's first chunk. */
const practise = (db: MemoriamDatabase, passage: NoteRecord, level: number) => {
	const [key = ''] =
		chunkPassage(parsePassageFile(passage.source).body, 1)?.chunks.map((chunk) => chunk.key) ??
		[];
	return recordPass(db, {
		id: passage.id,
		key,
		device: 'here',
		update: () => ({ level, reviewed: '2026-10-13T09:00:00Z' }),
		activity: { words: 3, passes: 1, reviews: 0, ms: 1000 },
	});
};

describe('changes here, pushed', () => {
	it('mirrors passages and collections made, edited, renamed, moved and deleted', async () => {
		const { db, fake, engine } = await connected();
		const plan = await createPassage(db, details('Plan'));
		const gone = await createPassage(db, details('Gone'));
		await createCollection(db, 'Empty');
		expect((await engine.sync()).status).toBe('ok');
		await expectMirrored(db, fake);

		await createCollection(db, 'Work');
		await updatePassage(db, plan.id, details('Roadmap', 'More words.\n', 'Work'));
		await practise(db, (await row(db, plan.id)) ?? plan, 2);
		await deletePassage(db, gone.id);
		const result = await engine.sync();

		expect(result).toMatchObject({ status: 'ok', conflicts: [] });
		await expectMirrored(db, fake);
		expect(Object.keys(remoteFiles(fake))).toEqual(['Work/roadmap.md']);
		expect(fake.snapshot().map((entry) => entry.path)).toContain('Empty');
	});

	it('writes a passage retitled before its first push once, at its final name', async () => {
		const { db, fake, engine } = await connected();
		const made = await createPassage(db, details('Plan'));
		await updatePassage(db, made.id, details('Roadmap'));

		expect((await engine.sync()).status).toBe('ok');

		await expectMirrored(db, fake);
		expect(fake.callLog().filter((call) => call.op === 'write')).toHaveLength(1);
		expect(fake.callLog().filter((call) => call.op === 'move')).toEqual([]);
	});

	it('carries a renamed collection and everything in it', async () => {
		const { db, fake, engine } = await connected();
		await createPassage(db, details('A', 'A.\n', 'Work'));
		await createPassage(db, details('B', 'B.\n', 'Work'));
		await engine.sync();

		await renameCollection(db, 'Work', 'Play');
		expect((await engine.sync()).status).toBe('ok');

		await expectMirrored(db, fake);
		expect(Object.keys(remoteFiles(fake)).sort()).toEqual(['Play/a.md', 'Play/b.md']);
		expect(fake.snapshot().map((entry) => entry.path)).not.toContain('Work');
	});

	it('removes the passages of a deleted collection, and the collection', async () => {
		const { db, fake, engine } = await connected();
		await createPassage(db, details('A', 'A.\n', 'Work'));
		await createPassage(db, details('Kept'));
		await engine.sync();

		await deleteCollection(db, 'Work');
		expect((await engine.sync()).status).toBe('ok');

		await expectMirrored(db, fake);
		expect(Object.keys(remoteFiles(fake))).toEqual(['kept.md']);
		expect(fake.snapshot().map((entry) => entry.path)).not.toContain('Work');
	});

	it('leaves the remote alone for a passage deleted and put back between syncs', async () => {
		const { db, fake, engine } = await connected();
		const made = await createPassage(db, details('Plan'));
		await engine.sync();

		const deleted = await deletePassage(db, made.id);
		await restorePassages(db, deleted === undefined ? [] : [deleted]);
		expect((await engine.sync()).status).toBe('ok');

		await expectMirrored(db, fake);
		expect(fake.callLog().filter((call) => call.op === 'delete')).toEqual([]);
	});

	it('makes no conflict copy for a new passage at the name of one just deleted', async () => {
		const { db, fake, engine } = await connected();
		const old = await createPassage(db, details('Plan', 'Old.\n'));
		await engine.sync();

		await deletePassage(db, old.id);
		const fresh = await createPassage(db, details('Plan', 'New.\n'));
		const result = await engine.sync();

		expect(result).toMatchObject({ status: 'ok', conflicts: [] });
		await expectMirrored(db, fake);
		expect(Object.values(remoteFiles(fake))).toEqual([(await row(db, fresh.id))?.source]);
	});

	it('sends only the delete for a passage edited and then deleted', async () => {
		const { db, fake, engine } = await connected();
		const made = await createPassage(db, details('Plan'));
		await engine.sync();
		await updatePassage(db, made.id, details('Plan', 'Thrown away.\n'));
		await deletePassage(db, made.id);

		await engine.sync();

		expect(fake.callLog().filter((call) => call.op === 'write')).toHaveLength(1);
		expect(remoteFiles(fake)).toEqual({});
		expect(await row(db, made.id)).toBeUndefined();
	});
});

describe('changes here while a push is in flight', () => {
	it('keeps a pass recorded while its write was on the way, and sends it next', async () => {
		const { db, fake, engineOver } = await connected();
		const made = await createPassage(db, details('Plan'));
		const engine = engineOver(inFlight(fake, 'write', () => practise(db, made, 3)));

		await engine.sync();

		const after = await row(db, made.id);
		expect(after?.dirty).toBe(1);
		expect(after?.remoteId).toBeDefined();

		expect((await engine.sync()).status).toBe('ok');
		await expectMirrored(db, fake);
		expect(fake.contentAt(made.path)).toContain('level: 3');
	});

	it('moves a passage retitled while the write making it was on the way', async () => {
		const { db, fake, engineOver } = await connected();
		const made = await createPassage(db, details('Plan'));
		const engine = engineOver(
			inFlight(fake, 'write', () => updatePassage(db, made.id, details('Roadmap')))
		);

		await engine.sync();
		expect((await engine.sync()).status).toBe('ok');

		await expectMirrored(db, fake);
		expect(Object.keys(remoteFiles(fake))).toEqual(['roadmap.md']);
	});

	it('writes a passage back that was put back while its delete was on the way', async () => {
		const { db, fake, engineOver } = await connected();
		const made = await createPassage(db, details('Plan', 'Keep.\n'));
		await engineOver(fake).sync();
		const deleted = await deletePassage(db, made.id);
		const engine = engineOver(
			inFlight(fake, 'delete', () =>
				restorePassages(db, deleted === undefined ? [] : [deleted])
			)
		);

		await engine.sync();
		expect((await row(db, made.id))?.deletedLocally).toBe(0);
		expect((await engine.sync()).status).toBe('ok');

		await expectMirrored(db, fake);
		expect(fake.contentAt('plan.md')).toContain('Keep.');
	});

	it('still removes the file when the write making it was in flight as the delete came', async () => {
		const { db, fake, engineOver } = await connected();
		const made = await createPassage(db, details('Plan'));
		const engine = engineOver(inFlight(fake, 'write', () => deletePassage(db, made.id)));

		await engine.sync();
		expect((await engine.sync()).status).toBe('ok');

		expect(remoteFiles(fake)).toEqual({});
		expect(await row(db, made.id)).toBeUndefined();
		expect(await db.opQueue.count()).toBe(0);
	});
});

describe('a passage deleted before its write was ever sent, on two devices', () => {
	it('leaves the other device’s passage where it is', async () => {
		const fake = createFakeProvider();
		await fake.ensureRoot();
		const mine = freshDatabase();
		const theirs = freshDatabase();
		await bindLibrary(mine, { connectionId: CONNECTION, provider: 'dropbox' });
		await bindLibrary(theirs, { connectionId: CONNECTION, provider: 'dropbox' });
		const mineStore = createDexieSyncStore(mine, { connectionId: CONNECTION });
		const theirsStore = createDexieSyncStore(theirs, { connectionId: CONNECTION });

		await createPassage(theirs, details('Plans', 'Keep me.\n'));
		const dropped = await createPassage(mine, details('Plans', 'No.\n'));
		await deletePassage(mine, dropped.id);

		const other = engineFor(theirsStore, fake);
		const engine = engineFor(
			mineStore,
			inFlight(fake, 'write', () => other.push())
		);
		await engine.push();
		await other.sync();
		await engine.sync();

		expect(Object.keys(remoteFiles(fake))).toEqual(['plans.md']);
		expect(fake.contentAt('plans.md')).toContain('Keep me.');
		expect(await localFiles(mine)).toEqual(await localFiles(theirs));
	});
});
