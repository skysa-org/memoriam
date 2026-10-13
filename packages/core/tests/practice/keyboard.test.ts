import { describe, expect, it } from 'vitest';

import { isNeighbour, QWERTY } from '../../src/practice/keyboard.js';

describe('QWERTY', () => {
	it('knows the keys around a key, as a phone lays them out', () => {
		expect([...(QWERTY.get('g') ?? [])].sort()).toEqual(['f', 'h', 't', 'v', 'y']);
		expect([...(QWERTY.get('a') ?? [])].sort()).toEqual(['q', 's', 'w']);
		expect([...(QWERTY.get('z') ?? [])].sort()).toEqual(['s', 'x']);
		expect([...(QWERTY.get('p') ?? [])].sort()).toEqual(['l', 'o']);
	});

	it('is the same both ways', () => {
		expect(
			[...QWERTY].every(([key, around]) =>
				[...around].every((other) => QWERTY.get(other)?.has(key))
			)
		).toBe(true);
	});

	it('says whether one key is next to another', () => {
		expect(isNeighbour(QWERTY, 's', 'a')).toBe(true);
		expect(isNeighbour(QWERTY, 's', 'k')).toBe(false);
		expect(isNeighbour(QWERTY, 'σ', 'a')).toBe(false);
	});
});
