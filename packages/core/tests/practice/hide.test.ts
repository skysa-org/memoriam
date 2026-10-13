import { describe, expect, it } from 'vitest';

import { HIDDEN_SHARE, hideWords, type PastPass, type Shown } from '../../src/practice/hide.js';

const hiddenOf = (shown: readonly Shown[]): boolean[] => shown.map((each) => each !== 'word');

const longestRun = (hidden: readonly boolean[]): number =>
	hidden.reduce(
		({ run, best }, each) => {
			const next = each ? run + 1 : 0;
			return { run: next, best: Math.max(best, next) };
		},
		{ run: 0, best: 0 }
	).best;

const none = (count: number): boolean[] => Array.from({ length: count }, () => false);

/** Passes at a level, none missed, each with its own seed. */
const passes = (count: number, level: number, times: number, seed: number): PastPass[] =>
	Array.from({ length: times }).reduce<PastPass[]>(
		(history, _, at) => [
			...history,
			{
				hidden: hiddenOf(hideWords(count, { level, seed: seed + at, history })),
				missed: none(count),
			},
		],
		[]
	);

const SEEDS = Array.from({ length: 60 }, (_, at) => at * 7919 + 1);
const SIZES = [1, 2, 3, 7, 12, 20, 33, 45];

describe('hideWords', () => {
	it('shows every word at level 0, and none at the top', () => {
		expect(hideWords(3, { level: 0, seed: 1, history: [] })).toEqual(['word', 'word', 'word']);
		expect(hideWords(3, { level: 5, seed: 1, history: [] })).toEqual(['bare', 'bare', 'bare']);
		expect(hideWords(3, { level: 4, seed: 1, history: [] })).toEqual([
			'placeholder',
			'placeholder',
			'placeholder',
		]);
	});

	it('hides about the share of its level, and one word at the least', () => {
		[1, 2, 3].forEach((level) => {
			SIZES.forEach((count) => {
				const hidden = hiddenOf(hideWords(count, { level, seed: 5, history: [] }));
				const want = Math.max(1, Math.round((HIDDEN_SHARE[level] ?? 0) * count));
				// The runs allowed can leave it a word or so short, never over.
				expect(
					hidden.filter(Boolean).length,
					`L${String(level)} of ${String(count)}`
				).toBeLessThanOrEqual(want);
				expect(hidden.filter(Boolean).length).toBeGreaterThanOrEqual(
					Math.min(want, Math.ceil(want * 0.8))
				);
			});
		});
	});

	it('hides no more than two in a row at level 1, three at level 2', () => {
		SEEDS.forEach((seed) => {
			SIZES.forEach((count) => {
				const one = passes(count, 1, 4, seed).map((pass) => longestRun(pass.hidden));
				const two = passes(count, 2, 4, seed).map((pass) => longestRun(pass.hidden));
				expect(Math.max(...one)).toBeLessThanOrEqual(2);
				expect(Math.max(...two)).toBeLessThanOrEqual(3);
			});
		});
	});

	it('hides every word within a few passes', () => {
		const within: Readonly<Record<number, number>> = { 1: 5, 2: 3, 3: 2 };
		SEEDS.forEach((seed) => {
			SIZES.forEach((count) => {
				[1, 2, 3].forEach((level) => {
					const history = passes(count, level, within[level] ?? 0, seed);
					const ever = none(count).map((_, at) =>
						history.some((pass) => pass.hidden[at])
					);
					expect(
						ever.every(Boolean),
						`L${String(level)}, ${String(count)} words, seed ${String(seed)}`
					).toBe(true);
				});
			});
		});
	});

	it('hides at level 2 mostly the half it showed last time', () => {
		// Not always all of it: a run of four shown words cannot all be hidden
		// next time, three in a row being the most at this level.
		const overlaps = SEEDS.map((seed) => {
			const [first, second] = passes(20, 2, 2, seed);
			return (first?.hidden ?? []).filter((each, at) => each && second?.hidden[at]).length;
		});
		expect(Math.max(...overlaps)).toBeLessThanOrEqual(4);
		expect(overlaps.reduce((sum, each) => sum + each, 0) / overlaps.length).toBeLessThan(1);
	});

	it('shows a missed word on the next pass, and hides it on the pass after', () => {
		const count = 12;
		const missed = none(count).map((_, at) => at === 4);
		const first: PastPass = { hidden: none(count).map((_, at) => at === 4), missed };
		[1, 2, 3, 4].forEach((level) => {
			const next = hideWords(count, { level, seed: 3, history: [first] });
			expect(next[4], `L${String(level)}`).toBe('word');
			const second: PastPass = { hidden: hiddenOf(next), missed: none(count) };
			const after = hideWords(count, { level, seed: 3, history: [first, second] });
			expect(after[4], `L${String(level)}`).toBe('placeholder');
		});
	});

	it('hides the same words from the same seed, and others from another', () => {
		const input = { level: 2, seed: 99, history: [] };
		expect(hideWords(30, input)).toEqual(hideWords(30, input));
		expect(SEEDS.map((seed) => hideWords(30, { ...input, seed }).join())).not.toEqual(
			SEEDS.map(() => hideWords(30, input).join())
		);
	});

	it('hides a word missed often less than one never missed', () => {
		const misses = none(12).map((_, at) => (at === 0 ? 6 : 0));
		const times = (at: number) =>
			SEEDS.filter(
				(seed) => hideWords(12, { level: 1, seed, history: [], misses })[at] !== 'word'
			).length;
		expect(times(0)).toBeLessThan(times(6));
	});

	it('has nothing to hide in a chunk of no words', () => {
		expect(hideWords(0, { level: 2, seed: 1, history: [] })).toEqual([]);
	});
});
