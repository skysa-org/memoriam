import { describe, expect, it } from 'vitest';

import { median, summarize, tallyMisses } from '../../src/practice/pass.js';
import { type WordResult } from '../../src/practice/typing.js';

const word = (over: Partial<WordResult> = {}): WordResult => ({
	missed: false,
	slipped: false,
	hinted: false,
	hesitated: false,
	ms: 800,
	...over,
});

describe('summarize', () => {
	it('counts what went wrong, and how much was recalled', () => {
		expect(
			summarize([
				word(),
				word({ missed: true, hinted: true, ms: 9000 }),
				word({ slipped: true }),
				word({ hesitated: true, ms: 3000 }),
			])
		).toEqual({
			words: 4,
			missed: 1,
			slipped: 1,
			hinted: 1,
			hesitations: 1,
			correct: 0.75,
			medianMs: 1900,
		});
	});

	it('has all of nothing recalled', () => {
		expect(summarize([])).toEqual({
			words: 0,
			missed: 0,
			slipped: 0,
			hinted: 0,
			hesitations: 0,
			correct: 1,
		});
	});
});

describe('median', () => {
	it('is the middle, or the mean of the middle two', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([4, 1, 3, 2])).toBe(2.5);
		expect(median([])).toBeUndefined();
	});
});

describe('tallyMisses', () => {
	it('adds a pass’s misses to each word’s', () => {
		expect(
			tallyMisses([0, 2, 0], [word(), word({ missed: true }), word({ missed: true })])
		).toEqual([0, 3, 1]);
		expect(tallyMisses(undefined, [word({ missed: true }), word()])).toEqual([1, 0]);
	});

	it('keeps nothing for a chunk never missed', () => {
		expect(tallyMisses(undefined, [word(), word()])).toBeUndefined();
	});

	it('starts again where the counts were for other words', () => {
		expect(tallyMisses([5, 5], [word({ missed: true }), word(), word()])).toEqual([1, 0, 0]);
	});
});
