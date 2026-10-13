import { describe, expect, it } from 'vitest';

import { randoms } from '../../src/practice/random.js';

describe('randoms', () => {
	it('is mulberry32: the same numbers from a seed as everywhere else', () => {
		// Pinned: a pass is replayed from its seed, and these are what it hides by.
		expect(randoms(1, 3)).toEqual([
			0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
		]);
	});

	it('gives numbers from 0 up to 1, and others for another seed', () => {
		const drawn = randoms(42, 1000);
		expect(drawn.every((value) => value >= 0 && value < 1)).toBe(true);
		expect(new Set(drawn).size).toBe(1000);
		expect(randoms(43, 3)).not.toEqual(randoms(42, 3));
	});

	it('takes any number as a seed, the same way each time', () => {
		expect(randoms(2 ** 40 + 7, 2)).toEqual(randoms(2 ** 40 + 7, 2));
		expect(randoms(0, 0)).toEqual([]);
	});
});
