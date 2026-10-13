import { describe, expect, it } from 'vitest';

import { isLearnt, learningPass } from '../../src/practice/learn.js';
import { type WordResult } from '../../src/practice/typing.js';

const word = (missed = false): WordResult => ({
	missed,
	slipped: false,
	hinted: false,
	hesitated: false,
	ms: 700,
});

const NOW = new Date(2026, 9, 13, 21, 30);

describe('learningPass', () => {
	it('moves a new chunk up the ladder, and says when', () => {
		const { progress, faded } = learningPass(undefined, [word(), word(), word()], NOW);
		expect(faded).toEqual({ level: 2, learnt: false });
		expect(progress).toEqual({ level: 2, reviewed: NOW.toISOString().slice(0, 19) + 'Z' });
	});

	it('adds the pass’s misses to the chunk’s', () => {
		const { progress } = learningPass(
			{ level: 3, misses: [1, 0, 0] },
			[word(true), word(), word(true)],
			NOW
		);
		expect(progress.misses).toEqual([2, 0, 1]);
		expect(progress.level).toBe(2);
	});

	it('learns a chunk on a clean pass at the top, due the next day', () => {
		const { progress, faded } = learningPass({ level: 5 }, [word(), word()], NOW);
		expect(faded.learnt).toBe(true);
		expect(progress.due).toBe('2026-10-14');
		expect(progress.learnt).toBe('2026-10-13');
		expect(isLearnt(progress)).toBe(true);
	});

	it('keeps the day a chunk was first learnt, and its review, when it is learnt again', () => {
		const { progress, faded } = learningPass(
			{ level: 5, due: '2026-10-20', learnt: '2026-09-01', stability: 1.2 },
			[word(), word()],
			NOW
		);
		expect(faded.learnt).toBe(true);
		expect(progress).toMatchObject({ due: '2026-10-20', learnt: '2026-09-01', stability: 1.2 });
	});

	it('keeps what it does not change', () => {
		const { progress } = learningPass(
			{ level: 1, extra: { mood: 'calm' }, lapses: 2 },
			[word()],
			NOW
		);
		expect(progress).toMatchObject({ extra: { mood: 'calm' }, lapses: 2 });
	});

	it('has learnt nothing of a chunk never practised', () => {
		expect(isLearnt(undefined)).toBe(false);
		expect(isLearnt({ level: 5 })).toBe(false);
	});
});
