import { chunkPassage, NO_PROGRESS, type Progress } from '@memoriam/core';
import { describe, expect, it } from 'vitest';

import { lineText } from '../src/components/shownPassage.js';
import { chunkLines, contextFor, nextToLearn } from '../src/practice/plan.js';

const BODY =
	'# Verse 1\nThe Lord is my shepherd; I shall not want.\nHe makes me lie down in green pastures.\nHe leads me beside still waters.\nHe restores my soul.\nHe leads me in paths of righteousness\nfor his name’s sake.\n\n# Verse 2\nEven though I walk through the valley of the shadow of death,\nI will fear no evil.\n';

const chunked = (() => {
	const cut = chunkPassage(BODY, 1);
	if (cut === undefined) throw new Error('chunker 1 is missing');
	return cut;
})();

const learnt = (...at: number[]): Progress => ({
	chunks: new Map(
		at.map((n) => [chunked.chunks[n]?.key ?? '', { level: 5, due: '2026-10-14' }] as const)
	),
	opaque: {},
});

describe('nextToLearn', () => {
	it('is the first chunk not yet learnt, from where it is asked', () => {
		expect(chunked.chunks).toHaveLength(3);
		expect(nextToLearn(chunked, NO_PROGRESS)).toBe(0);
		expect(nextToLearn(chunked, learnt(0))).toBe(1);
		expect(nextToLearn(chunked, learnt(1), 1)).toBe(2);
		expect(nextToLearn(chunked, learnt(1, 2), 1)).toBe(0);
		expect(nextToLearn(chunked, learnt(0, 1, 2))).toBeUndefined();
	});
});

describe('chunkLines', () => {
	it('is a chunk’s lines, with what leads each', () => {
		const [, second] = chunked.chunks;
		if (second === undefined) throw new Error('no second chunk');
		expect(chunkLines(chunked, second).map(lineText)).toEqual([
			'He leads me beside still waters.',
			'He restores my soul.',
			'He leads me in paths of righteousness',
			'for his name’s sake.',
		]);
	});
});

describe('contextFor', () => {
	it('is the line before, the section’s label, or the title', () => {
		expect(contextFor(chunked, 0, 'Psalm 23')).toBe('Verse 1');
		expect(contextFor(chunked, 1, 'Psalm 23')).toBe('He makes me lie down in green pastures.');
		expect(contextFor(chunked, 2, 'Psalm 23')).toBe('Verse 2');
		const plain = chunkPassage('Jesus wept.\n', 1);
		expect(plain && contextFor(plain, 0, 'John 11:35')).toBe('John 11:35');
	});
});
