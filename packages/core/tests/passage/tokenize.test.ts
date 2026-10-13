import { describe, expect, it } from 'vitest';

import { firstKey, foldKey, tokenizeLine } from '../../src/passage/tokenize.js';

const texts = (line: string): string[] => tokenizeLine(line).words.map((word) => word.text);
const keys = (line: string): string =>
	tokenizeLine(line)
		.words.map((word) => word.key)
		.join('');

/** The line put back together from its parts, as the practice screen shows it. */
const shown = (line: string): string => {
	const { lead, words } = tokenizeLine(line);
	return lead + words.map((word) => word.text + word.after).join('');
};

describe('tokenizeLine', () => {
	it('finds the words, and the text between them', () => {
		expect(tokenizeLine('  “Hope” is the thing,')).toEqual({
			lead: '  “',
			words: [
				{ text: 'Hope', key: 'h', after: '” ' },
				{ text: 'is', key: 'i', after: ' ' },
				{ text: 'the', key: 't', after: ' ' },
				{ text: 'thing', key: 't', after: ',' },
			],
		});
	});

	it('holds a word together across an apostrophe, straight or curly', () => {
		expect(texts("don't shepherd’s o'er maʼam")).toEqual([
			"don't",
			'shepherd’s',
			"o'er",
			'maʼam',
		]);
	});

	it('leaves an apostrophe that opens or closes a word outside it', () => {
		expect(tokenizeLine('’Tis goin’ home')).toEqual({
			lead: '’',
			words: [
				{ text: 'Tis', key: 't', after: ' ' },
				{ text: 'goin', key: 'g', after: '’ ' },
				{ text: 'home', key: 'h', after: '' },
			],
		});
	});

	it('parts a hyphenated word into two to type', () => {
		expect(texts('a battle-field, well—known')).toEqual([
			'a',
			'battle',
			'field',
			'well',
			'known',
		]);
	});

	it('keeps a number whole, points and commas included', () => {
		expect(texts('In 1,000 years, 3.14 and 23.')).toEqual([
			'In',
			'1,000',
			'years',
			'3.14',
			'and',
			'23',
		]);
		expect(keys('In 1,000 years, 3.14 and 23.')).toBe('i1y3a2');
	});

	it('shows emphasis as plain words', () => {
		expect(shown('He *restores* my _soul_.')).toBe('He restores my soul.');
		expect(texts('He *restores* my _soul_.')).toEqual(['He', 'restores', 'my', 'soul']);
		expect(shown('**Be still,** and _“know”_ ***that***')).toBe('Be still, and “know” that');
	});

	it('shows marks that stand alone, which are not emphasis', () => {
		expect(shown('* * *')).toBe('* * *');
		expect(shown('***')).toBe('***');
		expect(shown('one * two')).toBe('one * two');
	});

	it('loses nothing it shows', () => {
		const line = '  — “Shall I,” said he, ‘compare thee… to a summer’s day?’ (no.)';
		expect(shown(line)).toBe(line);
	});

	it('reads Greek, Cyrillic, Hebrew and Arabic', () => {
		expect(keys('Ἐν ἀρχῇ ἦν ὁ λόγος')).toBe('εαηολ');
		expect(keys('Ёлка и Шуба')).toBe('еиш');
		expect(keys('בְּרֵאשִׁית בָּרָא אֱלֹהִים')).toBe('בבא');
		expect(keys('بسم الله')).toBe('با');
	});

	it('shows, and never asks for, words written through composition', () => {
		expect(tokenizeLine('He said 你好 to me')).toEqual({
			lead: '',
			words: [
				{ text: 'He', key: 'h', after: ' ' },
				{ text: 'said', key: 's', after: ' 你好 ' },
				{ text: 'to', key: 't', after: ' ' },
				{ text: 'me', key: 'm', after: '' },
			],
		});
		expect(tokenizeLine('春眠不覺曉').words).toEqual([]);
	});

	it('has nothing to type in a line of punctuation', () => {
		expect(tokenizeLine('* * *')).toEqual({ lead: '* * *', words: [] });
	});
});

describe('foldKey', () => {
	it('folds case and accents', () => {
		expect(['É', 'é', 'e', 'Ë', 'ê'].map(foldKey)).toEqual(['e', 'e', 'e', 'e', 'e']);
		expect(foldKey('İ')).toBe('i');
		expect(foldKey('Ά')).toBe('α');
	});

	it('types a letter that has no accent to remove as the letter it is made from', () => {
		expect(['ß', 'ẞ', 'Æ', 'œ', 'Ø', 'Ł', 'Đ', 'Þ', 'ı'].map(foldKey)).toEqual([
			's',
			's',
			'a',
			'o',
			'o',
			'l',
			'd',
			't',
			'i',
		]);
	});

	it('makes a final form its letter', () => {
		expect(foldKey('ς')).toBe('σ');
		expect(['ך', 'ם', 'ן', 'ף', 'ץ'].map(foldKey)).toEqual(['כ', 'מ', 'נ', 'פ', 'צ']);
	});
});

describe('firstKey', () => {
	it('is the first letter or digit, folded', () => {
		expect(firstKey('Ægis')).toBe('a');
		expect(firstKey('23rd')).toBe('2');
		expect(firstKey('—')).toBeUndefined();
	});
});
