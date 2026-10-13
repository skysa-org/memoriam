import {
	type ChunkedPassage,
	isLearnt,
	type PassageWord,
	type Progress,
	type Span,
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

/** A span's words, line by line, each line's lead with it where the span starts the line. */
export const chunkLines = (chunked: ChunkedPassage, chunk: Span): ShownLine[] =>
	chunked.sections
		.flatMap((section) => section.lines)
		.flatMap((line) => {
			const words = line.words.filter(
				(word) => word.index >= chunk.start && word.index < chunk.end
			);
			if (words.length === 0) return [];
			return [{ lead: words[0] === line.words[0] ? line.lead : '', words }];
		});

/**
 * What is shown above a span to start it from: the words before it on its
 * line or, at a line's start, the line before — or, at a section's start, its
 * label, and the passage's title for the first of all.
 */
export const contextBefore = (chunked: ChunkedPassage, start: number, title: string): string => {
	const first = chunked.words[start];
	const last = chunked.words[start - 1];
	if (first === undefined) return title;
	if (last === undefined || last.section !== first.section) {
		return chunked.sections[first.section]?.label ?? title;
	}
	const line = chunked.sections
		.flatMap((section) => section.lines)
		.find((each) => each.line === last.line);
	const before = line?.words.filter((word: PassageWord) => word.index < start) ?? [];
	return (
		(before[0] === line?.words[0] ? (line?.lead ?? '') : '') +
		before.map((word) => word.text + word.after).join('')
	).trim();
};

/** The context above chunk `at` (`contextBefore`). */
export const contextFor = (chunked: ChunkedPassage, at: number, title: string): string =>
	contextBefore(chunked, chunked.chunks[at]?.start ?? 0, title);
