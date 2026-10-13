import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	type ChunkedPassage,
	chunkKeys,
	chunkPassage,
	keyText,
	knowsChunker,
} from '../../src/passage/chunk.js';

const fixture = (name: string): string =>
	readFileSync(new URL(`fixtures/${name}.txt`, import.meta.url), 'utf8');

const cut = (body: string): ChunkedPassage => {
	const chunked = chunkPassage(body, 1);
	if (chunked === undefined) throw new Error('chunker 1 is missing');
	return chunked;
};

/** The words of each chunk, as text. */
const chunkTexts = (chunked: ChunkedPassage): string[] =>
	chunked.chunks.map((chunk) =>
		chunked.words
			.slice(chunk.start, chunk.end)
			.map((word) => word.text)
			.join(' ')
	);

/** Whether every chunk ends where a reader would pause: a line's end or punctuation. */
const endsAtPauses = (chunked: ChunkedPassage): boolean =>
	chunked.chunks.every((chunk) => {
		const last = chunked.words[chunk.end - 1];
		return last !== undefined && (last.lineEnd || /[.!?…,;:—–)]|\s-|-\s/.test(last.after));
	});

/**
 * A seeded stream of numbers (mulberry32), so a generated passage is the same
 * on every run and a failure can be reproduced.
 */
const random = (seed: number) => {
	const next = (state: number): [number, number] => {
		const s = (state + 0x6d2b79f5) | 0;
		const a = Math.imul(s ^ (s >>> 15), 1 | s);
		const b = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
		return [((b ^ (b >>> 14)) >>> 0) / 4294967296, s];
	};
	return (count: number): number[] =>
		Array.from({ length: count }).reduce<{ out: number[]; state: number }>(
			({ out, state }) => {
				const [value, after] = next(state);
				return { out: [...out, value], state: after };
			},
			{ out: [], state: seed }
		).out;
};

const WORDS = [
	'the',
	'Lord',
	'shepherd',
	'green',
	'still',
	'waters',
	'soul',
	'paths',
	'name',
	'valley',
];
const PUNCTUATION = ['', '', '', '', ',', ';', '.', '!', ' —'];

/** A passage of random words, lines and sections, from a seed. */
const generated = (seed: number): string => {
	const draws = random(seed)(1200);
	const take = (at: number, from: readonly string[]): string =>
		from[Math.floor((draws[at] ?? 0) * from.length)] ?? '';
	return Array.from({ length: 300 }, (_, at) => {
		const word = take(at * 4, WORDS) + take(at * 4 + 1, PUNCTUATION);
		const roll = draws[at * 4 + 2] ?? 0;
		const breakAfter = roll < 0.03 ? '\n\n' : roll < 0.15 ? '\n' : ' ';
		// Now and then a line far too long to be one chunk: no breaks for a while.
		return (draws[at * 4 + 3] ?? 0) < 0.002
			? `${word} ${'and on '.repeat(40)}`
			: word + breakAfter;
	}).join('');
};

describe('chunker 1', () => {
	it('cuts known passages where it always has', () => {
		// Pinned: a passage's progress is keyed by these. A change here orphans
		// it for every passage already learnt, and is a new chunker, not a fix.
		const keys = (name: string) =>
			cut(fixture(name)).chunks.map((chunk) => [chunk.key, chunk.end - chunk.start]);
		expect(keys('psalm-23')).toEqual([
			['dx06kz9', 17],
			['s4ez36r', 21],
			['s3sekkm', 30],
			['ven580x', 21],
			['a9t8e5m', 24],
		]);
		expect(keys('sonnet-18')).toEqual([
			['azbbzt3', 24],
			['f9scpar', 24],
			['j6dfkdt', 21],
			['gxe995q', 25],
			['d37hstx', 20],
		]);
		expect(keys('gettysburg')).toEqual([
			['k550atk', 30],
			['z5fpb20', 24],
			['b2qrrsb', 21],
			['pe9dj21', 28],
			['j2qf15f', 19],
			['c5s6nys', 21],
			['jxzt4fb', 21],
			['h1hd84p', 26],
			['p3wscxe', 16],
			['ea1dkfg', 22],
			['gx277bj', 19],
			['kkaz97r', 25],
		]);
		expect(keys('hope')).toEqual([
			['jntnq9s', 23],
			['kvetemb', 24],
			['vtqs9wk', 22],
		]);
	});

	it('ends every chunk of a real passage at a pause', () => {
		['psalm-23', 'sonnet-18', 'gettysburg', 'hope'].forEach((name) => {
			expect(endsAtPauses(cut(fixture(name))), name).toBe(true);
		});
	});

	it('cuts verse at the ends of lines', () => {
		const sonnet = cut(fixture('sonnet-18'));
		expect(sonnet.chunks.every((chunk) => sonnet.words[chunk.end - 1]?.lineEnd)).toBe(true);
	});

	it('keeps a short section whole', () => {
		expect(chunkTexts(cut('Jesus wept.\n\nRejoice always.\n'))).toEqual([
			'Jesus wept',
			'Rejoice always',
		]);
	});

	it('cuts a line too long for one chunk, in pieces no longer than forty-five words', () => {
		const long = cut(Array.from({ length: 120 }, (_, at) => `word${String(at)}`).join(' '));
		expect(long.chunks.length).toBeGreaterThan(2);
		expect(long.chunks.every((chunk) => chunk.end - chunk.start <= 45)).toBe(true);
	});

	it('gives a refrain a key for each time it comes', () => {
		const refrain = 'Hold fast to dreams\nfor if dreams die';
		const chunked = cut(
			`${refrain}\n\nLife is a broken-winged bird\nthat cannot fly.\n\n${refrain}\n`
		);
		const [first, , again] = chunked.chunks.map((chunk) => chunk.key);
		expect(again).toBe(`${first ?? ''}.2`);
	});

	it('keeps a chunk’s key when only its punctuation, capitals or apostrophes change', () => {
		const before = cut('The Lord is my shepherd; I shall not want.\n');
		const after = cut('the LORD is my shepherd — I shall not want!\n');
		const curly = cut('The Lord’s my shepherd\n');
		const straight = cut("The Lord's my shepherd\n");
		expect(after.chunks[0]?.key).toBe(before.chunks[0]?.key);
		expect(curly.chunks[0]?.key).toBe(straight.chunks[0]?.key);
	});

	it('has nothing for a passage with nothing to type', () => {
		expect(cut('# Only a label\n\n* * *\n').chunks).toEqual([]);
	});

	describe('on any passage', () => {
		const seeds = Array.from({ length: 40 }, (_, at) => at + 1);

		it('covers every word once, in order, and never crosses a section', () => {
			seeds.forEach((seed) => {
				const chunked = cut(generated(seed));
				const covered = chunked.chunks.flatMap((chunk) =>
					Array.from({ length: chunk.end - chunk.start }, (_, at) => chunk.start + at)
				);
				expect(covered, `seed ${String(seed)}`).toEqual(
					chunked.words.map((word) => word.index)
				);
				chunked.chunks.forEach((chunk) => {
					const sections = new Set(
						chunked.words.slice(chunk.start, chunk.end).map((word) => word.section)
					);
					expect([...sections], `seed ${String(seed)}`).toEqual([chunk.section]);
				});
			});
		});

		it('keeps every chunk to forty-five words', () => {
			seeds.forEach((seed) => {
				const sizes = cut(generated(seed)).chunks.map((chunk) => chunk.end - chunk.start);
				expect(Math.max(...sizes), `seed ${String(seed)}`).toBeLessThanOrEqual(45);
			});
		});

		it('gives every chunk a key of its own', () => {
			seeds.forEach((seed) => {
				const keys = cut(generated(seed)).chunks.map((chunk) => chunk.key);
				expect(new Set(keys).size, `seed ${String(seed)}`).toBe(keys.length);
			});
		});

		it('cuts the same text the same way every time, whatever its line endings', () => {
			seeds.slice(0, 10).forEach((seed) => {
				const body = generated(seed);
				expect(cut(body.replaceAll('\n', '\r\n')).chunks).toEqual(cut(body).chunks);
			});
		});
	});
});

describe('chunkKeys', () => {
	it('numbers a repeated text, and a text whose hash another shares', () => {
		expect(chunkKeys(['a', 'b', 'a', 'a'])).toEqual([
			'z294raq',
			'hmc2wvn',
			'z294raq.2',
			'z294raq.3',
		]);
	});
});

describe('keyText', () => {
	it('is the words, lowercase, apostrophes all one', () => {
		expect(keyText([{ text: 'Lord’s' }, { text: 'SHEPHERD' }])).toBe("lord's shepherd");
	});
});

describe('chunkPassage', () => {
	it('declines a chunker this build does not have', () => {
		expect(chunkPassage('Some words', 2)).toBeUndefined();
		expect(knowsChunker(1)).toBe(true);
		expect(knowsChunker(2)).toBe(false);
	});
});
