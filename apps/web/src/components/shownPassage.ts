import { type ChunkedPassage, type PassageLine, type PassageWord } from '@memoriam/core';

/**
 * A passage laid out as the Passage screen shows it: each section under its
 * label, as the chunks it is learnt in, each chunk the lines it is on. A line
 * with no word to type — `* * *`, a line in a script that has none — is shown
 * where it is, with the chunk before it.
 */

export interface ShownLine {
	/** The text before its first word here. */
	readonly lead: string;
	readonly words: readonly PassageWord[];
}

export interface ShownChunk {
	/** The chunk's key; none for lines ahead of a section's first word. */
	readonly key?: string;
	readonly lines: readonly ShownLine[];
}

export interface ShownSection {
	readonly label?: string;
	readonly chunks: readonly ShownChunk[];
}

type Piece = ShownLine & Readonly<{ key?: string }>;

/**
 * A line in pieces, cut where a chunk starts in it. Most lines are one piece;
 * only a line too long for one chunk is cut.
 */
const piecesOf = (line: PassageLine, starts: ReadonlyMap<number, string>): Piece[] =>
	line.words.length === 0
		? [{ lead: line.lead, words: [] }]
		: line.words.reduce<Piece[]>((pieces, word, at) => {
				const key = starts.get(word.index);
				const last = pieces.at(-1);
				if (key === undefined && last !== undefined) {
					return [...pieces.slice(0, -1), { ...last, words: [...last.words, word] }];
				}
				return [
					...pieces,
					{
						...(key === undefined ? {} : { key }),
						lead: at === 0 ? line.lead : '',
						words: [word],
					},
				];
			}, []);

const chunksOf = (lines: readonly PassageLine[], starts: ReadonlyMap<number, string>) =>
	lines
		.flatMap((line) => piecesOf(line, starts))
		.reduce<ShownChunk[]>((chunks, { key, ...line }) => {
			const last = chunks.at(-1);
			if (key === undefined && last !== undefined) {
				return [...chunks.slice(0, -1), { ...last, lines: [...last.lines, line] }];
			}
			return [...chunks, { ...(key === undefined ? {} : { key }), lines: [line] }];
		}, []);

export const shownPassage = (passage: ChunkedPassage): ShownSection[] => {
	const starts = new Map(passage.chunks.map((chunk) => [chunk.start, chunk.key]));
	return passage.sections.map((section) => ({
		...(section.label === undefined ? {} : { label: section.label }),
		chunks: chunksOf(section.lines, starts),
	}));
};

/** A line's text as shown: its lead, and each word with what follows it. */
export const lineText = (line: ShownLine): string =>
	line.lead + line.words.map((word) => word.text + word.after).join('');
