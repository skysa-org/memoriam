import { describe, expect, it } from 'vitest';

import { type ChunkedPassage, chunkPassage } from '../../src/passage/chunk.js';
import {
	chunksWithWords as withWords,
	commonWords,
	editedProgress,
	fillGaps,
	remapProgress,
} from '../../src/passage/remap.js';
import { type ChunkProgress, type Progress } from '../../src/progress/codec.js';

const cut = (body: string): ChunkedPassage => {
	const chunked = chunkPassage(body, 1);
	if (chunked === undefined) throw new Error('chunker 1 is missing');
	return chunked;
};

const progressOf = (entries: readonly (readonly [string, ChunkProgress])[]): Progress => ({
	chunks: new Map(entries),
	opaque: {},
});

const STANZAS = [
	'Shall I compare thee to a summer’s day?\nThou art more lovely and more temperate:',
	'Rough winds do shake the darling buds of May,\nAnd summer’s lease hath all too short a date;',
	'Sometime too hot the eye of heaven shines,\nAnd often is his gold complexion dimm’d;',
];

const body = (stanzas: readonly string[]): string => `${stanzas.join('\n\n')}\n`;

describe('remapProgress', () => {
	const before = cut(body(STANZAS));
	const keys = before.chunks.map((chunk) => chunk.key);
	const learnt = progressOf(
		keys.map((key, at) => [
			key,
			{ level: 5, reps: at + 1, misses: [0, 0, 1, 0, 0, 0, 0, 0, 0, 2] },
		])
	);

	it('keeps everything when the words did not change', () => {
		expect(remapProgress(withWords(before), withWords(before), learnt)).toEqual(learnt);
	});

	it('carries a chunk’s progress across a word changed in it, misses with their words', () => {
		const edited = cut(
			body([STANZAS[0] ?? '', STANZAS[1]?.replace('darling', 'dear') ?? '', STANZAS[2] ?? ''])
		);
		const remapped = remapProgress(withWords(before), withWords(edited), learnt);
		const changed = edited.chunks[1]?.key ?? '';
		expect(changed).not.toBe(keys[1]);
		expect([...remapped.chunks.keys()]).toEqual([keys[0], changed, keys[2]]);
		expect(remapped.chunks.get(changed)).toEqual({
			level: 5,
			reps: 2,
			// `darling` was the sixth word and had no miss; the rest are where they were.
			misses: [0, 0, 1, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
		});
	});

	it('starts afresh a chunk rewritten past recognition', () => {
		const edited = cut(
			body([
				STANZAS[0] ?? '',
				'Something else entirely, written here instead.',
				STANZAS[2] ?? '',
			])
		);
		const remapped = remapProgress(withWords(before), withWords(edited), learnt);
		expect([...remapped.chunks.keys()]).toEqual([keys[0], keys[2]]);
	});

	it('keeps what it has around a stanza added between two', () => {
		const added = cut(
			body([STANZAS[0] ?? '', 'A new stanza goes here.', STANZAS[1] ?? '', STANZAS[2] ?? ''])
		);
		const remapped = remapProgress(withWords(before), withWords(added), learnt);
		expect([...remapped.chunks.keys()]).toEqual(keys);
		expect(remapped.chunks.get(keys[1] ?? '')?.reps).toBe(2);
	});

	it('pairs in order, so a chunk does not take a neighbour’s progress', () => {
		const swapped = cut(body([STANZAS[1] ?? '', STANZAS[0] ?? '', STANZAS[2] ?? '']));
		const remapped = remapProgress(withWords(before), withWords(swapped), learnt);
		// Both moved stanzas keep their own words, and so their own keys.
		expect(remapped.chunks.get(keys[0] ?? '')?.reps).toBe(1);
		expect(remapped.chunks.get(keys[1] ?? '')?.reps).toBe(2);
	});

	it('keeps entries no chunk could read', () => {
		const odd: Progress = { ...learnt, opaque: { x: 'kept' } };
		expect(remapProgress(withWords(before), withWords(before), odd).opaque).toEqual({
			x: 'kept',
		});
	});
});

describe('fillGaps', () => {
	const now = cut(body(STANZAS)).chunks.map((chunk) => ({
		key: chunk.key,
		words: chunk.end - chunk.start,
	}));
	const [a, b, c] = now.map((chunk) => chunk.key);

	it('pairs a key no chunk has with the one chunk between the same neighbours', () => {
		const progress = progressOf([
			[a ?? '', { level: 5 }],
			['stale01', { level: 3, misses: Array.from({ length: now[1]?.words ?? 0 }, () => 1) }],
			[c ?? '', { level: 4 }],
		]);
		const filled = fillGaps(now, progress);
		expect([...filled.chunks.keys()]).toEqual([a, b, c]);
		expect(filled.chunks.get(b ?? '')?.level).toBe(3);
		expect(filled.chunks.get(b ?? '')?.misses).toHaveLength(now[1]?.words ?? 0);
	});

	it('drops misses that count a different number of words', () => {
		const progress = progressOf([
			[a ?? '', { level: 5 }],
			['stale01', { level: 3, misses: [1, 2] }],
			[c ?? '', { level: 4 }],
		]);
		expect(fillGaps(now, progress).chunks.get(b ?? '')).toEqual({ level: 3 });
	});

	it('guesses nothing where the counts do not agree', () => {
		const progress = progressOf([
			['stale01', { level: 3 }],
			[c ?? '', { level: 4 }],
		]);
		expect([...fillGaps(now, progress).chunks.keys()]).toEqual([c]);
	});

	it('leaves progress alone where every key matches', () => {
		const progress = progressOf([[b ?? '', { level: 2 }]]);
		expect(fillGaps(now, progress)).toEqual(progress);
	});
});

describe('commonWords', () => {
	it('pairs the longest run of words two lists share in order', () => {
		expect(commonWords(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])).toEqual([
			[0, 0],
			[2, 2],
			[3, 3],
		]);
		expect(commonWords([], ['a'])).toEqual([]);
	});
});

describe('editedProgress', () => {
	const before = body(STANZAS);
	const keys = cut(before).chunks.map((chunk) => chunk.key);
	const block = Object.fromEntries(
		keys.map((key, at) => [key, { level: 5, reps: at + 1, misses: '0,0,1' }])
	);

	it('writes the block for the new words, in passage order', () => {
		const after = body([STANZAS[0] ?? '', 'A new stanza goes here.', STANZAS[2] ?? '']);
		expect(editedProgress(before, after, 1, block)).toEqual({
			changed: true,
			block: { [keys[0] ?? '']: block[keys[0] ?? ''], [keys[2] ?? '']: block[keys[2] ?? ''] },
		});
	});

	it('first fills keys another tool left behind, then carries them', () => {
		// Another tool changed stanza two; the app then changes it again.
		const elsewhere = body([
			STANZAS[0] ?? '',
			STANZAS[1]?.replace('May', 'June') ?? '',
			STANZAS[2] ?? '',
		]);
		const inApp = body([
			STANZAS[0] ?? '',
			STANZAS[1]?.replace('Rough', 'Wild') ?? '',
			STANZAS[2] ?? '',
		]);
		const edited = editedProgress(elsewhere, inApp, 1, block);
		const second = cut(inApp).chunks[1]?.key ?? '';
		// Its misses count three words and the stanza has eighteen: they were
		// for some other words, and filling a gap does not guess which.
		expect(edited.changed && edited.block?.[second]).toEqual({ level: 5, reps: 2 });
	});

	it('takes the block away when nothing is left of it', () => {
		expect(editedProgress(before, 'Nothing like it.\n', 1, block)).toEqual({
			changed: true,
			block: undefined,
		});
	});

	it('leaves alone a passage with no progress, or one cut by a chunker this build lacks', () => {
		expect(editedProgress(before, 'Other words.\n', 1, undefined)).toEqual({ changed: false });
		expect(editedProgress(before, 'Other words.\n', 2, block)).toEqual({ changed: false });
	});

	it('changes nothing when the chunks did not', () => {
		const punctuated = before.replace('day?', 'day!');
		expect(editedProgress(before, punctuated, 1, block)).toEqual({ changed: false });
	});
});
