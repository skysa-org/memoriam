import { createSyncEngine, mergeFile, RateLimitError } from '@memoriam/core';
import type { FakeProvider } from '@memoriam/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../src/api/client.js';
import { t } from '../src/i18n/t.js';
import { bindLibrary } from '../src/store/connection.js';
import { LOCAL_CONNECTION_ID, type MemoriamDatabase, type OpQueueRecord } from '../src/store/db.js';
import type { SchedulerStatus, SyncPhase, SyncSchedulerOptions } from '../src/sync/scheduler.js';
import { createDexieSyncStore } from '../src/sync/store.js';
import { freshDatabase } from './support/db.js';
import {
	ACCOUNT,
	BACKOFF,
	bound,
	CONNECTION,
	deferred,
	focused,
	HOUR,
	INTERVAL,
	levels,
	nextTimer,
	practise,
	presenting,
	quiet,
	reaches,
	reword,
	row,
	started,
	stopSchedulers,
	syncedPassage,
	write,
} from './support/scheduler.js';

afterEach(stopSchedulers);

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

		it('names a row this version cannot read as one, not by a kind it has no words for (#447)', async () => {
			// A kind a later version queued: the engine fails it until the push
			// stops on it, and the scheduler names it as one this version cannot
			// read, where its own kind means nothing here.
			const db = await bound();
			const h = started(db, { maxAttempts: 2 });
			await reaches(h.scheduler, 'idle');
			await db.opQueue.add({
				connectionId: LOCAL_CONNECTION_ID,
				op: 'teleport',
				path: 'Away.md',
				attempts: 2,
				lastError: 'queued op 1: teleport',
				queuedAt: 0,
			} as unknown as OpQueueRecord);
			await focused(h);

			expect(h.scheduler.status().phase).toBe('attention');
			expect(h.scheduler.status().stuck).toEqual({
				op: 'malformed',
				path: 'Away.md',
				attempts: 2,
				error: 'queued op 1: teleport',
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
