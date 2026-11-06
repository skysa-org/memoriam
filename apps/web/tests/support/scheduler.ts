/**
 * A scheduler under test: a remote, a server minting tokens, a fake clock and
 * passages to send, for the `scheduler.*.test.ts` files.
 */
import {
	AuthError,
	chunkPassage,
	createFakeProvider,
	CURRENT_CHUNKER,
	type FakeProvider,
	parsePassageFile,
	readProgress,
	ROOT,
	type StorageProvider,
} from '@memoriam/core';
import { expect, vi } from 'vitest';

import type { ApiClient } from '../../src/api/client.js';
import { bindLibrary } from '../../src/store/connection.js';
import { LOCAL_CONNECTION_ID, type MemoriamDatabase, type NoteRecord } from '../../src/store/db.js';
import { createPassage, type PassageDetails, updatePassage } from '../../src/store/passages.js';
import { recordPass } from '../../src/store/practice.js';
import {
	createSyncScheduler,
	type ProviderFactory,
	type SyncPhase,
	type SyncScheduler,
	type SyncSchedulerOptions,
} from '../../src/sync/scheduler.js';
import { holdCredential } from './connection.js';
import { freshDatabase } from './db.js';
import { fakeEnvironment } from './fakes/environment.js';

export const HOUR = 60 * 60 * 1000;
export const CONNECTION = 'c1';
export const ACCOUNT = {
	connectionId: CONNECTION,
	provider: 'dropbox',
	accountId: 'acct',
} as const;
export const DEBOUNCE = 2000;
export const LAZY = 20_000;
export const INTERVAL = 60_000;
export const BACKOFF = 5000;
/** Two chunks, so that each can be practised on its own. */
export const TWO_VERSES = 'Jesus wept.\n\nRejoice always.\n';

export const cleanups: (() => Promise<void> | void)[] = [];

/** What each test started, stopped: `afterEach(stopSchedulers)` in a file that uses `started`. */
export const stopSchedulers = async (): Promise<void> => {
	await Promise.all(
		cleanups.splice(0).map(async (cleanup) => {
			await cleanup();
		})
	);
};

export type FakeEnvironment = ReturnType<typeof fakeEnvironment>;

/** A client that answers with `token` whichever credential it is handed. */
export const presenting = (token: ApiClient['token']) => {
	// The credential is what says which connection, so the client is asked for
	// one bound to it rather than handed an id.
	const withCredential = vi.fn(
		(credential: string) => ({ token, credential }) as unknown as ApiClient
	);
	return { token, withCredential };
};

/** A server minting `t1`, `t2`, … each good for ten hours. */
export const tokenServer = () => {
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

export interface Remote {
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

export const remote = (): Remote => {
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

/** A library bound to a connection this device holds a credential for. */
export const bound = async (binding: Readonly<{ displayName?: string }> = {}) => {
	const db = freshDatabase();
	await bindLibrary(db, { ...ACCOUNT, ...binding });
	await holdCredential(db, CONNECTION);
	return db;
};

interface Harness {
	readonly db: MemoriamDatabase;
	readonly scheduler: SyncScheduler;
	readonly env: FakeEnvironment;
	readonly server: ReturnType<typeof tokenServer>;
	readonly remote: Remote;
}

export const started = (
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

export const reaches = async (scheduler: SyncScheduler, phase: SyncPhase) => {
	await vi.waitFor(() => {
		expect(scheduler.status().phase).toBe(phase);
	});
};

/** A sync the user did not ask for, which leaves blocked ops blocked. */
export const focused = async (h: Harness) => {
	h.env.fire('focus');
	await vi.waitFor(() => {
		expect(h.scheduler.status().phase).not.toBe('syncing');
	});
};

/** Long enough for anything a trigger would have started to have shown itself. */
export const quiet = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 60);
	});

/** Whatever the scheduler is waiting on — a backoff, the poll, an edit — comes due. */
export const nextTimer = async (h: Harness) => {
	// Let an edit's debounce be armed first, rather than come due in the next round.
	await quiet();
	h.env.advance(Math.min(...h.env.pending()));
	await vi.waitFor(() => {
		expect(h.scheduler.status().phase).not.toBe('syncing');
	});
};

export const deferred = () => {
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
export const write = (db: MemoriamDatabase, title: string, text?: string) =>
	createPassage(db, details(title, text));

/** New words for a passage, as the editor saves them. */
export const reword = async (db: MemoriamDatabase, note: NoteRecord, text: string) => {
	const edited = await updatePassage(db, note.id, details(note.title, text));
	expect(edited.ok).toBe(true);
};

export const row = (db: MemoriamDatabase, id: string) => db.notes.get([LOCAL_CONNECTION_ID, id]);

/** A pass on one of a passage's chunks: its write queued lazy, as practice's is. */
export const practise = async (
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
export const levels = (text: string | undefined) =>
	[...readProgress(parsePassageFile(text ?? '').progress).chunks.values()].map(
		(entry) => entry.level
	);

/** Synced once, with a passage of two verses on the remote. */
export const syncedPassage = async (overrides: Partial<SyncSchedulerOptions> = {}) => {
	const db = await bound();
	const note = await write(db, 'Two verses', TWO_VERSES);
	const h = started(db, overrides);
	await vi.waitFor(async () => {
		expect((await row(db, note.id))?.dirty).toBe(0);
	});
	await reaches(h.scheduler, 'idle');
	return { ...h, note };
};
