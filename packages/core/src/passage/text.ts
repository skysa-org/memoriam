import { toLf } from '../markdown/lineEndings.js';
import { tokenizeLine, type Word } from './tokenize.js';

/**
 * A passage's body, read into what is practised (docs/ARCHITECTURE.md §3, "The
 * body is plain text, not markdown"):
 *
 * - a blank line parts sections: stanzas, verses, paragraphs;
 * - a line that starts with `#` names the section after it, and is not
 *   practised;
 * - every other line is kept as it is, its line breaks included, since they
 *   are part of what is learnt.
 *
 * Every word is numbered in the order it comes (`PassageWord.index`), and that
 * is what a chunk is a range of.
 */

/** A word, and where in the passage it is. */
export interface PassageWord extends Word {
	/** Its place among all the passage's words, from 0. */
	readonly index: number;
	readonly section: number;
	/** The line it is on, counted from the body's first line. */
	readonly line: number;
	/** Whether it is the last word on its line. */
	readonly lineEnd: boolean;
}

export interface PassageLine {
	/** Which line of the body this is, from 0. */
	readonly line: number;
	/** The text before its first word. */
	readonly lead: string;
	/** Its words, each with the text after it. */
	readonly words: readonly PassageWord[];
}

export interface Section {
	/** The `#` line above it, without the `#`. */
	readonly label?: string;
	readonly lines: readonly PassageLine[];
}

export interface PassageText {
	readonly sections: readonly Section[];
	/** Every word, in order. */
	readonly words: readonly PassageWord[];
}

const LABEL = /^\s*#+\s*(.*?)\s*$/;

/** A line, read for what it is, before any word is numbered. */
type Read =
	| Readonly<{ kind: 'blank' }>
	| Readonly<{ kind: 'label'; label: string }>
	| Readonly<{ kind: 'text'; line: number; text: string }>;

const readLine = (text: string, line: number): Read => {
	if (text.trim() === '') return { kind: 'blank' };
	const label = LABEL.exec(text);
	return label === null ? { kind: 'text', line, text } : { kind: 'label', label: label[1] ?? '' };
};

interface Draft {
	readonly label?: string;
	readonly lines: readonly Readonly<{ line: number; text: string }>[];
}

/**
 * The lines gathered into sections. A section ends at a blank line or at a
 * label; a label names the section that follows it, and where two come
 * together before any line, the later one does.
 */
const gather = (reads: readonly Read[]): Draft[] =>
	reads.reduce<{ done: Draft[]; open: Draft }>(
		({ done, open }, read) => {
			const closed = open.lines.length > 0 ? [...done, open] : done;
			if (read.kind === 'blank') {
				return open.lines.length > 0
					? { done: closed, open: { lines: [] } }
					: { done, open };
			}
			if (read.kind === 'label') {
				return {
					done: closed,
					open: { ...(read.label === '' ? {} : { label: read.label }), lines: [] },
				};
			}
			return { done, open: { ...open, lines: [...open.lines, read] } };
		},
		{ done: [], open: { lines: [] } }
	).done;

export const readPassage = (body: string): PassageText => {
	const reads = toLf(body).split('\n').map(readLine);
	// The last section is closed by the end of the body, as by a blank line.
	const drafts = gather([...reads, { kind: 'blank' }]);
	const counted = drafts.reduce<{ sections: Section[]; words: PassageWord[] }>(
		(acc, draft, section) => {
			const lines = draft.lines.reduce<PassageLine[]>((done, { line, text }) => {
				const { lead, words } = tokenizeLine(text);
				const start = acc.words.length + done.reduce((n, each) => n + each.words.length, 0);
				return [
					...done,
					{
						line,
						lead,
						words: words.map((word, at) => ({
							...word,
							index: start + at,
							section,
							line,
							lineEnd: at === words.length - 1,
						})),
					},
				];
			}, []);
			return {
				sections: [
					...acc.sections,
					{ ...(draft.label === undefined ? {} : { label: draft.label }), lines },
				],
				words: [...acc.words, ...lines.flatMap((each) => each.words)],
			};
		},
		{ sections: [], words: [] }
	);
	return counted;
};
