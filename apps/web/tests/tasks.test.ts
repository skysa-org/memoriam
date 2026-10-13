import {
	type ChunkedPassage,
	chunkPassage,
	type ChunkProgress,
	MAX_LEVEL,
	type Progress,
} from '@memoriam/core';
import { describe, expect, it } from 'vitest';

import {
	linkAfter,
	passAt,
	runsAfter,
	runThrough,
	type Task,
	tasksOf,
	withRelearning,
} from '../src/practice/tasks.js';

const cut = (body: string): ChunkedPassage => {
	const chunked = chunkPassage(body, 1);
	if (chunked === undefined) throw new Error('chunker 1 is missing');
	return chunked;
};

/** A section of `count` lines, each a sentence of five words: chunks of about four lines. */
const lines = (count: number, from = 0): string =>
	Array.from({ length: count }, (_, at) => `Line ${String(from + at)} has five words.`).join(
		'\n'
	);

const PSALM = cut(`${lines(12)}\n\n${lines(8, 100)}\n`);
const FIRST_SECTION = PSALM.chunks.filter((chunk) => chunk.section === 0).length;

const progressOf = (entries: Readonly<Record<number, ChunkProgress>>): Progress => ({
	chunks: new Map(
		Object.entries(entries).map(([at, entry]) => [PSALM.chunks[Number(at)]?.key ?? '', entry])
	),
	opaque: {},
});

const LEARNT: ChunkProgress = { level: MAX_LEVEL, due: '2026-10-14' };

describe('the passage the tests use', () => {
	it('has sections of several chunks', () => {
		expect(FIRST_SECTION).toBeGreaterThanOrEqual(3);
		expect(PSALM.chunks.length - FIRST_SECTION).toBeGreaterThanOrEqual(2);
	});
});

describe('tasksOf', () => {
	it('makes a task of each chunk a review step names, and keeps the rest as they are', () => {
		expect(
			tasksOf([
				{ kind: 'review', id: 'a', chunks: [2, 0] },
				{ kind: 'relearn', id: 'b', chunk: 1 },
				{ kind: 'learn', id: 'a', chunk: 3 },
			])
		).toEqual([
			{ kind: 'review', id: 'a', chunk: 2 },
			{ kind: 'review', id: 'a', chunk: 0 },
			{ kind: 'relearn', id: 'b', chunk: 1 },
			{ kind: 'learn', id: 'a', chunk: 3 },
		]);
	});
});

describe('withRelearning', () => {
	const relearn: Task = { kind: 'relearn', id: 'a', chunk: 0, level: 3 };

	it('waits until the reviews still to come are done', () => {
		const queue: Task[] = [
			{ kind: 'review', id: 'a', chunk: 1 },
			{ kind: 'learn', id: 'b', chunk: 0 },
		];
		expect(withRelearning(queue, relearn)).toEqual([queue[0], relearn, queue[1]]);
	});

	it('goes last when there is nothing but reviews', () => {
		expect(withRelearning([], relearn)).toEqual([relearn]);
		const reviews: Task[] = [{ kind: 'review', id: 'a', chunk: 1 }];
		expect(withRelearning(reviews, relearn)).toEqual([...reviews, relearn]);
	});
});

describe('linkAfter', () => {
	it('joins a chunk to the one before, when that one is learnt', () => {
		const task = linkAfter('a', PSALM, progressOf({ 0: LEARNT }), 1);
		expect(task?.kind).toBe('link');
		expect(task !== undefined && 'span' in task ? task.span.end : 0).toBe(PSALM.chunks[1]?.end);
	});

	it('is none when the one before is not learnt, or there is none in the section', () => {
		expect(linkAfter('a', PSALM, progressOf({ 0: { level: 3 } }), 1)).toBeUndefined();
		expect(linkAfter('a', PSALM, progressOf({}), 0)).toBeUndefined();
		expect(linkAfter('a', PSALM, progressOf({ 0: LEARNT }), FIRST_SECTION)).toBeUndefined();
	});
});

describe('runsAfter', () => {
	const chunkedOf = (id: string) => (id === 'a' ? PSALM : undefined);

	it('runs through each section learnt in, to the last chunk learnt there', () => {
		const runs = runsAfter(
			[
				{ id: 'a', chunk: 1 },
				{ id: 'a', chunk: 2 },
				{ id: 'a', chunk: FIRST_SECTION + 1 },
			],
			chunkedOf
		);
		expect(runs).toEqual([
			{ kind: 'run', id: 'a', span: { start: 0, end: PSALM.chunks[2]?.end } },
			{
				kind: 'run',
				id: 'a',
				span: {
					start: PSALM.chunks[FIRST_SECTION]?.start,
					end: PSALM.chunks[FIRST_SECTION + 1]?.end,
				},
			},
		]);
	});

	it('is none where the run would be the chunk alone, or the passage is gone', () => {
		expect(runsAfter([{ id: 'a', chunk: 0 }], chunkedOf)).toEqual([]);
		expect(runsAfter([{ id: 'b', chunk: 1 }], chunkedOf)).toEqual([]);
	});
});

describe('runThrough', () => {
	it('covers the passage, section by section, in runs no longer than the window', () => {
		const runs = runThrough('a', PSALM, 45);
		const spans = runs.map((task) => ('span' in task ? task.span : undefined));
		expect(spans[0]?.start).toBe(0);
		expect(spans.at(-1)?.end).toBe(PSALM.words.length);
		spans.forEach((span, at) => {
			expect((span?.end ?? 0) - (span?.start ?? 0)).toBeLessThanOrEqual(45);
			const next = spans[at + 1];
			if (next !== undefined) expect(next.start).toBe(span?.end);
		});
		// No run crosses from one section into the next.
		expect(spans.some((span) => span?.start === PSALM.chunks[FIRST_SECTION]?.start)).toBe(true);
	});
});

describe('passAt', () => {
	it('learns a chunk from its own level, or from the level the task says', () => {
		const progress = progressOf({ 1: { level: 2 } });
		expect(passAt({ kind: 'learn', id: 'a', chunk: 1 }, PSALM, progress)?.level).toBe(2);
		expect(passAt({ kind: 'learn', id: 'a', chunk: 0 }, PSALM, progress)?.level).toBe(0);
		const relearn = passAt(
			{ kind: 'relearn', id: 'a', chunk: 1, level: 3 },
			PSALM,
			progressOf({ 1: LEARNT })
		);
		expect(relearn?.level).toBe(3);
		expect(relearn?.shown.filter((shown) => shown === 'placeholder').length).toBeGreaterThan(0);
	});

	it('reviews, links and runs bare', () => {
		const review = passAt(
			{ kind: 'review', id: 'a', chunk: 0 },
			PSALM,
			progressOf({ 0: LEARNT })
		);
		expect(review?.level).toBe(MAX_LEVEL);
		expect(review?.shown.every((shown) => shown === 'bare')).toBe(true);
		const run = passAt(
			{ kind: 'run', id: 'a', span: { start: 0, end: 12 } },
			PSALM,
			progressOf({})
		);
		expect(run?.span).toEqual({ start: 0, end: 12 });
		expect(run?.shown).toHaveLength(12);
	});

	it('is none for a chunk the passage no longer has', () => {
		expect(
			passAt({ kind: 'learn', id: 'a', chunk: 99 }, PSALM, progressOf({}))
		).toBeUndefined();
	});
});
