import { describe, expect, it } from 'vitest';

import { type ChunkedPassage, chunkPassage } from '../../src/passage/chunk.js';
import { type ChunkProgress, type Progress } from '../../src/progress/codec.js';
import { daysHeld, measure } from '../../src/rewards/mastery.js';

const cut = (body: string): ChunkedPassage => {
	const chunked = chunkPassage(body, 1);
	if (chunked === undefined) throw new Error('chunker 1 is missing');
	return chunked;
};

const lines = (count: number): string =>
	Array.from({ length: count }, (_, at) => `Line ${String(at)} has five words.`).join('\n');

const PASSAGE = cut(`${lines(8)}\n`);
const NOW = new Date(2026, 9, 13, 9);

const progressOf = (...entries: readonly (ChunkProgress | undefined)[]): Progress => ({
	chunks: new Map(
		entries.flatMap((entry, at) => {
			const key = PASSAGE.chunks[at]?.key;
			return entry === undefined || key === undefined ? [] : [[key, entry] as const];
		})
	),
	opaque: {},
});

const LEARNT: ChunkProgress = { level: 5, due: '2026-10-20', learnt: '2026-09-01' };

describe('measure', () => {
	it('has two chunks to work with', () => {
		expect(PASSAGE.chunks).toHaveLength(2);
	});

	it('is nothing known of a passage never practised', () => {
		expect(measure(PASSAGE, progressOf(), NOW)).toEqual({
			words: 40,
			learntWords: 0,
			mastery: 0,
			learnt: false,
			mastered: false,
		});
	});

	it('counts the words of chunks learnt, and not one forgotten since', () => {
		const half = measure(PASSAGE, progressOf(LEARNT, { level: 2 }), NOW);
		expect(half.mastery).toBe(0.5);
		expect(half.learnt).toBe(false);
		const lapsed = measure(PASSAGE, progressOf(LEARNT, { ...LEARNT, level: 3 }), NOW);
		expect(lapsed.learntWords).toBe(20);
	});

	it('weighs health by words, from each learnt chunk’s chance of recall now', () => {
		const fresh = measure(PASSAGE, progressOf(LEARNT, LEARNT), NOW);
		// Learnt and never reviewed: a new card, sure to be recalled.
		expect(fresh.health).toBe(1);
		const fading = measure(
			PASSAGE,
			progressOf(
				{
					...LEARNT,
					stability: 2,
					difficulty: 5,
					reps: 1,
					reviewed: '2026-09-01T09:00:00Z',
				},
				LEARNT
			),
			NOW
		);
		expect(fading.health).toBeGreaterThan(0.5);
		expect(fading.health).toBeLessThan(1);
	});

	it('is mastered once every chunk is held for three weeks', () => {
		const held = { ...LEARNT, stability: 21, reviewed: '2026-10-10T09:00:00Z' };
		expect(measure(PASSAGE, progressOf(held, held), NOW).mastered).toBe(true);
		expect(measure(PASSAGE, progressOf(held, { ...held, stability: 20 }), NOW).mastered).toBe(
			false
		);
	});

	it('is held since its last chunk was learnt, while it is kept up', () => {
		const passage = measure(
			PASSAGE,
			progressOf(LEARNT, { ...LEARNT, learnt: '2026-09-12' }),
			NOW
		);
		expect(passage.heldSince).toBe('2026-09-12');
		expect(daysHeld(passage, '2026-10-13')).toBe(31);
		const overdue = measure(PASSAGE, progressOf(LEARNT, { ...LEARNT, due: '2026-10-12' }), NOW);
		expect(overdue.heldSince).toBeUndefined();
		expect(daysHeld(overdue, '2026-10-13')).toBeUndefined();
		// Learnt before the day was kept: not known how long.
		const { learnt: _, ...undated } = LEARNT;
		expect(measure(PASSAGE, progressOf(LEARNT, undated), NOW).heldSince).toBeUndefined();
	});
});
