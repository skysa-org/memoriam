import { describe, expect, it } from 'vitest';

import { type ChunkedPassage, chunkPassage } from '../../src/passage/chunk.js';
import { type ChunkProgress, type Progress } from '../../src/progress/codec.js';
import {
	linkSpan,
	planDay,
	type PlanOptions,
	type PlanPassage,
	runSpan,
} from '../../src/schedule/session.js';

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

const passage = (
	id: string,
	chunked: ChunkedPassage,
	entries: readonly (readonly [number, ChunkProgress])[] = [],
	createdAt = 0
): PlanPassage => ({
	id,
	chunked,
	createdAt,
	progress: {
		chunks: new Map(entries.map(([at, entry]) => [chunked.chunks[at]?.key ?? '', entry])),
		opaque: {},
	} satisfies Progress,
});

const OPTIONS: PlanOptions = {
	now: new Date(2026, 9, 20, 9),
	today: '2026-10-20',
	newWords: 50,
	startedToday: 0,
};

const LEARNT = (due: string, stability = 5): ChunkProgress => ({
	level: 5,
	due,
	stability,
	difficulty: 5,
	reps: 2,
	reviewed: '2026-10-10T09:00:00Z',
});

describe('planDay', () => {
	it('begins a new passage with as many chunks as the day’s new words allow', () => {
		const sizes = PSALM.chunks.map((chunk) => chunk.end - chunk.start);
		const steps = planDay([passage('p', PSALM)], OPTIONS);
		const words = steps.reduce(
			(sum, step) => sum + (step.kind === 'learn' ? (sizes[step.chunk] ?? 0) : 0),
			0
		);
		expect(steps.every((step) => step.kind === 'learn')).toBe(true);
		expect(steps.map((step) => (step.kind === 'learn' ? step.chunk : -1))).toEqual(
			steps.map((_, at) => at)
		);
		expect(words).toBeLessThanOrEqual(50);
		expect(words + (sizes[steps.length] ?? 0)).toBeGreaterThan(50);
	});

	it('counts new words begun earlier in the day, but begins one chunk on a day with none', () => {
		expect(planDay([passage('p', PSALM)], { ...OPTIONS, startedToday: 50 })).toEqual([]);
		expect(planDay([passage('p', PSALM)], { ...OPTIONS, newWords: 5 })).toEqual([
			{ kind: 'learn', id: 'p', chunk: 0 },
		]);
	});

	it('puts reviews first, then relearning, then chunks begun, then new ones', () => {
		const steps = planDay(
			[
				passage('p', PSALM, [
					[0, LEARNT('2026-10-19')],
					[1, { ...LEARNT('2026-10-21'), level: 3 }],
					[2, { level: 2 }],
					[3, LEARNT('2026-10-20')],
				]),
			],
			OPTIONS
		);
		expect(steps.slice(0, 4)).toEqual([
			{ kind: 'review', id: 'p', chunks: [0, 3] },
			{ kind: 'relearn', id: 'p', chunk: 1 },
			{ kind: 'learn', id: 'p', chunk: 2 },
			{ kind: 'learn', id: 'p', chunk: 4 },
		]);
	});

	it('reviews the passage least likely remembered first', () => {
		const steps = planDay(
			[
				passage('sure', PSALM, [[0, LEARNT('2026-10-20', 30)]]),
				passage('shaky', PSALM, [[0, LEARNT('2026-10-20', 1)]]),
			],
			{ ...OPTIONS, newWords: 0, startedToday: 1 }
		);
		expect(steps).toEqual([
			{ kind: 'review', id: 'shaky', chunks: [0] },
			{ kind: 'review', id: 'sure', chunks: [0] },
		]);
	});

	it('goes on with a passage begun before starting one not yet begun', () => {
		const older = passage('older', cut(lines(4)), [], 1);
		const begun = passage('begun', PSALM, [[0, LEARNT('2026-10-30')]], 2);
		const [first] = planDay([older, begun], OPTIONS);
		expect(first).toEqual({ kind: 'learn', id: 'begun', chunk: 1 });
	});

	it('has nothing to do when nothing is due and nothing is left to learn', () => {
		const done = passage('p', cut(lines(4)), [[0, LEARNT('2026-10-30')]]);
		expect(planDay([done], OPTIONS)).toEqual([]);
	});
});

describe('linkSpan', () => {
	it('is the last line of the chunk before, then the chunk', () => {
		const [first, second] = PSALM.chunks;
		const span = linkSpan(PSALM, 1);
		expect(span?.end).toBe(second?.end);
		expect(span?.start).toBe((first?.end ?? 0) - 5);
	});

	it('is none for a section’s first chunk', () => {
		const firstOfSecond = PSALM.chunks.findIndex((chunk) => chunk.section === 1);
		expect(linkSpan(PSALM, 0)).toBeUndefined();
		expect(linkSpan(PSALM, firstOfSecond)).toBeUndefined();
	});
});

describe('runSpan', () => {
	it('runs from the section’s start to the end of the chunk', () => {
		const last = PSALM.chunks.filter((chunk) => chunk.section === 0).length - 1;
		expect(runSpan(PSALM, last)).toEqual({ start: 0, end: PSALM.chunks[last]?.end });
	});

	it('goes back no more than the window allows, from a chunk’s start', () => {
		const last = PSALM.chunks.filter((chunk) => chunk.section === 0).length - 1;
		const span = runSpan(PSALM, last, 30);
		expect(PSALM.chunks.some((chunk) => chunk.start === span?.start)).toBe(true);
		expect((span?.end ?? 0) - (span?.start ?? 0)).toBeLessThanOrEqual(30);
		expect(runSpan(PSALM, last, 1)).toEqual({
			start: PSALM.chunks[last]?.start,
			end: PSALM.chunks[last]?.end,
		});
	});
});
