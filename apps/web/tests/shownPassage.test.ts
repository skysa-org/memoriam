import { chunkPassage } from '@memoriam/core';
import { describe, expect, it } from 'vitest';

import { lineText, shownPassage } from '../src/components/shownPassage.js';

const shown = (body: string) => {
	const chunked = chunkPassage(body, 1);
	if (chunked === undefined) throw new Error('chunker 1 is missing');
	return shownPassage(chunked).map((section) => ({
		label: section.label,
		chunks: section.chunks.map((chunk) => ({
			keyed: chunk.key !== undefined,
			lines: chunk.lines.map(lineText),
		})),
	}));
};

describe('shownPassage', () => {
	it('shows each section under its label, as its chunks', () => {
		expect(shown('# Psalm 23\nThe Lord is my *shepherd*;\nI shall not want.\n')).toEqual([
			{
				label: 'Psalm 23',
				chunks: [{ keyed: true, lines: ['The Lord is my shepherd;', 'I shall not want.'] }],
			},
		]);
	});

	it('keeps a line with nothing to type where it is', () => {
		expect(shown('* * *\nHe said 你好.\n春眠不覺曉\n')).toEqual([
			{
				label: undefined,
				chunks: [
					{ keyed: false, lines: ['* * *'] },
					{ keyed: true, lines: ['He said 你好.', '春眠不覺曉'] },
				],
			},
		]);
	});

	it('cuts a line too long for one chunk where the chunk ends', () => {
		const line = Array.from({ length: 60 }, (_, at) => `w${String(at)}`).join(' ');
		const [section] = shown(`  ${line}\n`);
		const lines = section?.chunks.flatMap((chunk) => chunk.lines) ?? [];
		expect(section?.chunks.length).toBeGreaterThan(1);
		expect(lines.join('')).toBe(`  ${line}`);
	});
});
