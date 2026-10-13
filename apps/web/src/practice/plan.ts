import {
	type Chunk,
	type ChunkedPassage,
	isLearnt,
	type PassageWord,
	type Progress,
} from '@memoriam/core';

import { type ShownLine } from '../components/shownPassage.js';

/**
 * What a practice screen needs of a passage: which chunk to learn next, its
 * lines, and the line of context shown above it (docs/ARCHITECTURE.md §4).
 */

/** The first chunk not yet learnt, at or after `from`, then from the start; none when all are. */
export const nextToLearn = (
	chunked: ChunkedPassage,
	progress: Progress,
	from = 0
): number | undefined => {
	const indices = chunked.chunks.map((_, at) => at);
	const order = [...indices.filter((at) => at >= from), ...indices.filter((at) => at < from)];
	return order.find((at) => !isLearnt(progress.chunks.get(chunked.chunks[at]?.key ?? '')));
};

/** A chunk's words, line by line, each line's lead with it where the chunk starts the line. */
export const chunkLines = (chunked: ChunkedPassage, chunk: Chunk): ShownLine[] =>
	chunked.sections
		.flatMap((section) => section.lines)
		.flatMap((line) => {
			const words = line.words.filter(
				(word) => word.index >= chunk.start && word.index < chunk.end
			);
			if (words.length === 0) return [];
			return [{ lead: words[0] === line.words[0] ? line.lead : '', words }];
		});

const lineOf = (chunked: ChunkedPassage, word: PassageWord): string => {
	const line = chunked.sections
		.flatMap((section) => section.lines)
		.find((each) => each.line === word.line);
	return line === undefined
		? ''
		: (line.lead + line.words.map((each) => each.text + each.after).join('')).trim();
};

/**
 * What is shown above a chunk to start it from: the line before it — the end
 * of the chunk before, in its section — or, for a section's first, its label,
 * or the passage's title for the first of all.
 */
export const contextFor = (chunked: ChunkedPassage, at: number, title: string): string => {
	const chunk = chunked.chunks[at];
	const before = chunked.chunks[at - 1];
	if (chunk === undefined) return title;
	if (before !== undefined && before.section === chunk.section) {
		const last = chunked.words[before.end - 1];
		return last === undefined ? title : lineOf(chunked, last);
	}
	return chunked.sections[chunk.section]?.label ?? title;
};
