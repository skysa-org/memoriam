/**
 * A line of a passage, as words to type and the text between them
 * (docs/ARCHITECTURE.md §2, §4 "First letters").
 *
 * Words are found by one regular expression over Unicode properties, not by
 * `Intl.Segmenter`. Chunk keys are hashes of the words (`passage/chunk.ts`),
 * and a passage's `chunker` promises that the same text is cut into the same
 * chunks on every device, now and later. `Intl.Segmenter` is each engine's
 * ICU, and engines differ in version and tailoring: the same line could be
 * split two ways on two devices, and each would orphan the other's progress.
 * A property escape answers the same wherever the character is assigned.
 *
 * A word is a run of letters, marks and digits, held together by an
 * apostrophe between letters (`don’t`, `shepherd’s`) or a point or comma
 * between digits (`3.14`, `1,000`). A hyphen parts two words (`well-known` is
 * typed `w`, `k`). Everything else — spaces, quotes, dashes, punctuation — is
 * shown and never typed.
 *
 * Words in a script that is written through an input method that composes
 * characters (Chinese, Japanese, Korean, Thai, Lao, Khmer, Myanmar, Tibetan)
 * have no first letter to type, and are shown as text around the words
 * (§2, "Scripts").
 */

/** One word to type. */
export interface Word {
	/** As written: `shepherd`, `don’t`, `1,000`. */
	readonly text: string;
	/** What is typed for it (`firstKey`). */
	readonly key: string;
	/** The text after it, up to the next word or the end of the line: `, `, `.”`. */
	readonly after: string;
}

export interface LineWords {
	/** The text before the first word: indentation, an opening quote. */
	readonly lead: string;
	readonly words: readonly Word[];
}

const WORD =
	/[\p{L}\p{M}\p{N}]+(?:(?:['’ʼ](?=\p{L})|(?<=\p{N})[.,](?=\p{N}))[\p{L}\p{M}\p{N}]+)*/gu;

/** Scripts typed through composition, which have no first letter to type. */
const COMPOSED =
	/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Bopomofo}\p{Script=Yi}]/u;

/**
 * Emphasis as markdown marks it (`*so*`, `**so**`, `_so_`): in the file, and
 * not shown. A run of marks against something other than a space is one; a
 * run with a space or the line's edge on both sides is text, as the `* * *`
 * that parts two stanzas is.
 */
const MARKS = /[*_]+/g;

/** Where a line's emphasis marks are, as `[start, end)`. */
const emphasisIn = (line: string): (readonly [number, number])[] =>
	Array.from(
		line.matchAll(MARKS),
		(match) => [match.index, match.index + match[0].length] as const
	).filter(([start, end]) => /\S/u.test(line[start - 1] ?? ' ') || /\S/u.test(line[end] ?? ' '));

/**
 * Letters that do not come apart into a base and a mark, and are typed as the
 * letter they are made from: `ß` on a keyboard without it is `s`, `æ` is `a`.
 * Final forms are their letter: `ς` is `σ`, and Hebrew's five are the letters
 * they close.
 */
const FOLDS: Readonly<Record<string, string>> = {
	ß: 's',
	æ: 'a',
	œ: 'o',
	ø: 'o',
	đ: 'd',
	ð: 'd',
	þ: 't',
	ł: 'l',
	ı: 'i',
	ħ: 'h',
	ŧ: 't',
	ŋ: 'n',
	ĸ: 'k',
	ς: 'σ',
	ך: 'כ',
	ם: 'מ',
	ן: 'נ',
	ף: 'פ',
	ץ: 'צ',
};

/**
 * A character as it is compared with what is typed: lowercase, without
 * accents, folded (`FOLDS`). The same for the word's first letter and for the
 * key pressed, so `É`, `é` and `e` are one key, and so are `Æ` and `a`.
 */
export const foldKey = (char: string): string => {
	const base = char.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
	const first = Array.from(base)[0] ?? '';
	return FOLDS[first] ?? first;
};

/** The key a word is typed by: its first letter or digit, folded. */
export const firstKey = (word: string): string | undefined => {
	const first = /[\p{L}\p{N}]/u.exec(word)?.[0];
	return first === undefined ? undefined : foldKey(first);
};

/**
 * The line from `from` to `to`, as shown: without the emphasis marks in it.
 * Marks are never part of a word, so a run of them is all in one stretch
 * between two words.
 */
const shown = (
	line: string,
	marks: readonly (readonly [number, number])[],
	from: number,
	to: number
): string =>
	marks
		.filter(([start, end]) => start >= from && end <= to)
		.reduceRight(
			(text, [start, end]) => text.slice(0, start - from) + text.slice(end - from),
			line.slice(from, to)
		);

interface Found {
	readonly text: string;
	readonly key: string;
	readonly start: number;
	readonly end: number;
}

/**
 * A line's words and the text around them. What is passed over — a word in a
 * composed script, a mark with no letter — is text between words, shown as
 * written.
 */
export const tokenizeLine = (line: string): LineWords => {
	const found: readonly Found[] = Array.from(line.matchAll(WORD), (match) => ({
		text: match[0],
		key: COMPOSED.test(match[0]) ? undefined : firstKey(match[0]),
		start: match.index,
		end: match.index + match[0].length,
	})).flatMap(({ key, ...each }) => (key === undefined ? [] : [{ ...each, key }]));
	const marks = emphasisIn(line);
	return {
		lead: shown(line, marks, 0, found[0]?.start ?? line.length),
		words: found.map((each, at) => ({
			text: each.text,
			key: each.key,
			after: shown(line, marks, each.end, found[at + 1]?.start ?? line.length),
		})),
	};
};
