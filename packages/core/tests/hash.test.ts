import { describe, expect, it } from 'vitest';

import { contentHash, cyrb53, SHORT_KEY_LENGTH, shortKey } from '../src/hash.js';

describe('contentHash', () => {
	it('is the SHA-256 of the text, in hex', async () => {
		expect(await contentHash('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});

describe('cyrb53', () => {
	it('gives the values its author publishes', () => {
		// https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
		expect(cyrb53('a')).toBe(7929297801672961);
		expect(cyrb53('b')).toBe(8684336938537663);
		expect(cyrb53('revenge')).toBe(4051478007546757);
		expect(cyrb53('revenue')).toBe(8309097637345594);
	});

	it('takes a seed', () => {
		expect(cyrb53('a', 1)).toBe(5368154436228575);
	});

	it('hashes text beyond the Basic Multilingual Plane by its code units', () => {
		expect(cyrb53('é😀')).toBe(402108947828814);
	});
});

describe('shortKey', () => {
	const samples = [
		'',
		'a',
		'the lord is my shepherd i shall not want',
		'Ὁ Κύριος ποιμαίνει με',
		...Array.from({ length: 500 }, (_, at) => `chunk ${String(at)}`),
	];

	it('is seven characters of lowercase base 32, starting with a letter', () => {
		samples.forEach((text) => {
			const key = shortKey(text);
			expect(key).toHaveLength(SHORT_KEY_LENGTH);
			expect(key).toMatch(/^[a-hjkmnp-tv-z][0-9a-hjkmnp-tv-z]{6}$/);
		});
	});

	it('is the same for the same text, every time', () => {
		expect(shortKey('the lord is my shepherd i shall not want')).toBe('fhjyk4s');
		expect(shortKey('a')).toBe('z294raq');
	});

	it('tells five hundred chunks apart', () => {
		expect(new Set(samples.map(shortKey)).size).toBe(samples.length);
	});
});
