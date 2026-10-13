import { describe, expect, it } from 'vitest';

import { grade, type GradeOptions } from '../../src/practice/grade.js';
import { type PassSummary } from '../../src/practice/pass.js';

const pass = (over: Partial<PassSummary> = {}): PassSummary => {
	const words = over.words ?? 20;
	const missed = over.missed ?? 0;
	return {
		words,
		missed,
		slipped: 0,
		hinted: 0,
		hesitations: 0,
		correct: (words - missed) / words,
		medianMs: 700,
		...over,
	};
};

const REVIEW: GradeOptions = { review: true, usualMs: 800 };
const LEARNING: GradeOptions = { review: false, usualMs: 800 };

describe('grade', () => {
	it.each<[string, PassSummary, GradeOptions, string]>([
		['a hint', pass({ hinted: 1, missed: 1 }), REVIEW, 'again'],
		['over 15% missed', pass({ missed: 4 }), REVIEW, 'again'],
		['15% missed', pass({ missed: 3 }), REVIEW, 'hard'],
		['two misses in a short chunk', pass({ words: 8, missed: 2 }), REVIEW, 'again'],
		['one miss in a short chunk', pass({ words: 8, missed: 1 }), REVIEW, 'hard'],
		['two misses in ten words', pass({ words: 10, missed: 2 }), REVIEW, 'again'],
		['one miss', pass({ missed: 1 }), REVIEW, 'hard'],
		['no misses, two hesitations', pass({ hesitations: 2 }), REVIEW, 'hard'],
		['no misses, one hesitation', pass({ hesitations: 1 }), REVIEW, 'good'],
		['clean and quick, a review', pass(), REVIEW, 'easy'],
		['clean and quick, learning', pass(), LEARNING, 'good'],
		['clean but slower than usual', pass({ medianMs: 900 }), REVIEW, 'good'],
		['clean, with no usual pace yet', pass(), { review: true }, 'good'],
		['slips only', pass({ slipped: 3 }), REVIEW, 'easy'],
	])('%s: %s', (_, summary, options, expected) => {
		expect(grade(summary, options)).toBe(expected);
	});

	it('fails a pass left before its end, however it was going', () => {
		expect(grade(pass(), { ...REVIEW, abandoned: true })).toBe('again');
	});
});
