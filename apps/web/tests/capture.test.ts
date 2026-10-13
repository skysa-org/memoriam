import { describe, expect, it } from 'vitest';

import { typedBetween } from '../src/practice/capture.js';

describe('typedBetween', () => {
	it('is what was added', () => {
		expect(typedBetween('', 't')).toEqual(['t']);
		expect(typedBetween('t', 'tl')).toEqual(['l']);
		expect(typedBetween('', 'tli')).toEqual(['t', 'l', 'i']);
	});

	it('is what follows the part both share, when a keyboard rewrites its word', () => {
		expect(typedBetween('tlim', 'tlIms')).toEqual(['I', 'm', 's']);
	});

	it('is nothing for a deletion or no change', () => {
		expect(typedBetween('tl', 't')).toEqual([]);
		expect(typedBetween('t', 't')).toEqual([]);
	});

	it('keeps a character made of two code units whole', () => {
		expect(typedBetween('a', 'a𝒜')).toEqual(['𝒜']);
		expect(typedBetween('𝒜', '𝒝')).toEqual(['𝒝']);
	});
});
