import { describe, expect, it } from 'vitest';

import { readPassage } from '../../src/passage/text.js';

/** Each section as its label and its lines' words. */
const outline = (body: string) =>
	readPassage(body).sections.map((section) => ({
		label: section.label,
		lines: section.lines.map((line) => line.words.map((word) => word.text).join(' ')),
	}));

describe('readPassage', () => {
	it('parts sections at blank lines, however many', () => {
		expect(outline('\nOne line\nTwo line\n\n\n\nThree line\n')).toEqual([
			{ label: undefined, lines: ['One line', 'Two line'] },
			{ label: undefined, lines: ['Three line'] },
		]);
	});

	it('names a section by the label above it, across a blank line', () => {
		expect(outline('# Part one\n\nA line\n# Part two\nB line\n')).toEqual([
			{ label: 'Part one', lines: ['A line'] },
			{ label: 'Part two', lines: ['B line'] },
		]);
	});

	it('takes the later of two labels with no line between', () => {
		expect(outline('# Book I\n## Canto 1\nA line\n')).toEqual([
			{ label: 'Canto 1', lines: ['A line'] },
		]);
	});

	it('takes a line of spaces for a blank one', () => {
		expect(outline('A\n   \t\nB')).toHaveLength(2);
	});

	it('reads a CRLF body as the same passage', () => {
		const lf = '# Title\n\nThe Lord is my shepherd;\nI shall not want.\n';
		expect(readPassage(lf.replaceAll('\n', '\r\n'))).toEqual(readPassage(lf));
	});

	it('numbers every word in order, and says where each is', () => {
		const { words } = readPassage('\nA b\nc\n\nd e\n');
		expect(
			words.map((word) => [word.text, word.index, word.section, word.line, word.lineEnd])
		).toEqual([
			['A', 0, 0, 1, false],
			['b', 1, 0, 1, true],
			['c', 2, 0, 2, true],
			['d', 3, 1, 4, false],
			['e', 4, 1, 4, true],
		]);
	});

	it('keeps a line with nothing to type, to be shown', () => {
		const { sections } = readPassage('A line\n* * *\nB line\n');
		expect(sections[0]?.lines.map((line) => line.words.length)).toEqual([2, 0, 2]);
	});

	it('has nothing in an empty body', () => {
		expect(readPassage('')).toEqual({ sections: [], words: [] });
		expect(readPassage('\n\n# Only a label\n')).toEqual({ sections: [], words: [] });
	});
});
