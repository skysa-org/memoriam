import { describe, expect, it } from 'vitest';

import { isLive, isTombstone } from '../src/store/rowStates.js';

describe('the state a row is in', () => {
	it.each([
		[{ deletedLocally: 0 as const }, true, false],
		[{ deletedLocally: 1 as const }, false, true],
		[undefined, false, false],
	])('%j is live: %s, a tombstone: %s', (note, live, tombstone) => {
		expect(isLive(note)).toBe(live);
		expect(isTombstone(note)).toBe(tombstone);
	});
});
