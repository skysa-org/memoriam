import { beforeEach, describe, expect, it } from 'vitest';

import { parsePassageFile } from '../../src/markdown/passage.js';
import { chunkPassage } from '../../src/passage/chunk.js';
import { readProgress } from '../../src/progress/codec.js';
import { createFakeProvider, type FakeProvider } from '../../src/providers/fake.js';
import { readActivity } from '../../src/rewards/activity.js';
import { createSyncEngine, type MergeInput } from '../../src/sync/engine.js';
import { mergeFile } from '../../src/sync/merge.js';
import type { SyncStore } from '../../src/sync/store.js';
import { entryAt } from './kit/remote.js';
import { editHere, renameHere } from './kit/userActions.js';
import { createMemoryStore, type MemoryStore } from './memoryStore.js';

/**
 * Merging before a conflict copy (docs/ARCHITECTURE.md §10): a passage
 * practised on two devices, and a year's activity both added to, come out as
 * one file with everything either side recorded. Anything else is kept twice,
 * as skysa-notes keeps it.
 */

const BODY = 'Jesus wept.\n\nRejoice always.\n';
const [FIRST = '', SECOND = ''] = chunkPassage(BODY, 1)?.chunks.map((chunk) => chunk.key) ?? [];

/** The passage as a device holds it, with these chunks' progress. */
const passage = (progress: readonly string[], body = BODY) =>
	`---\nid: p1\ntitle: Two verses\nchunker: 1\n${
		progress.length === 0 ? '' : `progress:\n${progress.map((line) => `  ${line}\n`).join('')}`
	}---\n\n${body}`;

const at = (key: string, level: number, day: number) =>
	`${key}: { level: ${String(level)}, reviewed: 2026-10-${String(day)}T09:00:00Z }`;

const levels = (text: string | undefined) =>
	Object.fromEntries(
		[...readProgress(parsePassageFile(text ?? '').progress).chunks].map(([key, entry]) => [
			key,
			entry.level,
		])
	);

const activity = (days: readonly string[]) =>
	`---\ndays:\n${days.map((line) => `  ${line}\n`).join('')}---\n`;

const ACTIVITY = '.memoriam/activity-2026.md';

describe('mergeFile', () => {
	const merge = (path: string, local: string, remote: string) =>
		mergeFile({ path, local, remote } satisfies MergeInput);

	it('takes each chunk from the side that practised it later, the remote on a tie', () => {
		const local = passage([at(FIRST, 2, 10), at(SECOND, 4, 12)]);
		const remote = passage([at(FIRST, 3, 11), at(SECOND, 1, 12)]);
		expect(levels(merge('two.md', local, remote))).toEqual({ [FIRST]: 3, [SECOND]: 1 });
	});

	it('is ours where the remote adds nothing', () => {
		const local = passage([at(FIRST, 2, 12)]);
		expect(merge('two.md', local, passage([at(FIRST, 1, 10)]))).toBe(local);
	});

	it('is none where the words or details differ', () => {
		const local = passage([at(FIRST, 2, 12)]);
		expect(merge('two.md', local, passage([], 'Jesus wept.\n'))).toBeUndefined();
		expect(
			merge('two.md', local, passage([]).replace('title: Two verses', 'title: Two'))
		).toBeUndefined();
	});

	it('merges a year of activity day by day', () => {
		const merged = merge(
			ACTIVITY,
			activity(['2026-10-12~a: { words: 9, passes: 1 }']),
			activity(['2026-10-13~b: { words: 20, passes: 2 }'])
		);
		expect([...readActivity(merged ?? '').days.keys()]).toEqual([
			'2026-10-12~a',
			'2026-10-13~b',
		]);
	});

	it('is none for activity either side cannot read, so neither is written over', () => {
		const readable = activity(['2026-10-12~a: { words: 9, passes: 1 }']);
		expect(merge(ACTIVITY, readable, '---\ndays: [not, a, map]\n---\n')).toBeUndefined();
		expect(merge(ACTIVITY, '---\ndays: [\n---\n', readable)).toBeUndefined();
	});

	it('is none for any other file', () => {
		expect(merge('notes.txt', 'a\n', 'b\n')).toBeUndefined();
		expect(merge('.memoriam/notes.md', passage([]), passage([at(FIRST, 1, 1)]))).toBe(
			undefined
		);
	});
});

describe('the engine, merging', () => {
	let provider: FakeProvider;
	let store: MemoryStore;
	let ids = 0;

	const engineWith = (
		merge: ((file: MergeInput) => string | undefined) | undefined,
		on: SyncStore = store
	) =>
		createSyncEngine({
			provider,
			store: on,
			now: () => new Date('2026-10-13T09:00:00Z'),
			newId: () => {
				ids += 1;
				return `copy-${String(ids)}`;
			},
			...(merge === undefined ? {} : { merge }),
		});

	const noteAt = (path: string) => store.notes().find((note) => note.path === path);

	/** A passage synced to this device, then practised here and, unseen, on another. */
	const practisedOnBoth = async (local: string, remote: string) => {
		const engine = engineWith(mergeFile);
		await provider.write('two.md', passage([at(FIRST, 1, 9)]), {});
		await engine.pull();
		const note = noteAt('two.md');
		if (note === undefined) throw new Error('not pulled');
		editHere(store, note, local);
		await provider.write('two.md', remote, {
			expectedVersion: entryAt(provider, 'two.md').version,
		});
		return engine;
	};

	beforeEach(async () => {
		ids = 0;
		provider = createFakeProvider({ startAt: new Date('2026-01-01T00:00:00Z') });
		await provider.ensureRoot();
		store = createMemoryStore();
	});

	it('merges on a pull, and sends the merge', async () => {
		const engine = await practisedOnBoth(
			passage([at(FIRST, 1, 9), at(SECOND, 2, 12)]),
			passage([at(FIRST, 3, 11)])
		);

		const result = await engine.sync();

		expect(result).toMatchObject({ status: 'ok', conflicts: [] });
		expect(levels(provider.contentAt('two.md'))).toEqual({ [FIRST]: 3, [SECOND]: 2 });
		expect(noteAt('two.md')).toMatchObject({ dirty: false });
		expect(store.notes()).toHaveLength(1);
	});

	it('merges when a push finds the remote moved on', async () => {
		const engine = await practisedOnBoth(
			passage([at(FIRST, 1, 9), at(SECOND, 2, 12)]),
			passage([at(FIRST, 3, 11)])
		);

		const result = await engine.push();

		expect(result).toMatchObject({ status: 'ok', pushed: 1, conflicts: [] });
		expect(levels(provider.contentAt('two.md'))).toEqual({ [FIRST]: 3, [SECOND]: 2 });
		expect(noteAt('two.md')?.dirty).toBe(false);
		expect(await store.pendingOps()).toEqual([]);
	});

	it('sends nothing where the remote already holds everything', async () => {
		const remote = passage([at(FIRST, 3, 11)]);
		const engine = await practisedOnBoth(passage([at(FIRST, 2, 10)]), remote);
		const writes = () => provider.callLog().filter((call) => call.op === 'write').length;
		const before = writes();

		expect(await engine.sync()).toMatchObject({ status: 'ok', conflicts: [] });
		expect(noteAt('two.md')).toMatchObject({ content: remote, dirty: false });
		expect(writes()).toBe(before);
	});

	it('leaves the merge at the name a rename queued here gave it', async () => {
		// Renamed here and not yet pushed: the merge is made where the note
		// is now, not moved back to the name the remote still has it under.
		const engine = await practisedOnBoth(
			passage([at(FIRST, 1, 9), at(SECOND, 2, 12)]),
			passage([at(FIRST, 3, 11)])
		);
		const note = noteAt('two.md');
		if (note === undefined) throw new Error('not pulled');
		renameHere(store, note, 'renamed.md');

		expect(await engine.pull()).toMatchObject({ status: 'ok', conflicts: [] });
		expect(noteAt('two.md')).toBeUndefined();
		expect(levels(noteAt('renamed.md')?.content)).toEqual({ [FIRST]: 3, [SECOND]: 2 });
		expect(await engine.push()).toMatchObject({ status: 'ok', conflicts: [] });
		expect(provider.contentAt('two.md')).toBeUndefined();
		expect(levels(provider.contentAt('renamed.md'))).toEqual({ [FIRST]: 3, [SECOND]: 2 });
	});

	it('sends nothing on a push where the merge is the remote, and drops the write', async () => {
		const remote = passage([at(FIRST, 3, 11)]);
		const engine = await practisedOnBoth(passage([at(FIRST, 2, 10)]), remote);
		const version = entryAt(provider, 'two.md').version;

		// The write the remote refuses is the only one sent.
		expect(await engine.push()).toMatchObject({ status: 'ok', pushed: 0, conflicts: [] });
		expect(entryAt(provider, 'two.md').version).toBe(version);
		expect(noteAt('two.md')).toMatchObject({ content: remote, dirty: false });
		expect(await store.pendingOps()).toEqual([]);
	});

	it('merges again from a pass recorded while the first merge was on its way', async () => {
		// The store refuses a merge made from what the note no longer holds, the
		// pull rolls back with its cursor, and the next one merges the newer pass.
		await practisedOnBoth(
			passage([at(FIRST, 1, 9), at(SECOND, 2, 12)]),
			passage([at(FIRST, 3, 11)])
		);
		const cursor = store.storedCursor();
		const practised = { done: false };
		const practising: SyncStore = {
			...store,
			applyChanges: (batch) => {
				const note = noteAt('two.md');
				if (!practised.done && note !== undefined) {
					store.put({ ...note, content: passage([at(FIRST, 1, 9), at(SECOND, 4, 13)]) });
				}
				practised.done = true;
				return store.applyChanges(batch);
			},
		};
		const racing = engineWith(mergeFile, practising);

		expect((await racing.pull()).status).toBe('retry');
		expect(store.storedCursor()).toBe(cursor);
		expect(await racing.sync()).toMatchObject({ status: 'ok', conflicts: [] });
		expect(levels(provider.contentAt('two.md'))).toEqual({ [FIRST]: 3, [SECOND]: 4 });
	});

	it('keeps both where the words differ, as a conflict copy', async () => {
		const engine = await practisedOnBoth(
			passage([at(FIRST, 2, 12)]),
			passage([], 'Jesus wept.\n')
		);

		const result = await engine.sync();

		expect(result.conflicts).toHaveLength(1);
		expect(store.notes()).toHaveLength(2);
	});

	it.each([
		['without a merge', undefined],
		[
			'with a merge that throws',
			() => {
				throw new Error('no');
			},
		],
	])('keeps both, as skysa-notes does, %s', async (_, merge) => {
		await practisedOnBoth(passage([at(FIRST, 2, 12)]), passage([at(FIRST, 3, 11)]));
		const result = await engineWith(merge).sync();

		expect(result.conflicts).toHaveLength(1);
		expect(store.notes()).toHaveLength(2);
	});

	describe("a year's activity begun on two devices before either synced", () => {
		const mine = activity([
			'2026-10-12~a: { words: 9, passes: 1, reviews: 0, started: 9, ms: 1 }',
		]);
		const theirs = activity([
			'2026-10-13~b: { words: 20, passes: 2, reviews: 0, started: 0, ms: 1 }',
		]);

		const begunHere = async () => {
			await provider.createFolder('.memoriam');
			await provider.write(ACTIVITY, theirs, {});
			store.put({ id: 'activity-2026', path: ACTIVITY, content: mine, dirty: true });
			store.queue({ op: 'write', noteId: 'activity-2026', path: ACTIVITY });
		};

		const daysThere = () => [...readActivity(provider.contentAt(ACTIVITY) ?? '').days.keys()];

		it('is one file once pulled', async () => {
			await begunHere();
			expect(await engineWith(mergeFile).sync()).toMatchObject({
				status: 'ok',
				conflicts: [],
			});
			expect(daysThere()).toEqual(['2026-10-12~a', '2026-10-13~b']);
			expect(store.notes()).toHaveLength(1);
		});

		it('is one file when pushed before any pull', async () => {
			await begunHere();
			expect(await engineWith(mergeFile).push()).toMatchObject({
				status: 'ok',
				conflicts: [],
			});
			expect(daysThere()).toEqual(['2026-10-12~a', '2026-10-13~b']);
			expect(noteAt(ACTIVITY)?.dirty).toBe(false);
		});
	});
});
