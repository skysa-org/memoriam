import { shortKey } from '../hash.js';
import { type PassageText, type PassageWord, readPassage } from './text.js';

/**
 * A passage cut into chunks: what is learnt at a sitting, scheduled on its own
 * and keyed in the frontmatter by its words (docs/ARCHITECTURE.md §3, §4;
 * `docs/research.md` §2.3).
 *
 * Every chunker this app has ever had stays here, frozen, and a passage is cut
 * by the one its `chunker` names. A better chunker is a new number; it never
 * changes the keys of a passage already learnt under an older one.
 */

/** A run of a passage's words, within one section. */
export interface Chunk {
	/** Its name in `progress`: a hash of its words, and `.2`, `.3` for a repeat. */
	readonly key: string;
	readonly section: number;
	/** Its first word's `index`. */
	readonly start: number;
	/** One past its last word's `index`. */
	readonly end: number;
}

export interface ChunkedPassage extends PassageText {
	readonly chunks: readonly Chunk[];
}

// ---- Keys -------------------------------------------------------------------

/** Apostrophes as people type them, and as editors respell them. */
const APOSTROPHES = /['’ʼ]/g;

/**
 * A chunk's words as its key is made from them: lowercase, apostrophes all
 * one, single spaces, no punctuation. So a comma added or a capital fixed is
 * the same chunk, and keeps its progress; a word changed is another.
 */
export const keyText = (words: readonly Pick<PassageWord, 'text'>[]): string =>
	words
		.map((word) => word.text.normalize('NFC').toLowerCase().replace(APOSTROPHES, "'"))
		.join(' ');

/**
 * Keys for chunks of these texts, in order: the hash of each, and for a text
 * the passage has had before — a refrain — or one whose hash another text
 * shares, `.2`, `.3` and on, by how many came before.
 */
export const chunkKeys = (texts: readonly string[]): string[] =>
	texts.reduce<{ keys: string[]; seen: ReadonlyMap<string, number> }>(
		({ keys, seen }, text) => {
			const base = shortKey(text);
			const count = (seen.get(base) ?? 0) + 1;
			return {
				keys: [...keys, count === 1 ? base : `${base}.${String(count)}`],
				seen: new Map(seen).set(base, count),
			};
		},
		{ keys: [], seen: new Map() }
	).keys;

// ---- Chunker 1 ----------------------------------------------------------------

/**
 * Chunker 1's sizes. A chunk is best at about twenty words, two or three lines
 * of verse or a sentence of prose; ten to thirty is good; never more than
 * forty-five (`docs/research.md` §2.3).
 */
const IDEAL_WORDS = 20;
const SPREAD_WORDS = 10;
const MAX_WORDS = 45;

/**
 * What it costs to end a chunk after a word, by what comes after it. A line's
 * end is the best place in verse, and a sentence's in prose; both together
 * cost nothing. A cut with no pause at all, in the middle of a phrase, is
 * there only for a line too long to be one chunk, and costs as much as a chunk
 * twenty words off its best size.
 */
const CUT_COST = {
	lineAndSentence: 0,
	lineAndClause: 0.5,
	line: 1.5,
	sentence: 1.5,
	clause: 3,
	none: 8,
} as const;

const SENTENCE_END = /[.!?…]/;
/** A clause's end: its punctuation, or a hyphen standing for a dash, spaced (`feathers -`). */
const CLAUSE_END = /[,;:—–)\]]|\s-|-\s/;

/** What it costs to end a chunk after this word. */
const cutAfter = (word: PassageWord): number => {
	const sentence = SENTENCE_END.test(word.after);
	const clause = !sentence && CLAUSE_END.test(word.after);
	if (word.lineEnd) {
		if (sentence) return CUT_COST.lineAndSentence;
		return clause ? CUT_COST.lineAndClause : CUT_COST.line;
	}
	if (sentence) return CUT_COST.sentence;
	return clause ? CUT_COST.clause : CUT_COST.none;
};

const sizeCost = (words: number): number => ((words - IDEAL_WORDS) / SPREAD_WORDS) ** 2;

interface Best {
	readonly cost: number;
	/** Where the chunk that ends here starts. */
	readonly from: number;
}

/**
 * One section's words cut into chunks, as the starts of each. The cheapest
 * cutting there is, by the size of each chunk and the place each ends: worked
 * out from the front (`best[n]` is the cheapest way to cut the first `n`
 * words), so it is the same every time, and ties go to the shorter chunk.
 */
const cutSection = (words: readonly PassageWord[]): number[] => {
	const best = words.reduce<readonly Best[]>(
		(found, _, at) => {
			const end = at + 1;
			const last = words[at];
			// The section's own end is the best place there is.
			const cut = end === words.length || last === undefined ? 0 : cutAfter(last);
			const choices = Array.from({ length: Math.min(end, MAX_WORDS) }, (__, back) => {
				const from = end - back - 1;
				return { cost: (found[from]?.cost ?? Infinity) + sizeCost(end - from) + cut, from };
			});
			const chosen = choices.reduce((a, b) => (b.cost < a.cost ? b : a));
			return [...found, chosen];
		},
		[{ cost: 0, from: 0 }]
	);
	const starts = (end: number): number[] => {
		if (end <= 0) return [];
		const from = best[end]?.from ?? 0;
		return [...starts(from), from];
	};
	return starts(words.length);
};

const chunker1 = (text: PassageText): Chunk[] => {
	const ranges = text.sections.flatMap((section, at) => {
		const words = section.lines.flatMap((line) => line.words);
		const first = words[0]?.index ?? 0;
		const starts = cutSection(words);
		return starts.map((start, n) => ({
			section: at,
			start: first + start,
			end: first + (starts[n + 1] ?? words.length),
		}));
	});
	const keys = chunkKeys(
		ranges.map((range) => keyText(text.words.slice(range.start, range.end)))
	);
	return ranges.map((range, at) => ({ ...range, key: keys[at] ?? '' }));
};

/** Every chunker there is, by the number a passage's `chunker` gives. */
const CHUNKERS: Readonly<Record<number, (text: PassageText) => Chunk[]>> = {
	1: chunker1,
};

/** Whether this build has the chunker a passage names. */
export const knowsChunker = (chunker: number): boolean => Object.hasOwn(CHUNKERS, chunker);

/**
 * A passage's body cut into chunks by the chunker it names, or `undefined`
 * for one a later build added: its keys would not be this build's to work out,
 * and progress written under keys worked out wrongly is progress lost.
 */
export const chunkPassage = (body: string, chunker: number): ChunkedPassage | undefined => {
	const cut = CHUNKERS[chunker];
	if (cut === undefined) return undefined;
	const text = readPassage(body);
	return { ...text, chunks: cut(text) };
};
