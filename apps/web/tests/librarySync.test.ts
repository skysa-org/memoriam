import {
	chunkPassage,
	CURRENT_CHUNKER,
	mergeFile,
	parsePassageFile,
	PASSAGE_FORMAT,
	readProgress,
	syncsHidden,
} from '@memoriam/core';
import type { SyncPhase, SyncSchedulerOptions } from '@skysa/client';
import {
	cleanups,
	reaches,
	remote,
	schedulerDefaults,
	stopSchedulers,
} from '@skysa/client/testing';
import { ROOT } from '@skysa/storage';
import type { FakeProvider } from '@skysa/storage/testing';
import { createSyncEngine } from '@skysa/sync';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindLibrary, unbindLibrary } from '../src/store/connection.js';
import { LOCAL_CONNECTION_ID, type MemoriamDatabase, type NoteRecord } from '../src/store/db.js';
import { createPassage } from '../src/store/passages.js';
import { recordPass } from '../src/store/practice.js';
import { connectionTables } from '../src/store/scopes.js';
import { createLibraryScheduler } from '../src/sync/libraryScheduler.js';
import { createDexieSyncStore } from '../src/sync/store.js';
import { holdCredential } from './support/connection.js';
import { freshDatabase } from './support/db.js';

/**
 * The app's scheduler (`sync/libraryScheduler.ts`): the kit's, handed what is
 * this app's. The kit's suites hold the scheduler itself, here over this app's
 * database as well (`scheduler*.dexie.test.ts`); these hold what it is handed.
 */

afterEach(stopSchedulers);

const CONNECTION = 'c1';

type ProviderFactory = SyncSchedulerOptions['createProvider'];

/** Two chunks, so that each can be practised on its own. */
const TWO_VERSES = 'Jesus wept.\n\nRejoice always.\n';

const ACCOUNT = { connectionId: CONNECTION, provider: 'dropbox', accountId: 'acct' } as const;

/** A library bound to a connection this device holds a credential for. */
const bound = async (binding: Readonly<{ displayName?: string }> = {}) => {
	const db = freshDatabase();
	await bindLibrary(db, { ...ACCOUNT, ...binding });
	await holdCredential(db, CONNECTION);
	return db;
};

/** The app's scheduler over `db`, started, against the kit's fake remote and clock. */
const started = (
	db: MemoriamDatabase,
	overrides: Readonly<{ createProvider?: ProviderFactory }> = {}
) => {
	const { env, server, remote: theRemote, options } = schedulerDefaults();
	const scheduler = createLibraryScheduler(db, { ...options, ...overrides });
	cleanups.unshift(() => {
		scheduler.stop();
	});
	scheduler.start();
	return { db, scheduler, env, server, remote: theRemote };
};

/** A promise the test settles when it says. */
const deferred = () => {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
};

const row = (db: MemoriamDatabase, id: string) => db.notes.get([LOCAL_CONNECTION_ID, id]);

/** A pass on one of a passage's chunks: its write queued lazy, as practice's is. */
const practise = async (
	db: MemoriamDatabase,
	note: NoteRecord,
	{ chunk, level, device }: Readonly<{ chunk: number; level: number; device: string }>
) => {
	const parsed = parsePassageFile(note.source);
	const key =
		chunkPassage(parsed.body, parsed.chunker ?? CURRENT_CHUNKER)?.chunks[chunk]?.key ?? '';
	const recorded = await recordPass(db, {
		id: note.id,
		key,
		device,
		update: () => ({ level, reviewed: '2026-10-13T09:00:00Z' }),
		activity: { words: 2, passes: 1, reviews: 0, ms: 1000 },
	});
	expect(recorded.ok).toBe(true);
};

/** The level of each chunk the file says has been practised, in order. */
const levels = (text: string | undefined) =>
	[...readProgress(parsePassageFile(text ?? '').progress).chunks.values()].map(
		(entry) => entry.level
	);

/** Another device bound to the same connection, syncing when the test says. */
const elsewhere = async (fake: FakeProvider) => {
	const db = freshDatabase();
	await db.syncState.put({ connectionId: CONNECTION, clientId: 'there', boundAt: 0 });
	const engine = createSyncEngine({
		provider: fake,
		store: createDexieSyncStore(db, { connectionId: CONNECTION }),
		document: PASSAGE_FORMAT,
		syncsHidden,
		merge: mergeFile,
	});
	return { db, sync: () => engine.sync() };
};

describe("the app's scheduler", () => {
	it("takes the library's one lock, named for its connection, to sync and to re-scan", async () => {
		// The name every build of the app has taken it by: a tab still running
		// an older one syncs under it too.
		const db = await bound();
		const { env, options } = schedulerDefaults();
		const withLock = vi.spyOn(env.environment, 'withLock');
		const scheduler = createLibraryScheduler(db, options);
		cleanups.unshift(() => {
			scheduler.stop();
		});
		scheduler.start();
		await reaches(scheduler, 'idle');

		await scheduler.resync();

		expect(withLock.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(new Set(withLock.mock.calls.map(([name]) => name))).toEqual(
			new Set([`memoriam:sync:${CONNECTION}`])
		);
	});

	it('keeps what the account is called, through a sync and through the re-scan', async () => {
		const db = await bound({ displayName: 'ada@example.com' });
		const { scheduler } = started(db);
		await reaches(scheduler, 'idle');
		// A token, a root, a cursor and a time have all been written to the row
		// by now, each by a different writer.
		const synced = await db.syncState.get(CONNECTION);
		expect(synced?.accessToken).toBeDefined();
		expect(synced?.rootId).toBeDefined();
		expect(synced?.cursor).toBeDefined();
		expect(synced?.displayName).toBe('ada@example.com');

		await scheduler.resync();

		expect((await db.syncState.get(CONNECTION))?.displayName).toBe('ada@example.com');
	});

	it('merges what two devices practised of one passage, rather than keeping it twice', async () => {
		const db = await bound();
		const note = await createPassage(db, {
			title: 'Two verses',
			reference: '',
			collection: ROOT,
			text: TWO_VERSES,
		});
		const { scheduler, remote: theRemote } = started(db);
		await vi.waitFor(async () => {
			expect((await row(db, note.id))?.dirty).toBe(0);
		});
		await reaches(scheduler, 'idle');
		const there = await elsewhere(theRemote.fake);
		expect((await there.sync()).status).toBe('ok');

		await practise(there.db, note, { chunk: 1, level: 3, device: 'there' });
		expect((await there.sync()).status).toBe('ok');
		await practise(db, note, { chunk: 0, level: 2, device: 'here' });
		await scheduler.syncNow();

		expect(scheduler.status()).toMatchObject({ phase: 'idle', conflicts: [] });
		expect(levels(theRemote.fake.contentAt(note.path))).toEqual([2, 3]);
		expect((await row(db, note.id))?.source).toBe(theRemote.fake.contentAt(note.path));
		// The passage and the year's activity, each merged rather than copied.
		expect(await db.notes.count()).toBe(2);
	});

	it('follows the library to another connection once the first is let go', async () => {
		// Memoriam's library is bound to one connection at a time, so it moves
		// to another only once let go of the first: the kit's suites bind a
		// second beside the first, which this app does not.
		const db = await bound();
		const factory = vi.fn<ProviderFactory>(remote().factory);
		const h = started(db, { createProvider: factory });
		await reaches(h.scheduler, 'idle');

		await unbindLibrary(db);
		await reaches(h.scheduler, 'local');
		await holdCredential(db, 'c2');
		await bindLibrary(db, { ...ACCOUNT, connectionId: 'c2' });

		await vi.waitFor(() => {
			expect(factory).toHaveBeenLastCalledWith(
				expect.objectContaining({ connectionId: 'c2' })
			);
		});
		await reaches(h.scheduler, 'idle');
		expect(h.server.withCredential).toHaveBeenLastCalledWith('sk1_c2');
	});

	it('runs again, rather than failing, when the library is bound again mid-sync', async () => {
		// Let go and bound again by another tab in one step, which a live query
		// may never show: the library comes back new, with nothing kept
		// detached to resume, and its next sync is a new one.
		const db = await bound();
		const note = await createPassage(db, {
			title: 'Linked',
			reference: '',
			collection: ROOT,
			text: 'Linked.\n',
		});
		const h = started(db);
		await vi.waitFor(async () => {
			expect((await row(db, note.id))?.dirty).toBe(0);
		});
		await reaches(h.scheduler, 'idle');
		const held = deferred();
		h.remote.gate.set('changes', held.promise);
		// The pull it is held in fails, as one whose binding went would; any after
		// it do not.
		const failures = new Set(['changes']);
		h.remote.fake.setFault((call) =>
			failures.delete(call.op) ? new Error('502 Bad Gateway') : undefined
		);
		const phases: SyncPhase[] = [];
		h.scheduler.subscribe((status) => {
			phases.push(status.phase);
		});
		const before = h.remote.pulls();

		const arrived = h.remote.gated();
		const running = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		await db.transaction('rw', connectionTables(db), async () => {
			await unbindLibrary(db);
			await bindLibrary(db, ACCOUNT);
		});
		h.remote.gate.delete('changes');
		held.resolve();
		await running;
		await reaches(h.scheduler, 'idle');

		expect(failures.size).toBe(0);
		expect(phases).not.toContain('retrying');
		expect(phases).not.toContain('attention');
		expect(phases).not.toContain('local');
		expect(h.remote.pulls()).toBe(before + 2);
		expect(h.scheduler.status().conflicts).toEqual([]);
		expect(h.remote.fake.contentAt(note.path)).toBe((await row(db, note.id))?.source);
	});
});
