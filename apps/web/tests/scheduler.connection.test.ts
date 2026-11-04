import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindLibrary, unbindLibrary } from '../src/store/connection.js';
import { type MemoriamDatabase, writerTables } from '../src/store/db.js';
import type {
	ProviderFactory,
	SchedulerStatus,
	SyncPhase,
	SyncSchedulerOptions,
} from '../src/sync/scheduler.js';
import { holdCredential } from './support/connection.js';
import { freshDatabase } from './support/db.js';
import { fakeEnvironment } from './support/fakes/environment.js';
import {
	ACCOUNT,
	bound,
	cleanups,
	CONNECTION,
	deferred,
	type FakeEnvironment,
	INTERVAL,
	quiet,
	reaches,
	type Remote,
	remote,
	row,
	started,
	stopSchedulers,
	syncedPassage,
	write,
} from './support/scheduler.js';

afterEach(stopSchedulers);

const PROGRESS = 150;

/**
 * Let the library go and bind it to the same connection again, as another tab
 * does it: in one step, which liveQuery may never show.
 */
const rebindAtOnce = (db: MemoriamDatabase) =>
	db.transaction('rw', [...writerTables(db), db.fileBytes, db.prefs], async () => {
		await unbindLibrary(db);
		await bindLibrary(db, ACCOUNT);
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
		await holdCredential(db, CONNECTION);
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
