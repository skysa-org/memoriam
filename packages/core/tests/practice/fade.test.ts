import { describe, expect, it } from 'vitest';

import { fade } from '../../src/practice/fade.js';
import { type PassSummary } from '../../src/practice/pass.js';

const pass = (missed: number, over: Partial<PassSummary> = {}): PassSummary => ({
	words: 20,
	missed,
	slipped: 0,
	hinted: 0,
	hesitations: 0,
	correct: (20 - missed) / 20,
	...over,
});

describe('fade', () => {
	it.each<[string, number, PassSummary, number]>([
		['clean and fluent: up two', 1, pass(0), 3],
		['clean with a hesitation: up one', 1, pass(0, { hesitations: 1 }), 2],
		['90% recalled: up one', 2, pass(2), 3],
		['95% recalled with a hint: the same', 2, pass(1, { hinted: 1 }), 2],
		['85% recalled: the same', 2, pass(3), 2],
		['70% recalled: the same', 2, pass(6), 2],
		['65% recalled: down one', 2, pass(7), 1],
		['down from the bottom: the bottom', 0, pass(15), 0],
		['up from near the top: the top', 4, pass(0), 5],
	])('%s', (_, level, summary, expected) => {
		expect(fade(level, summary).level).toBe(expected);
	});

	it('learns a chunk on a clean pass at the top, slips and all', () => {
		expect(fade(5, pass(0, { slipped: 2, hesitations: 3 }))).toEqual({
			level: 5,
			learnt: true,
		});
	});

	it('does not learn it on a pass with a miss, or below the top', () => {
		expect(fade(5, pass(1))).toEqual({ level: 5, learnt: false });
		expect(fade(4, pass(0))).toEqual({ level: 5, learnt: false });
		expect(fade(5, pass(8))).toEqual({ level: 4, learnt: false });
	});
});
