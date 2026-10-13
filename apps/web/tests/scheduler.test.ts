import {
	AuthError,
	chunkPassage,
	createFakeProvider,
	createSyncEngine,
	CURRENT_CHUNKER,
	type FakeProvider,
	MARKER_FILE,
	mergeFile,
	parsePassageFile,
	RateLimitError,
	readProgress,
	ROOT,
	type StorageProvider,
} from '@memoriam/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient } from '../src/api/client.js';
import { t } from '../src/i18n/t.js';
import { bindLibrary, unbindLibrary } from '../src/store/connection.js';
import { keepCredential } from '../src/store/credentials.js';
import {
	createDatabase,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
	writerTables,
} from '../src/store/db.js';
import { createPassage, type PassageDetails, updatePassage } from '../src/store/passages.js';
import { recordPass } from '../src/store/practice.js';
import {
	createSyncScheduler,
	type ProviderFactory,
	type SchedulerEnvironment,
	type SchedulerEvent,
	type SchedulerStatus,
	type SyncPhase,
	type SyncScheduler,
	type SyncSchedulerOptions,
} from '../src/sync/scheduler.js';
import { createDexieSyncStore } from '../src/sync/store.js';

/**
 * The sync scheduler (docs/ARCHITECTURE.md §10, "The sync client"): when it
 * syncs, what it says about the last attempt, and how it follows the library's
 * binding. skysa-notes' `tests/scheduler.test.ts`, ported, less what the port
 * left behind — the change relay, the clipboard, files read on demand, an
 * import that can be cancelled or resumed, the wait on another tab, several
 * sources at once — and with tests of its own for when practice is sent
 * ("Push timing").
 */

const HOUR = 60 * 60 * 1000;
const CONNECTION = 'c1';
const ACCOUNT = { connectionId: CONNECTION, provider: 'dropbox', accountId: 'acct' } as const;
const DEBOUNCE = 2000;
const LAZY = 20_000;
const INTERVAL = 60_000;
const BACKOFF = 5000;
const PROGRESS = 150;
/** Two chunks, so that each can be practised on its own. */
const TWO_VERSES = 'Jesus wept.\n\nRejoice always.\n';

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	await Promise.all(
		cleanups.splice(0).map(async (cleanup) => {
			await cleanup();
		})
	);
});

/** Time, the network and the page, as the test says they are. */
const fakeEnvironment = () => {
	const state = { now: 1_000_000, online: true, visible: true, nextId: 0 };
	const handlers = new Map<SchedulerEvent, Set<() => void>>();
	const timers = new Map<number, { at: number; callback: () => void }>();
	/** Each lock's tail: the next holder waits for it. */
	const locks = new Map<string, Promise<void>>();

	const environment: SchedulerEnvironment = {
		now: () => state.now,
		isOnline: () => state.online,
		isVisible: () => state.visible,
		listen: (event, handler) => {
			const set = handlers.get(event) ?? new Set();
			set.add(handler);
			handlers.set(event, set);
			return () => {
				set.delete(handler);
			};
		},
		setTimer: (callback, ms) => {
			state.nextId += 1;
			const id = state.nextId;
			timers.set(id, { at: state.now + ms, callback });
			return () => {
				timers.delete(id);
			};
		},
		withLock: <T>(name: string, work: () => Promise<T>): Promise<T> => {
			const held = (locks.get(name) ?? Promise.resolve()).then(work);
			locks.set(
				name,
				held.then(
					() => undefined,
					() => undefined
				)
			);
			return held;
		},
	};

	return {
		environment,
		state,
		fire: (event: SchedulerEvent) => {
			handlers.get(event)?.forEach((handler) => {
				handler();
			});
		},
		/** Move the clock on, running every timer that comes due on the way. */
		advance: (ms: number) => {
			state.now += ms;
			[...timers.entries()]
				.filter(([, timer]) => timer.at <= state.now)
				.sort(([, a], [, b]) => a.at - b.at)
				.forEach(([id, timer]) => {
					timers.delete(id);
					timer.callback();
				});
		},
		/** How far away each pending timer is. */
		pending: () =>
			[...timers.values()].map((timer) => timer.at - state.now).sort((a, b) => a - b),
	};
};

type FakeEnvironment = ReturnType<typeof fakeEnvironment>;

/** A client that answers with `token` whichever credential it is handed. */
const presenting = (token: ApiClient['token']) => {
	// The credential is what says which connection, so the client is asked for
	// one bound to it rather than handed an id.
	const withCredential = vi.fn(
		(credential: string) => ({ token, credential }) as unknown as ApiClient
	);
	return { token, withCredential };
};

/** A server minting `t1`, `t2`, … each good for ten hours. */
const tokenServer = () => {
	const minted = new Map<'count', number>([['count', 0]]);
	const token = vi.fn<ApiClient['token']>(() => {
		const count = (minted.get('count') ?? 0) + 1;
		minted.set('count', count);
		return Promise.resolve({
			ok: true,
			value: { accessToken: `t${String(count)}`, expiresAt: Date.now() + 10 * HOUR },
		});
	});
	return presenting(token);
};

type Gated = 'changes' | 'read';

interface Remote {
	readonly fake: FakeProvider;
	/** Every token a request was made with, in order. */
	readonly tokensUsed: string[];
	/** Tokens the provider answers 401 to. */
	readonly rejected: Set<string>;
	/** While set, calls to that operation wait for it: a sync caught mid-flight. */
	readonly gate: Map<Gated, Promise<void>>;
	/** How many calls to the operation have reached its gate, held or not. */
	readonly gated: (op?: Gated) => number;
	/** How many times the remote has been asked what changed: one per sync. */
	readonly pulls: () => number;
	/** The cursor each `changes` was asked with; `undefined` is a full scan. */
	readonly cursors: (string | undefined)[];
	readonly factory: ProviderFactory;
}

const remote = (): Remote => {
	const fake = createFakeProvider();
	const tokensUsed: string[] = [];
	const cursors: (string | undefined)[] = [];
	const rejected = new Set<string>();
	const gate = new Map<Gated, Promise<void>>();
	const arrivals = new Map<Gated, number>();
	const arrive = async (op: Gated) => {
		arrivals.set(op, (arrivals.get(op) ?? 0) + 1);
		await gate.get(op);
	};

	const factory: ProviderFactory = ({ getAccessToken }) => {
		const authorized = async () => {
			const token = await getAccessToken();
			tokensUsed.push(token);
			if (rejected.has(token)) throw new AuthError('expired');
		};
		const provider: StorageProvider = {
			kind: fake.kind,
			listsEverything: fake.listsEverything,
			ensureRoot: async () => {
				await authorized();
				return fake.ensureRoot();
			},
			list: async (path) => {
				await authorized();
				return fake.list(path);
			},
			read: async (entry) => {
				await arrive('read');
				await authorized();
				return fake.read(entry);
			},
			write: async (path, content, expectedVersion) => {
				await authorized();
				return fake.write(path, content, expectedVersion);
			},
			readBytes: async (entry) => {
				await authorized();
				return fake.readBytes(entry);
			},
			createFile: async (path, bytes, opts) => {
				await authorized();
				return fake.createFile(path, bytes, opts);
			},
			createFolder: async (path) => {
				await authorized();
				return fake.createFolder(path);
			},
			move: async (entry, to) => {
				await authorized();
				return fake.move(entry, to);
			},
			delete: async (entry) => {
				await authorized();
				return fake.delete(entry);
			},
			changes: async (cursor) => {
				await arrive('changes');
				await authorized();
				cursors.push(cursor);
				return fake.changes(cursor);
			},
		};
		return provider;
	};

	return {
		fake,
		tokensUsed,
		rejected,
		gate,
		gated: (op = 'changes') => arrivals.get(op) ?? 0,
		pulls: () => fake.callLog().filter((call) => call.op === 'changes').length,
		cursors,
		factory,
	};
};

const freshDatabase = (): MemoriamDatabase => {
	const db = createDatabase(`scheduler-${crypto.randomUUID()}`);
	cleanups.push(() => db.delete());
	return db;
};

/** The credential this device holds for a connection. Without one nothing can mint. */
const holdCredential = (db: MemoriamDatabase, connectionId: string = CONNECTION) =>
	keepCredential(db, connectionId, {
		id: connectionId,
		credential: `sk1_${connectionId}`,
		provider: ACCOUNT.provider,
		createdAt: 0,
	});

/** A library bound to a connection this device holds a credential for. */
const bound = async (binding: Readonly<{ displayName?: string }> = {}) => {
	const db = freshDatabase();
	await bindLibrary(db, { ...ACCOUNT, ...binding });
	await holdCredential(db);
	return db;
};

/**
 * Let the library go and bind it to the same connection again, as another tab
 * does it: in one step, which liveQuery may never show.
 */
const rebindAtOnce = (db: MemoriamDatabase) =>
	db.transaction('rw', [...writerTables(db), db.fileBytes, db.prefs], async () => {
		await unbindLibrary(db);
		await bindLibrary(db, ACCOUNT);
	});

/** Another device bound to the same connection, syncing when the test says. */
const elsewhere = async (fake: FakeProvider) => {
	const db = freshDatabase();
	await db.syncState.put({ connectionId: CONNECTION, clientId: 'there', boundAt: 0 });
	const engine = createSyncEngine({
		provider: fake,
		store: createDexieSyncStore(db, { connectionId: CONNECTION }),
		merge: mergeFile,
	});
	return { db, sync: () => engine.sync() };
};

interface Harness {
	readonly db: MemoriamDatabase;
	readonly scheduler: SyncScheduler;
	readonly env: FakeEnvironment;
	readonly server: ReturnType<typeof tokenServer>;
	readonly remote: Remote;
}

const started = (
	db: MemoriamDatabase,
	overrides: Partial<SyncSchedulerOptions> = {},
	{
		env = fakeEnvironment(),
		theRemote = remote(),
	}: Readonly<{ env?: FakeEnvironment; theRemote?: Remote }> = {}
): Harness => {
	const server = tokenServer();
	const scheduler = createSyncScheduler({
		db,
		client: server,
		createProvider: theRemote.factory,
		environment: env.environment,
		debounceMs: DEBOUNCE,
		lazyMs: LAZY,
		intervalMs: INTERVAL,
		backoffMs: BACKOFF,
		maxBackoffMs: 4 * BACKOFF,
		...overrides,
	});
	cleanups.unshift(() => {
		scheduler.stop();
	});
	scheduler.start();
	return { db, scheduler, env, server, remote: theRemote };
};

const reaches = async (scheduler: SyncScheduler, phase: SyncPhase) => {
	await vi.waitFor(() => {
		expect(scheduler.status().phase).toBe(phase);
	});
};

/** A sync the user did not ask for, which leaves blocked ops blocked. */
const focused = async (h: Harness) => {
	h.env.fire('focus');
	await vi.waitFor(() => {
		expect(h.scheduler.status().phase).not.toBe('syncing');
	});
};

/** Long enough for anything a trigger would have started to have shown itself. */
const quiet = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 60);
	});

/** Whatever the scheduler is waiting on — a backoff, the poll, an edit — comes due. */
const nextTimer = async (h: Harness) => {
	// Let an edit's debounce be armed first, rather than come due in the next round.
	await quiet();
	h.env.advance(Math.min(...h.env.pending()));
	await vi.waitFor(() => {
		expect(h.scheduler.status().phase).not.toBe('syncing');
	});
};

const deferred = () => {
	const box = new Map<'resolve', () => void>();
	const promise = new Promise<void>((resolve) => {
		box.set('resolve', resolve);
	});
	return { promise, resolve: () => box.get('resolve')?.() };
};

const details = (title: string, text = `${title}, in words.\n`): PassageDetails => ({
	title,
	reference: '',
	collection: ROOT,
	text,
});

/** A passage, made as the editor makes one: its write queued to be sent soon. */
const write = (db: MemoriamDatabase, title: string, text?: string) =>
	createPassage(db, details(title, text));

/** New words for a passage, as the editor saves them. */
const reword = async (db: MemoriamDatabase, note: NoteRecord, text: string) => {
	const edited = await updatePassage(db, note.id, details(note.title, text));
	expect(edited.ok).toBe(true);
};

const row = (db: MemoriamDatabase, id: string) => db.notes.get([LOCAL_CONNECTION_ID, id]);

/** A pass on one of a passage's chunks: its write queued lazy, as practice's is. */
const practise = async (
	db: MemoriamDatabase,
	note: NoteRecord,
	{
		chunk = 0,
		level = 1,
		device = 'here',
	}: Readonly<{ chunk?: number; level?: number; device?: string }> = {}
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

/** Synced once, with a passage of two verses on the remote. */
const syncedPassage = async (overrides: Partial<SyncSchedulerOptions> = {}) => {
	const db = await bound();
	const note = await write(db, 'Two verses', TWO_VERSES);
	const h = started(db, overrides);
	await vi.waitFor(async () => {
		expect((await row(db, note.id))?.dirty).toBe(0);
	});
	await reaches(h.scheduler, 'idle');
	return { ...h, note };
};

describe('with no connection', () => {
	it('says the library is kept on this device, and asks nothing of anyone', async () => {
		const { scheduler, server, remote: theRemote } = started(freshDatabase());

		await quiet();

		expect(scheduler.status().phase).toBe('local');
		expect(server.token).not.toHaveBeenCalled();
		expect(theRemote.pulls()).toBe(0);
	});
});

describe('syncing a connection', () => {
	it('syncs on open, writing the marker and the passages', async () => {
		const db = await bound();
		const note = await write(db, 'Plan');

		const { scheduler, remote: theRemote } = started(db);
		await reaches(scheduler, 'idle');
		await vi.waitFor(() => {
			expect(theRemote.fake.contentAt(note.path)).toContain('Plan, in words.');
		});

		expect(theRemote.fake.contentAt(MARKER_FILE)).toBeDefined();
		const state = await db.syncState.get(CONNECTION);
		expect(state?.rootId).toBeDefined();
		expect(state?.cursor).toBeDefined();
	});

	it('uses the token the server minted, and remembers when it last synced', async () => {
		const db = await bound();
		const { scheduler, server, env, remote: theRemote } = started(db);

		await vi.waitFor(async () => {
			expect((await db.syncState.get(CONNECTION))?.lastSyncAt).toBe(env.state.now);
		});
		// The row is written inside the run and the status published once the
		// run returns, so the one can be seen before the other.
		await vi.waitFor(() => {
			expect(scheduler.status()).toMatchObject({ phase: 'idle', lastSyncAt: env.state.now });
		});

		// The credential is what names the connection; there is no id in the
		// request to get wrong.
		expect(server.withCredential).toHaveBeenCalledWith(`sk1_${CONNECTION}`);
		expect(new Set(theRemote.tokensUsed)).toEqual(new Set(['t1']));
	});

	it('writes the marker once, not on every sync', async () => {
		const db = await bound();
		const { scheduler, remote: theRemote } = started(db);
		await reaches(scheduler, 'idle');

		await scheduler.syncNow();
		await scheduler.syncNow();

		const roots = theRemote.fake.callLog().filter((call) => call.op === 'ensureRoot');
		expect(roots).toHaveLength(1);
	});

	it('starts from the last sync a reload left behind', async () => {
		const db = await bound();
		await db.syncState.update(CONNECTION, { lastSyncAt: 42 });
		const env = fakeEnvironment();
		const scheduler = createSyncScheduler({
			db,
			client: tokenServer(),
			createProvider: remote().factory,
			environment: env.environment,
		});
		cleanups.unshift(() => {
			scheduler.stop();
		});
		const seen: (number | undefined)[] = [];
		scheduler.subscribe((status) => {
			seen.push(status.lastSyncAt);
		});

		scheduler.start();
		await reaches(scheduler, 'idle');

		expect(seen[0]).toBe(42);
	});

	it("takes the library's one lock, named for its connection, to sync and to re-scan", async () => {
		const db = await bound();
		const env = fakeEnvironment();
		const withLock = vi.spyOn(env.environment, 'withLock');
		const h = started(db, {}, { env });
		await reaches(h.scheduler, 'idle');

		await h.scheduler.resync();

		expect(withLock.mock.calls.length).toBeGreaterThanOrEqual(3);
		expect(new Set(withLock.mock.calls.map(([name]) => name))).toEqual(
			new Set([`memoriam:sync:${CONNECTION}`])
		);
	});
});

describe('when it syncs', () => {
	it('does not take its own pushes for edits', async () => {
		const db = await bound();
		await write(db, 'Plan');
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const after = h.remote.pulls();

		h.env.advance(DEBOUNCE);
		await quiet();

		expect(h.remote.pulls()).toBe(after);
		expect(h.env.pending()).toEqual([INTERVAL - DEBOUNCE]);
	});

	it('syncs every minute while the page is visible', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();

		h.env.advance(INTERVAL);
		await vi.waitFor(() => {
			expect(h.remote.pulls()).toBe(before + 1);
		});
		await reaches(h.scheduler, 'idle');
		h.env.advance(INTERVAL);
		await vi.waitFor(() => {
			expect(h.remote.pulls()).toBe(before + 2);
		});
	});

	it('does not sync on the interval while hidden, and catches up when shown', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();

		h.env.state.visible = false;
		h.env.advance(INTERVAL);
		await quiet();
		expect(h.remote.pulls()).toBe(before);

		h.env.fire('visibilitychange');
		await quiet();
		expect(h.remote.pulls()).toBe(before);

		h.env.state.visible = true;
		h.env.fire('visibilitychange');
		await vi.waitFor(() => {
			expect(h.remote.pulls()).toBe(before + 1);
		});
	});

	it.each<SchedulerEvent>(['focus', 'online'])('syncs on %s', async (event) => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();

		h.env.fire(event);

		await vi.waitFor(() => {
			expect(h.remote.pulls()).toBe(before + 1);
		});
	});

	it('syncs when asked, and once more if asked again mid-sync', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();
		const held = deferred();
		h.remote.gate.set('changes', held.promise);

		const arrived = h.remote.gated();
		const first = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		const second = h.scheduler.syncNow();
		const third = h.scheduler.syncNow();
		h.remote.gate.delete('changes');
		held.resolve();
		await Promise.all([first, second, third]);

		expect(h.remote.pulls()).toBe(before + 2);
		expect(h.scheduler.status().phase).toBe('idle');
	});
});

/** When practice is sent, beside an edit (§10, "Push timing"). */
describe('sending practice', () => {
	it('starts no run when the page is hidden with nothing waiting to be sent', async () => {
		const h = await syncedPassage();
		const before = h.remote.pulls();
		const phases: SyncPhase[] = [];
		h.scheduler.subscribe((status) => {
			phases.push(status.phase);
		});

		h.env.state.visible = false;
		h.env.fire('visibilitychange');
		await quiet();

		expect(h.remote.pulls()).toBe(before);
		expect(phases).toEqual([]);
		expect(h.env.pending()).toEqual([INTERVAL]);
	});

	it("sends a pass with the minute's poll while the page is in sight, before its own wait is over", async () => {
		const h = await syncedPassage({ lazyMs: 5 * INTERVAL });
		const before = h.remote.pulls();

		await practise(h.db, h.note);
		await quiet();
		h.env.advance(INTERVAL - 1);
		await quiet();
		expect(h.remote.pulls()).toBe(before);
		expect(levels(h.remote.fake.contentAt(h.note.path))).toEqual([]);

		h.env.advance(1);
		await vi.waitFor(() => {
			expect(levels(h.remote.fake.contentAt(h.note.path))).toEqual([1]);
		});
		await reaches(h.scheduler, 'idle');
		expect(h.remote.pulls()).toBe(before + 1);
		expect(await h.db.opQueue.count()).toBe(0);
		// Nothing is left waiting for the pass: the poll sent it.
		expect(h.env.pending()).toEqual([INTERVAL]);
	});
});

describe('sending an edit', () => {
	it('pushes an edit a moment after the typing stops', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();

		const note = await write(db, 'Later', 'draft\n');
		await quiet();
		expect(h.remote.pulls()).toBe(before);

		h.env.advance(DEBOUNCE - 1);
		await quiet();
		expect(h.remote.pulls()).toBe(before);

		h.env.advance(1);
		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('draft');
		});
		expect(h.remote.pulls()).toBe(before + 1);
	});

	it('waits for a pause in the edits, not for the first of them', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();

		await write(db, 'One');
		await quiet();
		h.env.advance(DEBOUNCE - 500);
		await write(db, 'Two');
		await quiet();
		h.env.advance(DEBOUNCE - 500);
		await quiet();

		expect(h.remote.pulls()).toBe(before);
		h.env.advance(500);
		await vi.waitFor(() => {
			expect(h.remote.pulls()).toBe(before + 1);
		});
	});

	it('pushes an edit to a passage whose first write has already gone up', async () => {
		const db = await bound();
		const note = await write(db, 'Plan', 'one\n');
		const h = started(db);
		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('one');
		});
		await reaches(h.scheduler, 'idle');

		await reword(db, note, 'two\n');
		await quiet();
		h.env.advance(DEBOUNCE);

		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('two');
		});
	});

	it('sends an edit at once when the page is hidden before its debounce', async () => {
		const h = await syncedPassage();
		const before = h.remote.pulls();
		await reword(h.db, h.note, 'Jesus wept.\n\nRejoice always, and again.\n');
		await quiet();
		expect(h.env.pending()).toEqual([DEBOUNCE, INTERVAL]);

		h.env.state.visible = false;
		h.env.fire('visibilitychange');

		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(h.note.path)).toContain('and again');
		});
		await reaches(h.scheduler, 'idle');
		expect(h.remote.pulls()).toBe(before + 1);
		expect(h.env.pending()).toEqual([INTERVAL]);
	});

	it('leaves a retry to its backoff when an edit comes first', async () => {
		const db = await bound();
		const note = await write(db, 'Plan', 'one\n');
		const h = started(db);
		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('one');
		});
		await reaches(h.scheduler, 'idle');
		h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('503') : undefined));
		await reword(db, note, 'two\n');
		await quiet();
		h.env.advance(DEBOUNCE);
		await reaches(h.scheduler, 'retrying');
		const pulls = h.remote.pulls();

		// An edit to another passage queues an op of its own, so its debounce is armed.
		const other = await write(db, 'Other', 'other\n');
		await reword(db, note, 'three\n');
		await quiet();
		expect(h.env.pending()).toEqual([DEBOUNCE, BACKOFF]);
		h.env.advance(DEBOUNCE);
		await quiet();

		expect(h.remote.pulls()).toBe(pulls);
		expect((await db.opQueue.toArray()).map((op) => op.attempts)).toEqual([1, 0]);

		// The backoff's own retry, and the outage is over.
		h.remote.fake.setFault(undefined);
		h.env.advance(BACKOFF - DEBOUNCE);
		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('three');
			expect(h.remote.fake.contentAt(other.path)).toContain('other');
		});
		await reaches(h.scheduler, 'idle');
	});
});

describe('sending practice, on its own wait', () => {
	it('sends a pass when its wait is over, and not at the debounce', async () => {
		const h = await syncedPassage();
		const before = h.remote.pulls();

		await practise(h.db, h.note);
		await quiet();
		expect((await h.db.opQueue.toArray()).map((op) => op.lazy)).toEqual([true, true]);
		expect(h.env.pending()).toEqual([LAZY, INTERVAL]);

		h.env.advance(DEBOUNCE);
		await quiet();
		expect(h.remote.pulls()).toBe(before);
		h.env.advance(LAZY - DEBOUNCE - 1);
		await quiet();
		expect(h.remote.pulls()).toBe(before);

		h.env.advance(1);
		await vi.waitFor(() => {
			expect(levels(h.remote.fake.contentAt(h.note.path))).toEqual([1]);
		});
		await reaches(h.scheduler, 'idle');
		expect(h.remote.pulls()).toBe(before + 1);
		expect(await h.db.opQueue.count()).toBe(0);
	});

	it('does not put the wait off for a pass that follows', async () => {
		const db = await bound();
		const first = await write(db, 'Two verses', TWO_VERSES);
		const second = await write(db, 'Two more verses', TWO_VERSES);
		const h = started(db);
		await vi.waitFor(async () => {
			expect((await db.notes.toArray()).map((each) => each.dirty)).toEqual([0, 0]);
		});
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();

		await practise(db, first);
		await quiet();
		h.env.advance(LAZY / 2);
		// Another passage's write, so a new op, and lazy as the first is.
		await practise(db, second);
		await quiet();
		expect(h.env.pending()).toEqual([LAZY / 2, INTERVAL - LAZY / 2]);

		h.env.advance(LAZY / 2);
		await vi.waitFor(() => {
			expect(levels(h.remote.fake.contentAt(first.path))).toEqual([1]);
			expect(levels(h.remote.fake.contentAt(second.path))).toEqual([1]);
		});
		expect(h.remote.pulls()).toBe(before + 1);
	});

	it('sends at the debounce once the passage practised is edited', async () => {
		const h = await syncedPassage();
		const before = h.remote.pulls();
		await practise(h.db, h.note);
		await quiet();
		const lazy = await h.db.opQueue.toArray();

		// `queueWrite`, finding only a lazy write queued for the passage, puts
		// one that is not in its place, at the back of the queue.
		await reword(h.db, h.note, 'Jesus wept.\n\nRejoice always, and again.\n');
		const upgraded = (await h.db.opQueue.toArray()).find((op) => op.noteId === h.note.id);
		expect(upgraded?.lazy).toBeUndefined();
		expect(upgraded?.seq).toBeGreaterThan(Math.max(...lazy.map((op) => op.seq ?? 0)));
		await quiet();
		expect(h.env.pending()).toEqual([DEBOUNCE, LAZY, INTERVAL]);

		h.env.advance(DEBOUNCE - 1);
		await quiet();
		expect(h.remote.pulls()).toBe(before);
		h.env.advance(1);
		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(h.note.path)).toContain('and again');
		});
		await reaches(h.scheduler, 'idle');
		expect(h.remote.pulls()).toBe(before + 1);
		// The year's activity went with it, and the pass's wait with that.
		expect(await h.db.opQueue.count()).toBe(0);
		expect(h.env.pending()).toEqual([INTERVAL]);
	});

	it('sends at the debounce once another passage is edited', async () => {
		const h = await syncedPassage();
		const before = h.remote.pulls();
		await practise(h.db, h.note);
		await quiet();

		const other = await write(h.db, 'Plan');
		await quiet();
		expect(h.env.pending()).toEqual([DEBOUNCE, LAZY, INTERVAL]);
		h.env.advance(DEBOUNCE);

		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(other.path)).toContain('Plan, in words.');
			expect(levels(h.remote.fake.contentAt(h.note.path))).toEqual([1]);
		});
		await reaches(h.scheduler, 'idle');
		expect(h.remote.pulls()).toBe(before + 1);
		expect(h.env.pending()).toEqual([INTERVAL]);
	});

	it('sends a pass at once when the page is hidden', async () => {
		const h = await syncedPassage();
		const before = h.remote.pulls();
		await practise(h.db, h.note);
		await quiet();
		expect(h.env.pending()).toEqual([LAZY, INTERVAL]);

		h.env.state.visible = false;
		h.env.fire('visibilitychange');

		await vi.waitFor(() => {
			expect(levels(h.remote.fake.contentAt(h.note.path))).toEqual([1]);
		});
		await reaches(h.scheduler, 'idle');
		expect(h.remote.pulls()).toBe(before + 1);
		// Nothing is left waiting, and hidden, the poll does nothing.
		expect(h.env.pending()).toEqual([INTERVAL]);
		h.env.advance(INTERVAL);
		await quiet();
		expect(h.remote.pulls()).toBe(before + 1);
	});

	it('ends the wait with any run that sends the pass', async () => {
		const h = await syncedPassage();
		const before = h.remote.pulls();
		await practise(h.db, h.note);
		await quiet();
		expect(h.env.pending()).toEqual([LAZY, INTERVAL]);

		await focused(h);

		expect(levels(h.remote.fake.contentAt(h.note.path))).toEqual([1]);
		expect(h.env.pending()).toEqual([INTERVAL]);
		h.env.advance(LAZY);
		await quiet();
		expect(h.remote.pulls()).toBe(before + 1);
	});

	it('lets the wait go with the binding', async () => {
		const h = await syncedPassage();
		await practise(h.db, h.note);
		await quiet();
		expect(h.env.pending()).toEqual([LAZY, INTERVAL]);

		await unbindLibrary(h.db);
		await reaches(h.scheduler, 'local');

		expect(h.env.pending()).toEqual([]);
	});
});

describe('offline', () => {
	it('does not try, and syncs when the network comes back', async () => {
		const db = await bound();
		const env = fakeEnvironment();
		env.state.online = false;
		const theRemote = remote();
		const server = tokenServer();
		const scheduler = createSyncScheduler({
			db,
			client: server,
			createProvider: theRemote.factory,
			environment: env.environment,
		});
		cleanups.unshift(() => {
			scheduler.stop();
		});

		scheduler.start();
		await reaches(scheduler, 'offline');
		expect(theRemote.pulls()).toBe(0);
		expect(server.token).not.toHaveBeenCalled();
		expect(env.pending()).toEqual([]);

		env.state.online = true;
		env.fire('online');
		await reaches(scheduler, 'idle');
		expect(theRemote.pulls()).toBe(1);
	});

	it('says so as soon as the browser does', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');

		h.env.state.online = false;
		h.env.fire('offline');

		expect(h.scheduler.status().phase).toBe('offline');
		expect(h.env.pending()).toEqual([]);
	});

	it('reads a failure after the network went as being offline, not as an error', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		h.remote.fake.setFault((call) => {
			if (call.op !== 'changes') return undefined;
			h.env.state.online = false;
			return new TypeError('Failed to fetch');
		});

		await h.scheduler.syncNow();

		expect(h.scheduler.status()).toMatchObject({ phase: 'offline', error: undefined });
		expect(h.env.pending()).toEqual([]);
	});
});

describe('failures', () => {
	it('retries with a backoff that doubles, up to its cap, and resets on success', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		h.remote.fake.setFault((call) =>
			call.op === 'changes' ? new Error('503 Service Unavailable') : undefined
		);

		await h.scheduler.syncNow();
		expect(h.scheduler.status()).toMatchObject({
			phase: 'retrying',
			error: '503 Service Unavailable',
		});
		const delays = [h.env.pending()];
		const wait = async (ms: number) => {
			const before = h.remote.pulls();
			h.env.advance(ms);
			await vi.waitFor(() => {
				expect(h.remote.pulls()).toBe(before + 1);
			});
			await reaches(h.scheduler, 'retrying');
			delays.push(h.env.pending());
		};
		await wait(BACKOFF);
		await wait(2 * BACKOFF);
		await wait(4 * BACKOFF);

		expect(delays).toEqual([[BACKOFF], [2 * BACKOFF], [4 * BACKOFF], [4 * BACKOFF]]);

		h.remote.fake.setFault(undefined);
		h.env.advance(4 * BACKOFF);
		await reaches(h.scheduler, 'idle');
		expect(h.scheduler.status().error).toBeUndefined();
		expect(h.env.pending()).toEqual([INTERVAL]);

		h.remote.fake.setFault((call) => (call.op === 'changes' ? new Error('again') : undefined));
		await h.scheduler.syncNow();
		expect(h.env.pending()).toEqual([BACKOFF]);
	});

	it('leaves a retry to its backoff when focus or the page coming back comes first', async () => {
		const db = await bound();
		const note = await write(db, 'Plan', 'one\n');
		const h = started(db);
		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('one');
		});
		await reaches(h.scheduler, 'idle');
		h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('503') : undefined));
		await reword(db, note, 'two\n');
		await quiet();
		await h.scheduler.syncNow();
		expect(h.scheduler.status().phase).toBe('retrying');
		const pulls = h.remote.pulls();

		h.env.fire('focus');
		h.env.state.visible = false;
		h.env.fire('visibilitychange');
		h.env.state.visible = true;
		h.env.fire('visibilitychange');
		await quiet();

		expect(h.remote.pulls()).toBe(pulls);
		expect((await db.opQueue.toArray()).map((op) => op.attempts)).toEqual([1]);

		// The backoff's own retry, and the outage is over.
		h.remote.fake.setFault(undefined);
		h.env.advance(BACKOFF);
		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('two');
		});
		await reaches(h.scheduler, 'idle');

		// And with nothing failing, focus syncs straight away again.
		h.env.fire('focus');
		await vi.waitFor(() => {
			expect(h.remote.pulls()).toBe(pulls + 2);
		});
	});

	it('does not follow a failed sync straight away for a focus that came during it', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const held = deferred();
		h.remote.gate.set('changes', held.promise);
		h.remote.fake.setFault((call) => (call.op === 'changes' ? new Error('503') : undefined));

		const arrived = h.remote.gated();
		const running = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		h.env.fire('focus');
		h.remote.gate.delete('changes');
		held.resolve();
		await running;
		await quiet();

		expect(h.remote.gated()).toBe(arrived + 1);
		expect(h.scheduler.status().phase).toBe('retrying');
		expect(h.env.pending()).toEqual([BACKOFF]);
	});

	it('does follow a sync that went well for a focus that came during it', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const held = deferred();
		h.remote.gate.set('changes', held.promise);

		const arrived = h.remote.gated();
		const running = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		h.env.fire('focus');
		h.remote.gate.delete('changes');
		held.resolve();
		await running;

		expect(h.remote.gated()).toBe(arrived + 2);
	});

	it('is not left deaf when the network drops during a backoff and no online event follows', async () => {
		const db = await bound();
		const note = await write(db, 'Plan', 'one\n');
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		h.remote.fake.setFault((call) => (call.op === 'changes' ? new Error('503') : undefined));
		await h.scheduler.syncNow();
		expect(h.scheduler.status().phase).toBe('retrying');
		h.remote.fake.setFault(undefined);

		// The network goes, and comes back while the page is frozen: no `online`.
		h.env.state.online = false;
		h.env.fire('offline');
		expect(h.env.pending()).toEqual([]);
		h.env.state.online = true;
		const before = h.remote.pulls();
		await reword(db, note, 'two\n');

		h.env.fire('focus');

		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('two');
		});
		await reaches(h.scheduler, 'idle');
		expect(h.remote.pulls()).toBeGreaterThan(before);
	});

	it('refreshes a token the provider refuses, and carries on', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		h.remote.rejected.add('t1');

		await h.scheduler.syncNow();

		expect(h.scheduler.status().phase).toBe('idle');
		expect(h.server.token).toHaveBeenCalledTimes(2);
		expect(h.remote.tokensUsed.at(-1)).toBe('t2');
		expect((await db.syncState.get(CONNECTION))?.accessToken).toBe('t2');
	});

	it('asks for attention when the server will not mint a token, and does not retry', async () => {
		const db = await bound();
		const token = vi.fn<ApiClient['token']>(() =>
			Promise.resolve({ ok: false, refusal: 'reauthorize_required' })
		);
		const h = started(db, { client: presenting(token) });

		await reaches(h.scheduler, 'attention');

		expect(h.scheduler.status().refusal).toBe('reauthorize_required');
		expect(h.env.pending()).toEqual([]);
		expect(h.remote.fake.callLog()).toEqual([]);
	});

	it('asks for attention when this device holds no credential for the connection', async () => {
		const db = freshDatabase();
		await bindLibrary(db, ACCOUNT);
		const h = started(db);

		await reaches(h.scheduler, 'attention');

		expect(h.scheduler.status().refusal).toBe('credential_required');
		expect(h.server.withCredential).not.toHaveBeenCalled();
		expect(h.env.pending()).toEqual([]);
		expect(h.remote.fake.callLog()).toEqual([]);
	});

	it('asks for attention when even a fresh token is refused', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		h.remote.rejected.add('t1');
		h.remote.rejected.add('t2');

		await h.scheduler.syncNow();

		expect(h.scheduler.status()).toMatchObject({
			phase: 'attention',
			refusal: undefined,
			error: 'authorization required',
		});
		expect(h.env.pending()).toEqual([]);
	});

	it('clears the refusal once a token is minted again', async () => {
		const db = await bound();
		const token = vi
			.fn<ApiClient['token']>()
			.mockResolvedValueOnce({ ok: false, refusal: 'credential_revoked' })
			.mockResolvedValue({
				ok: true,
				value: { accessToken: 'ok', expiresAt: Date.now() + HOUR },
			});
		const h = started(db, { client: presenting(token) });
		await reaches(h.scheduler, 'attention');
		const syncing: SchedulerStatus[] = [];
		h.scheduler.subscribe((status) => {
			if (status.phase === 'syncing') syncing.push(status);
		});

		h.env.fire('focus');

		await reaches(h.scheduler, 'idle');
		expect(h.scheduler.status().refusal).toBeUndefined();
		// Not even while it tries: what went wrong last time is not news yet.
		expect(syncing.length).toBeGreaterThan(0);
		expect(syncing.filter((status) => status.error ?? status.refusal)).toEqual([]);
	});

	it('retries when the token server cannot be reached', async () => {
		const db = await bound();
		const token = vi.fn<ApiClient['token']>(() =>
			Promise.reject(new TypeError('Failed to fetch'))
		);
		const h = started(db, { client: presenting(token) });

		await reaches(h.scheduler, 'retrying');

		expect(h.env.pending()).toEqual([BACKOFF]);
	});

	it('asks for attention over an op that keeps failing, and keeps pulling', async () => {
		const db = await bound();
		const note = await write(db, 'Stuck');
		const h = started(db, { maxAttempts: 3 });
		await reaches(h.scheduler, 'idle');
		await reword(db, note, 'more\n');
		h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('nope') : undefined));
		h.env.state.now += 1000;

		await [1, 2, 3, 4].reduce(async (prior) => {
			await prior;
			await nextTimer(h);
		}, Promise.resolve());

		expect(h.scheduler.status()).toMatchObject({
			phase: 'attention',
			lastSyncAt: h.env.state.now,
		});
		expect(h.env.pending()).toEqual([INTERVAL]);
	});

	it('gives an op eight tries by default', async () => {
		const db = await bound();
		const note = await write(db, 'Stuck');
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		await reword(db, note, 'more\n');
		h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('nope') : undefined));

		const phases = await [1, 2, 3, 4, 5, 6, 7, 8, 9].reduce<Promise<SyncPhase[]>>(
			async (prior) => {
				const seen = await prior;
				await nextTimer(h);
				return [...seen, h.scheduler.status().phase];
			},
			Promise.resolve([])
		);

		expect(phases).toEqual([...Array<SyncPhase>(8).fill('retrying'), 'attention']);
	});

	describe('reading everything again', () => {
		it('discards the cursor, keeps the folder, and scans', async () => {
			const db = await bound();
			const note = await write(db, 'Plan', 'one\n');
			const h = started(db);
			await reaches(h.scheduler, 'idle');
			// The sync after the first asks with the stored cursor.
			await h.scheduler.syncNow();
			const before = await db.syncState.get(CONNECTION);
			expect(before?.cursor).toBeDefined();
			expect(h.remote.cursors.at(-1)).toBeDefined();

			await h.scheduler.resync();

			// `undefined` is a full scan: everything read again.
			expect(h.remote.cursors.at(-1)).toBeUndefined();
			const after = await db.syncState.get(CONNECTION);
			// The app folder is the same folder; finding it again buys nothing.
			expect(after?.rootId).toBe(before?.rootId);
			// Defined again, so the next sync is an ordinary one — but not
			// necessarily a different string: a cursor names the state the scan
			// ended at, and nothing here changed while it ran.
			expect(after?.cursor).toBeDefined();
			expect(h.scheduler.status().phase).toBe('idle');
			expect(h.remote.fake.contentAt(note.path)).toContain('one');
		});

		it('keeps what the account is called, through a sync and through the re-scan', async () => {
			const db = await bound({ displayName: 'ada@example.com' });
			const h = started(db);
			await reaches(h.scheduler, 'idle');
			// A token, a root, a cursor and a time have all been written to the
			// row by now, each by a different writer.
			const synced = await db.syncState.get(CONNECTION);
			expect(synced?.accessToken).toBeDefined();
			expect(synced?.rootId).toBeDefined();
			expect(synced?.cursor).toBeDefined();
			expect(synced?.displayName).toBe('ada@example.com');

			await h.scheduler.resync();

			expect((await db.syncState.get(CONNECTION))?.displayName).toBe('ada@example.com');
		});

		it('waits for a run already at the network, whose cursor would land on top of ours', async () => {
			// The held run is mid-round with a cursor of its own, and writes it
			// back when that round lands. Clearing outside the lock, the clear
			// happens first and is then undone — and the user is told the sync
			// succeeded, so the re-scan they asked for never happens and never
			// says so. Inside it, the held run finishes and ours is the last word.
			const db = await bound();
			const h = started(db);
			await reaches(h.scheduler, 'idle');
			await h.scheduler.syncNow();
			expect((await db.syncState.get(CONNECTION))?.cursor).toBeDefined();

			const held = deferred();
			h.remote.gate.set('changes', held.promise);
			const arrived = h.remote.gated();
			const inFlight = h.scheduler.syncNow();
			await vi.waitFor(() => {
				expect(h.remote.gated()).toBe(arrived + 1);
			});
			const mark = h.remote.cursors.length;

			const rescan = h.scheduler.resync();
			h.remote.gate.delete('changes');
			held.resolve();
			await Promise.all([inFlight, rescan]);

			// A full scan, after the held run's round and whatever it wrote.
			expect(h.remote.cursors.slice(mark)).toContain(undefined);
			expect(h.scheduler.status().phase).toBe('idle');
		});

		describe('with a file listed as not UTF-8 text', () => {
			/** "café" as Latin-1: `0xE9` alone is not a UTF-8 sequence. */
			const LATIN1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x0a]);

			/** Synced, with one such file on the remote and listed. */
			const listing = async () => {
				const db = await bound();
				const h = started(db);
				await reaches(h.scheduler, 'idle');
				const file = h.remote.fake.plantBytes('old.md', LATIN1);
				await h.scheduler.syncNow();
				const listed = [{ remoteId: file.remoteId, path: 'old.md' }];
				expect((await db.syncState.get(CONNECTION))?.unreadable).toEqual(listed);
				return { db, h, file, listed };
			};

			it('keeps it listed through a re-scan that finds the file still there', async () => {
				const { db, h, listed } = await listing();

				await h.scheduler.resync();

				expect(h.remote.cursors.at(-1)).toBeUndefined();
				expect((await db.syncState.get(CONNECTION))?.unreadable).toEqual(listed);
			});

			it('keeps it listed while the re-scan cannot finish, and lets the scan that does decide', async () => {
				// Dropping the cursor drops nothing else. A notice blanked when the
				// scan starts is a notice lost for as long as the device is offline.
				const { db, h, file, listed } = await listing();
				await h.remote.fake.delete(file);
				h.remote.fake.setFault((call) =>
					call.op === 'changes' ? new Error('offline') : undefined
				);

				await h.scheduler.resync();

				const waiting = await db.syncState.get(CONNECTION);
				expect(waiting?.cursor).toBeUndefined();
				expect(waiting?.unreadable).toEqual(listed);

				h.remote.fake.setFault(undefined);
				await h.scheduler.syncNow();

				const scanned = await db.syncState.get(CONNECTION);
				expect(scanned?.cursor).toBeDefined();
				expect(scanned?.unreadable).toBeUndefined();
			});
		});

		it('does nothing at all with no connection', async () => {
			const { scheduler, remote: theRemote } = started(freshDatabase());

			await scheduler.resync();

			expect(theRemote.pulls()).toBe(0);
			expect(scheduler.status().phase).toBe('local');
		});
	});

	describe('a provider asking for room', () => {
		/** Idle, with the next `changes` answering a rate limit. */
		const throttled = async (retryAfterMs?: number) => {
			const db = await bound();
			const h = started(db);
			await reaches(h.scheduler, 'idle');
			h.remote.fake.setFault((call) =>
				call.op === 'changes' ? new RateLimitError('slow down', retryAfterMs) : undefined
			);
			return h;
		};

		it('waits as long as it was asked to, not only as long as it would have', async () => {
			const h = await throttled(30_000);

			await h.scheduler.syncNow();

			expect(h.scheduler.status().phase).toBe('retrying');
			// The provider is the only party that knows when it will serve us.
			expect(h.env.pending()).toEqual([30_000]);
		});

		it('does not come back sooner than its own backoff', async () => {
			// A wait of a second on the umpteenth failure in a row is not an
			// invitation to come straight back.
			const h = await throttled(1000);

			await h.scheduler.syncNow();

			expect(h.env.pending()).toEqual([BACKOFF]);
		});

		it('uses its own backoff when nothing was said', async () => {
			const h = await throttled();

			await h.scheduler.syncNow();

			expect(h.env.pending()).toEqual([BACKOFF]);
		});

		it('caps a wait no user could make sense of', async () => {
			// Drive's daily quota says "tomorrow". Coming back in a quarter of an
			// hour costs one refused request, and it says so again.
			const h = await throttled(24 * HOUR);

			await h.scheduler.syncNow();

			expect(h.env.pending()).toEqual([15 * 60_000]);
		});

		it('never gives up on an op the provider would not look at', async () => {
			// Counted like any other failure, a throttled write would be blocked
			// after `maxAttempts` throttles and the user told their passage cannot
			// be sent — about a write the remote never saw.
			const db = await bound();
			const note = await write(db, 'Plan', 'one\n');
			const h = started(db, { maxAttempts: 2 });
			await vi.waitFor(() => {
				expect(h.remote.fake.contentAt(note.path)).toContain('one');
			});
			await reaches(h.scheduler, 'idle');
			await reword(db, note, 'two\n');
			h.remote.fake.setFault((call) =>
				call.op === 'write' ? new RateLimitError('slow down', 1000) : undefined
			);

			const phases = await [1, 2, 3, 4].reduce<Promise<SyncPhase[]>>(async (prior) => {
				const seen = await prior;
				await nextTimer(h);
				return [...seen, h.scheduler.status().phase];
			}, Promise.resolve([]));

			expect(phases).toEqual(Array<SyncPhase>(4).fill('retrying'));
			expect((await db.opQueue.toArray()).map((op) => op.attempts)).toEqual([0]);
			expect(h.scheduler.status().stuck).toBeUndefined();

			// And it lands the moment the provider stops saying no.
			h.remote.fake.setFault(undefined);
			await nextTimer(h);
			expect(h.remote.fake.contentAt(note.path)).toContain('two');
		});
	});

	describe('an op that has failed too often', () => {
		const blockedHarness = async (options: Partial<SyncSchedulerOptions> = {}) => {
			const db = await bound();
			const note = await write(db, 'Stuck', 'one\n');
			const h = started(db, { maxAttempts: 2, ...options });
			await vi.waitFor(() => {
				expect(h.remote.fake.contentAt(note.path)).toContain('one');
			});
			await reaches(h.scheduler, 'idle');
			await reword(db, note, 'two\n');
			h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('503') : undefined));
			await [1, 2, 3].reduce(async (prior) => {
				await prior;
				await nextTimer(h);
			}, Promise.resolve());
			expect(h.scheduler.status().phase).toBe('attention');
			// The outage ends.
			h.remote.fake.setFault(undefined);
			return { ...h, note };
		};

		it('stays blocked for a sync nobody asked for', async () => {
			const h = await blockedHarness();

			await focused(h);

			expect(h.scheduler.status().phase).toBe('attention');
			expect(h.remote.fake.contentAt(h.note.path)).toContain('one');
		});

		it('is not left looking busy when trying it again fails', async () => {
			const h = await blockedHarness({ blockedRetryMs: 0 });
			const original = h.db.transaction.bind(h.db);
			// Only the one that gives the op its attempts back, which is over the
			// queue alone; the sync store's own span several tables.
			const transaction = vi
				.spyOn(h.db, 'transaction')
				.mockImplementation(((...args: unknown[]) =>
					args[1] === h.db.opQueue
						? Promise.reject(new Error('QuotaExceededError'))
						: (original as (...rest: unknown[]) => unknown)(
								...args
							)) as unknown as MemoriamDatabase['transaction']);

			await focused(h);

			expect(transaction.mock.calls.some((call) => call[1] === h.db.opQueue)).toBe(true);
			expect(h.scheduler.status()).toMatchObject({
				phase: 'retrying',
				error: 'QuotaExceededError',
			});
		});

		it('says which op it is, so the screen can name it', async () => {
			// "Some changes could not be sent" leaves the user nothing to act on,
			// and the queue is ordered, so this op is why the rest are waiting.
			const h = await blockedHarness();

			expect(h.scheduler.status().stuck).toEqual({
				op: 'write',
				path: h.note.path,
				noteId: h.note.id,
				attempts: 2,
				error: '503',
			});
		});

		it('says nothing is stuck once the op is being tried again', async () => {
			const h = await blockedHarness();

			await h.scheduler.syncNow();

			expect(h.scheduler.status()).toMatchObject({ phase: 'idle' });
			expect(h.scheduler.status().stuck).toBeUndefined();
		});

		it('stays named through a run that failed without releasing anything', async () => {
			// `status().stuck` says what the queue holds, not what the last publish
			// was about. A run that never got as far as the queue — this one fails
			// on `changes` — changed nothing about it.
			const h = await blockedHarness();
			h.remote.fake.setFault((call) =>
				call.op === 'changes' ? new Error('503') : undefined
			);

			// The minute's sync, which never gets as far as the queue.
			await nextTimer(h);

			expect(h.scheduler.status().phase).toBe('retrying');
			expect(h.scheduler.status().stuck).toMatchObject({ path: h.note.path });
		});

		it('is no longer named once the user has given it its attempts back', async () => {
			// "Sync now" resets every op's attempts, so "after 2 tries" stops being
			// true the moment it is pressed.
			const h = await blockedHarness();
			h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('503') : undefined));

			await h.scheduler.syncNow();

			expect(h.scheduler.status().phase).toBe('retrying');
			expect(h.scheduler.status().stuck).toBeUndefined();
		});

		it('is not still named while the next sync runs, or once it lands', async () => {
			const h = await blockedHarness();
			const seen: (string | undefined)[] = [];
			const stop = h.scheduler.subscribe((status) => {
				if (status.phase === 'syncing') seen.push(status.stuck?.path);
			});

			await h.scheduler.syncNow();
			stop();

			expect(seen.length).toBeGreaterThan(0);
			expect(seen).toEqual(seen.map(() => undefined));
			expect(h.scheduler.status()).toMatchObject({ phase: 'idle' });
			expect(h.scheduler.status().stuck).toBeUndefined();
		});

		it('is given its attempts back by a re-scan', async () => {
			const h = await blockedHarness();

			await h.scheduler.resync();

			expect(h.scheduler.status().phase).toBe('idle');
			expect(h.scheduler.status().stuck).toBeUndefined();
			expect(h.remote.fake.contentAt(h.note.path)).toContain('two');
		});

		it('is tried again when the user asks', async () => {
			const h = await blockedHarness();

			await h.scheduler.syncNow();

			expect(h.scheduler.status().phase).toBe('idle');
			expect(h.remote.fake.contentAt(h.note.path)).toContain('two');
		});

		it('is tried again when the network comes back', async () => {
			const h = await blockedHarness();

			h.env.fire('online');

			await vi.waitFor(() => {
				expect(h.remote.fake.contentAt(h.note.path)).toContain('two');
			});
			await reaches(h.scheduler, 'idle');
		});

		it('is given the full while again the next time it blocks', async () => {
			const h = await blockedHarness({ blockedRetryMs: 3 * INTERVAL });
			await h.scheduler.syncNow();
			expect(h.scheduler.status().phase).toBe('idle');

			// Long after, it blocks again.
			h.env.state.now += 10 * INTERVAL;
			await reword(h.db, h.note, 'three\n');
			h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('503') : undefined));
			await [1, 2, 3].reduce(async (prior) => {
				await prior;
				await nextTimer(h);
			}, Promise.resolve());
			expect(h.scheduler.status().phase).toBe('attention');
			h.remote.fake.setFault(undefined);

			await focused(h);

			expect(h.remote.fake.contentAt(h.note.path)).toContain('two');
			expect(h.scheduler.status().phase).toBe('attention');
		});

		it('is tried again on its own after a while, pulling meanwhile', async () => {
			const h = await blockedHarness({ blockedRetryMs: 3 * INTERVAL });
			const pulls = h.remote.pulls();

			const minute = async () => {
				h.env.advance(INTERVAL);
				await vi.waitFor(() => {
					expect(h.scheduler.status().phase).not.toBe('syncing');
				});
				await quiet();
			};
			await minute();
			await minute();
			expect(h.remote.fake.contentAt(h.note.path)).toContain('one');
			expect(h.remote.pulls()).toBeGreaterThanOrEqual(pulls + 2);

			await minute();

			await vi.waitFor(() => {
				expect(h.remote.fake.contentAt(h.note.path)).toContain('two');
			});
			await reaches(h.scheduler, 'idle');
		});
	});

	it('records a pull that reached the end even when the push after it fails', async () => {
		const db = await bound();
		const note = await write(db, 'Plan');
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		await reword(db, note, 'more\n');
		h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('503') : undefined));
		h.env.state.now += 5000;

		await h.scheduler.syncNow();

		expect(h.scheduler.status()).toMatchObject({
			phase: 'retrying',
			lastSyncAt: h.env.state.now,
		});
		expect((await db.syncState.get(CONNECTION))?.lastSyncAt).toBe(h.env.state.now);
	});

	it('keeps reporting conflict copies, including those of a sync whose push failed', async () => {
		const db = await bound();
		const note = await write(db, 'Plan', 'one\n');
		const h = started(db);
		await vi.waitFor(async () => {
			expect((await row(db, note.id))?.dirty).toBe(0);
		});
		await reaches(h.scheduler, 'idle');
		const version = h.remote.fake.snapshot().find((entry) => entry.path === note.path)?.version;

		// Reworded elsewhere, and here, before either syncs.
		const theirs = (h.remote.fake.contentAt(note.path) ?? '').replace('\none\n', '\nremote\n');
		await h.remote.fake.write(note.path, theirs, { expectedVersion: version });
		await reword(db, note, 'local\n');
		h.remote.fake.setFault((call) => (call.op === 'write' ? new Error('503') : undefined));
		await h.scheduler.syncNow();

		const copies = (await db.notes.toArray())
			.filter((each) => each.path.includes('(conflict'))
			.map((each) => each.path);
		expect(copies).toHaveLength(1);
		expect(h.scheduler.status()).toMatchObject({ phase: 'retrying', conflicts: copies });

		h.remote.fake.setFault(undefined);
		await h.scheduler.syncNow();
		expect(h.scheduler.status()).toMatchObject({ phase: 'idle', conflicts: copies });
	});

	it('merges what two devices practised of one passage, rather than keeping it twice', async () => {
		const h = await syncedPassage();
		const there = await elsewhere(h.remote.fake);
		expect((await there.sync()).status).toBe('ok');

		await practise(there.db, h.note, { chunk: 1, level: 3, device: 'there' });
		expect((await there.sync()).status).toBe('ok');
		await practise(h.db, h.note, { chunk: 0, level: 2 });
		await h.scheduler.syncNow();

		expect(h.scheduler.status()).toMatchObject({ phase: 'idle', conflicts: [] });
		expect(levels(h.remote.fake.contentAt(h.note.path))).toEqual([2, 3]);
		expect((await row(h.db, h.note.id))?.source).toBe(h.remote.fake.contentAt(h.note.path));
		// The passage and the year's activity, each merged rather than copied.
		expect(await h.db.notes.count()).toBe(2);
	});

	it('retries a token server that cannot be reached after it refused', async () => {
		const db = await bound();
		const token = vi
			.fn<ApiClient['token']>()
			.mockResolvedValueOnce({ ok: false, refusal: 'reauthorize_required' })
			.mockRejectedValue(new TypeError('Failed to fetch'));
		const h = started(db, { client: presenting(token) });
		await reaches(h.scheduler, 'attention');

		await focused(h);

		expect(h.scheduler.status()).toMatchObject({ phase: 'retrying', refusal: undefined });
		expect(h.env.pending()).toEqual([BACKOFF]);
	});

	it('goes back to retrying and refreshing once another tab has a token', async () => {
		const db = await bound();
		const token = vi
			.fn<ApiClient['token']>()
			.mockResolvedValueOnce({ ok: false, refusal: 'reauthorize_required' })
			.mockResolvedValue({
				ok: true,
				value: { accessToken: 'fresh', expiresAt: Date.now() + HOUR },
			});
		const h = started(db, { client: presenting(token) });
		await reaches(h.scheduler, 'attention');
		await db.syncState.update(CONNECTION, {
			accessToken: 'from-another-tab',
			accessTokenExpiresAt: Date.now() + 10 * HOUR,
		});
		await focused(h);
		expect(h.scheduler.status().phase).toBe('idle');

		h.remote.fake.setFault((call) => (call.op === 'changes' ? new Error('503') : undefined));
		await h.scheduler.syncNow();
		expect(h.scheduler.status()).toMatchObject({ phase: 'retrying', refusal: undefined });
		expect(h.env.pending()).toEqual([BACKOFF]);

		h.remote.fake.setFault(undefined);
		h.remote.rejected.add('from-another-tab');
		await h.scheduler.syncNow();
		expect(h.scheduler.status().phase).toBe('idle');
		expect(h.remote.tokensUsed.at(-1)).toBe('fresh');
	});

	it('asks for attention, once, when a fresh token is refused before the sync starts', async () => {
		const db = await bound();
		const h = started(db);
		['t1', 't2', 't3', 't4'].forEach((token) => {
			h.remote.rejected.add(token);
		});

		await reaches(h.scheduler, 'attention');
		await quiet();

		expect(h.scheduler.status().error).toBe('authorization required');
		expect(h.env.pending()).toEqual([]);
		expect(h.server.token).toHaveBeenCalledTimes(2);
	});

	it('asks for attention over a provider it has no adapter for', async () => {
		const db = await bound();
		const h = started(db, { createProvider: () => undefined });

		await reaches(h.scheduler, 'attention');

		expect(h.scheduler.status().error).toBe(t('sync.unsupported'));
		expect(h.server.token).not.toHaveBeenCalled();
	});
});

describe('following the binding', () => {
	it('stops syncing when the library is let go', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();

		await unbindLibrary(db);
		await reaches(h.scheduler, 'local');

		expect(h.env.pending()).toEqual([]);
		h.env.fire('focus');
		h.env.fire('online');
		await write(db, 'After');
		await h.scheduler.syncNow();
		await h.scheduler.resync();
		await quiet();
		h.env.advance(INTERVAL);
		await quiet();
		expect(h.remote.pulls()).toBe(before);
		expect(h.scheduler.status().phase).toBe('local');
	});

	it('ends what the session had out at the network', async () => {
		const db = await bound();
		const theRemote = remote();
		const signals: (AbortSignal | undefined)[] = [];
		const h = started(db, {
			createProvider: (input) => {
				signals.push(input.signal);
				return theRemote.factory(input);
			},
		});
		await reaches(h.scheduler, 'idle');
		expect(signals.map((signal) => signal?.aborted)).toEqual([false]);

		await unbindLibrary(db);
		await reaches(h.scheduler, 'local');

		expect(signals.map((signal) => signal?.aborted)).toEqual([true]);
	});

	it('starts again when the library is bound once more, and sends what was made meanwhile', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		await unbindLibrary(db);
		await reaches(h.scheduler, 'local');
		const note = await write(db, 'Unsent');
		// Unbound, nothing is owed: binding queues the whole library afresh.
		expect(await db.opQueue.count()).toBe(0);

		await bindLibrary(db, ACCOUNT);

		await vi.waitFor(() => {
			expect(h.remote.fake.contentAt(note.path)).toContain('Unsent, in words.');
		});
		await reaches(h.scheduler, 'idle');
	});

	it('drops a sync the library was let go of halfway through, without calling it a failure', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const held = deferred();
		h.remote.gate.set('changes', held.promise);
		const phases: SyncPhase[] = [];
		h.scheduler.subscribe((status) => {
			phases.push(status.phase);
		});

		const arrived = h.remote.gated();
		const running = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		await unbindLibrary(db);
		await reaches(h.scheduler, 'local');
		held.resolve();
		await running;
		await quiet();

		expect(h.scheduler.status().phase).toBe('local');
		expect(phases).not.toContain('retrying');
		expect(h.env.pending()).toEqual([]);
	});

	it('runs again, rather than failing, when the library is bound again mid-sync', async () => {
		const h = await syncedPassage();
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
		// Another tab: let go and straight back, which liveQuery may never show.
		await rebindAtOnce(h.db);
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
		expect(h.remote.fake.contentAt(h.note.path)).toBe((await row(h.db, h.note.id))?.source);
	});

	it('follows the library to another connection once the first is let go', async () => {
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

	it('does not run a sync asked for mid-sync once the library has been let go', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();
		const held = deferred();
		h.remote.gate.set('changes', held.promise);

		const arrived = h.remote.gated();
		const running = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		void h.scheduler.syncNow();
		await unbindLibrary(db);
		await reaches(h.scheduler, 'local');
		h.remote.gate.delete('changes');
		held.resolve();
		await running;
		await quiet();

		expect(h.remote.pulls()).toBe(before + 1);
	});

	it('leaves nothing behind when stopped mid-sync', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const held = deferred();
		h.remote.gate.set('changes', held.promise);
		h.remote.fake.setFault((call) => (call.op === 'changes' ? new Error('503') : undefined));

		const arrived = h.remote.gated();
		const running = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		h.scheduler.stop();
		held.resolve();
		await running;
		await quiet();

		expect(h.env.pending()).toEqual([]);
		expect(h.scheduler.status().phase).not.toBe('retrying');
	});

	it('can be started again after it is stopped', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		h.scheduler.stop();
		const before = h.remote.pulls();

		h.scheduler.start();

		await vi.waitFor(() => {
			expect(h.remote.pulls()).toBe(before + 1);
		});
		h.env.fire('focus');
		await vi.waitFor(() => {
			expect(h.remote.pulls()).toBe(before + 2);
		});
	});

	it('never has two syncs of one connection at the network at once', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const held = deferred();
		h.remote.gate.set('changes', held.promise);

		const arrived = h.remote.gated();
		const running = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		// A stop and start mid-sync: a React effect running again does this.
		h.scheduler.stop();
		h.scheduler.start();
		await quiet();
		expect(h.remote.gated()).toBe(arrived + 1);

		h.remote.gate.delete('changes');
		held.resolve();
		await running;
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 2);
		});
		await reaches(h.scheduler, 'idle');
	});

	it('drops a sync that waited for the lock past the end of its session', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const held = deferred();
		h.remote.gate.set('changes', held.promise);

		const arrived = h.remote.gated();
		const running = h.scheduler.syncNow();
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		// The session started here queues behind the lock, and ends before it
		// gets it.
		h.scheduler.stop();
		h.scheduler.start();
		await quiet();
		h.scheduler.stop();
		h.scheduler.start();
		await quiet();

		h.remote.gate.delete('changes');
		held.resolve();
		await running;
		await reaches(h.scheduler, 'idle');
		await quiet();

		expect(h.remote.gated()).toBe(arrived + 2);
	});

	it('does nothing after it is stopped', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const before = h.remote.pulls();

		h.scheduler.stop();
		h.env.fire('focus');
		h.env.fire('online');
		await write(db, 'After');
		h.env.advance(INTERVAL);
		await quiet();

		expect(h.remote.pulls()).toBe(before);
		expect(h.env.pending()).toEqual([]);
	});
});

describe('how far a run has got', () => {
	/** A remote holding three passages this device has never seen. */
	const filled = async () => {
		const theRemote = remote();
		await theRemote.fake.ensureRoot();
		await ['one', 'two', 'three'].reduce(async (prior, name) => {
			await prior;
			await theRemote.fake.write(`${name}.md`, `${name}, in words.\n`, {});
		}, Promise.resolve());
		return theRemote;
	};

	/** Each progress the statuses said, once: a later status carries it as it was. */
	const said = (shown: readonly SchedulerStatus[]) => [
		...new Set(
			shown.flatMap((status) => (status.progress === undefined ? [] : [status.progress]))
		),
	];

	/** Every status published with progress, through a first sync of a filled remote. */
	const scanned = async (
		theRemote: Remote,
		env: FakeEnvironment = fakeEnvironment(),
		overrides: Partial<SyncSchedulerOptions> = {}
	) => {
		const db = await bound();
		const shown: SchedulerStatus[] = [];
		const h = started(db, { progressMs: PROGRESS, ...overrides }, { env, theRemote });
		cleanups.unshift(
			h.scheduler.subscribe((status) => {
				if (status.progress !== undefined) shown.push(status);
			})
		);
		await reaches(h.scheduler, 'idle');
		await vi.waitFor(async () => {
			expect(await db.notes.count()).toBe(3);
		});
		return { ...h, shown };
	};

	it('says how far it has got while it syncs, and nothing once it is done', async () => {
		const db = freshDatabase();
		await write(db, 'Mine');
		await bindLibrary(db, ACCOUNT);
		await holdCredential(db);
		const theRemote = await filled();
		const said: SchedulerStatus[] = [];
		const h = started(db, {}, { theRemote });
		cleanups.unshift(
			h.scheduler.subscribe((status) => {
				said.push(status);
			})
		);

		await reaches(h.scheduler, 'idle');
		await vi.waitFor(() => {
			expect(theRemote.fake.contentAt('mine.md')).toContain('Mine, in words.');
		});

		const shown = said.filter((status) => status.progress !== undefined);
		expect(shown.length).toBeGreaterThan(0);
		expect(shown.every((status) => status.phase === 'syncing')).toBe(true);
		expect(shown[0]?.progress?.stage).toBe('scanning');
		expect(h.scheduler.status().progress).toBeUndefined();
		expect(h.env.pending().filter((ms) => ms < INTERVAL)).toEqual([]);
	});

	it('says it at once, and not again until progressMs has passed', async () => {
		// The clock never moves here, so however often the engine reports, the
		// first is all that is published. A status published for something else
		// while the run goes on carries it as it was.
		const { shown, env } = await scanned(await filled());

		expect(said(shown)).toHaveLength(1);
		expect(said(shown)[0]?.stage).toBe('scanning');
		expect(env.pending().filter((ms) => ms < INTERVAL)).toEqual([]);
	});

	it('says the latest each time progressMs passes', async () => {
		const theRemote = await filled();
		const env = fakeEnvironment();
		// Every read takes as long as the throttle.
		const slow: ProviderFactory = (input) => {
			const provider = theRemote.factory(input);
			if (provider === undefined) return undefined;
			return {
				...provider,
				read: async (entry) => {
					const found = await provider.read(entry);
					env.advance(PROGRESS);
					return found;
				},
			};
		};

		const { shown, scheduler } = await scanned(theRemote, env, { createProvider: slow });

		expect(said(shown).length).toBeGreaterThan(1);
		expect(shown.every((status) => status.phase === 'syncing')).toBe(true);
		expect(scheduler.status().progress).toBeUndefined();
	});
});
