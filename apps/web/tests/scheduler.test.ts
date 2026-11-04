import { MARKER_FILE } from '@memoriam/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { unbindLibrary } from '../src/store/connection.js';
import {
	createSyncScheduler,
	type SchedulerEvent,
	SYNC_WAIT_MS,
	type SyncPhase,
} from '../src/sync/scheduler.js';
import { freshDatabase } from './support/db.js';
import { fakeEnvironment } from './support/fakes/environment.js';
import {
	BACKOFF,
	bound,
	cleanups,
	CONNECTION,
	DEBOUNCE,
	deferred,
	focused,
	INTERVAL,
	LAZY,
	levels,
	practise,
	quiet,
	reaches,
	remote,
	reword,
	started,
	stopSchedulers,
	syncedPassage,
	tokenServer,
	TWO_VERSES,
	write,
} from './support/scheduler.js';

/**
 * The sync scheduler (docs/ARCHITECTURE.md §10, "The sync client"): when it
 * syncs, and when it sends what was written. What it says about a failed
 * attempt is in `scheduler.failures.test.ts`; how it follows the library's
 * binding, and how far a run has got, in `scheduler.connection.test.ts`. The
 * harness all three share is `tests/support/scheduler.ts`.
 *
 * skysa-notes' scheduler tests, ported, less what the port left behind — the
 * change relay, the clipboard, files read on demand, an import that can be
 * cancelled or resumed, the wait on another tab's reads of the database,
 * several sources at once —
 * and with tests of its own for when practice is sent ("Push timing").
 */

afterEach(stopSchedulers);

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

describe('a run held up on another tab', () => {
	it('says so behind another tab’s sync of the library, and stops once it has its turn', async () => {
		const db = await bound();
		const h = started(db);
		await reaches(h.scheduler, 'idle');
		const theirs = deferred();
		const theirSync = h.env.environment.withLock(
			`memoriam:sync:${CONNECTION}`,
			() => theirs.promise
		);
		const held = deferred();
		h.remote.gate.set('changes', held.promise);
		const arrived = h.remote.gated();

		h.env.fire('focus');
		await reaches(h.scheduler, 'syncing');
		h.env.advance(SYNC_WAIT_MS - 1);
		expect(h.scheduler.status().waiting).toBeUndefined();
		h.env.advance(1);
		expect(h.scheduler.status()).toMatchObject({ phase: 'syncing', waiting: true });

		theirs.resolve();
		await theirSync;
		await vi.waitFor(() => {
			expect(h.remote.gated()).toBe(arrived + 1);
		});
		expect(h.scheduler.status().phase).toBe('syncing');
		expect(h.scheduler.status().waiting).toBeUndefined();

		h.remote.gate.delete('changes');
		held.resolve();
		await reaches(h.scheduler, 'idle');
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
