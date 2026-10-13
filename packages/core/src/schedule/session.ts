import { type ChunkedPassage } from '../passage/chunk.js';
import { isLearnt } from '../practice/learn.js';
import { type Progress } from '../progress/codec.js';
import { isDue, isRelearning, recall } from './fsrs.js';

/**
 * A day's practice, planned (docs/ARCHITECTURE.md §5, "A day's session"):
 *
 * 1. Reviews due, a passage's due chunks run together, the passage with the
 *    chunk least likely remembered first.
 * 2. Chunks forgotten at a review, relearnt from where they dropped to.
 * 3. Chunks part-way up the ladder, finished.
 * 4. New chunks, in passage order, up to the day's cap on new words: a
 *    passage begun before one not yet begun, and those in the order they were
 *    added.
 *
 * The link pass after a new chunk, and the run through its section at the
 * end, are worked out as the session goes (`linkSpan`, `runSpan`): they hang
 * on what is learnt in it.
 */

export interface PlanPassage {
	readonly id: string;
	readonly chunked: ChunkedPassage;
	readonly progress: Progress;
	/** When it was added. */
	readonly createdAt: number;
}

export type Step =
	| Readonly<{ kind: 'review'; id: string; chunks: readonly number[] }>
	| Readonly<{ kind: 'relearn'; id: string; chunk: number }>
	| Readonly<{ kind: 'learn'; id: string; chunk: number }>;

export interface PlanOptions {
	readonly now: Date;
	/** The local day `now` falls on. */
	readonly today: string;
	/** The most words of new chunks to begin in a day. */
	readonly newWords: number;
	/** Words of new chunks begun already today, here or on another device. */
	readonly startedToday: number;
}

export const DEFAULT_NEW_WORDS = 50;

const entryOf = (passage: PlanPassage, at: number) =>
	passage.progress.chunks.get(passage.chunked.chunks[at]?.key ?? '');

const indices = (passage: PlanPassage): number[] => passage.chunked.chunks.map((_, at) => at);

const wordsIn = (passage: PlanPassage, at: number): number => {
	const chunk = passage.chunked.chunks[at];
	return chunk === undefined ? 0 : chunk.end - chunk.start;
};

/** Reviews: each passage's due chunks, the passages least likely remembered first. */
const reviews = (passages: readonly PlanPassage[], { now, today }: PlanOptions): Step[] =>
	passages
		.map((passage) => {
			const chunks = indices(passage).filter((at) => isDue(entryOf(passage, at), today));
			const least = Math.min(
				...chunks.map((at) => {
					const entry = entryOf(passage, at);
					return entry === undefined ? 1 : (recall(entry, now) ?? 1);
				})
			);
			return { passage, chunks, least };
		})
		.filter(({ chunks }) => chunks.length > 0)
		.sort((a, b) => a.least - b.least)
		.map(({ passage, chunks }) => ({ kind: 'review', id: passage.id, chunks }));

/** Passages begun first, then the rest, each lot in the order it was added. */
const inOrder = (passages: readonly PlanPassage[]): PlanPassage[] => {
	const begun = (passage: PlanPassage) => passage.progress.chunks.size > 0;
	const byAdded = (a: PlanPassage, b: PlanPassage) => a.createdAt - b.createdAt;
	return [
		...passages.filter(begun).sort(byAdded),
		...passages.filter((passage) => !begun(passage)).sort(byAdded),
	];
};

/** New chunks, as many as the day's cap allows: always one, if none has been begun today. */
const fresh = (passages: readonly PlanPassage[], { newWords, startedToday }: PlanOptions): Step[] =>
	inOrder(passages)
		.flatMap((passage) =>
			indices(passage)
				.filter((at) => entryOf(passage, at) === undefined)
				.map((at) => ({ id: passage.id, chunk: at, words: wordsIn(passage, at) }))
		)
		.reduce<{ steps: Step[]; words: number; full: boolean }>(
			({ steps, words, full }, next) => {
				const first = steps.length === 0 && startedToday === 0;
				if (full || (words + next.words > newWords && !first)) {
					// In order: a smaller chunk further on waits its turn.
					return { steps, words, full: true };
				}
				return {
					steps: [...steps, { kind: 'learn', id: next.id, chunk: next.chunk }],
					words: words + next.words,
					full,
				};
			},
			{ steps: [], words: startedToday, full: false }
		).steps;

export const planDay = (passages: readonly PlanPassage[], options: PlanOptions): Step[] => {
	const ordered = inOrder(passages);
	const chunksWhere = (
		test: (passage: PlanPassage, at: number) => boolean,
		kind: 'relearn' | 'learn'
	) =>
		ordered.flatMap((passage) =>
			indices(passage)
				.filter((at) => test(passage, at))
				.map((at): Step => ({ kind, id: passage.id, chunk: at }))
		);
	return [
		...reviews(passages, options),
		...chunksWhere((passage, at) => isRelearning(entryOf(passage, at)), 'relearn'),
		...chunksWhere((passage, at) => {
			const entry = entryOf(passage, at);
			return entry !== undefined && !isLearnt(entry);
		}, 'learn'),
		...fresh(passages, options),
	];
};

/** A run of a passage's words, as indices: from `start` up to `end`. */
export interface Span {
	readonly start: number;
	readonly end: number;
}

/**
 * The link pass after chunk `at` is learnt: the last line of the chunk before
 * it, then it, so the seam between them is practised too. None for the first
 * chunk of a section.
 */
export const linkSpan = (chunked: ChunkedPassage, at: number): Span | undefined => {
	const chunk = chunked.chunks[at];
	const before = chunked.chunks[at - 1];
	if (chunk === undefined || before === undefined || before.section !== chunk.section) {
		return undefined;
	}
	const last = chunked.words[before.end - 1];
	const lineStart = chunked.words.find((word) => word.line === last?.line)?.index ?? before.start;
	return { start: Math.max(before.start, lineStart), end: chunk.end };
};

/** How many words a run through a section goes back, at most. */
export const RUN_WORDS = 150;

/**
 * The run through chunk `at`'s section, from its start to the end of the
 * chunk: past `window` words, from the start of the earliest chunk that keeps
 * it within them, and never less than the chunk itself.
 */
export const runSpan = (
	chunked: ChunkedPassage,
	at: number,
	window = RUN_WORDS
): Span | undefined => {
	const chunk = chunked.chunks[at];
	if (chunk === undefined) return undefined;
	const first = chunked.chunks.find(
		(each) =>
			each.section === chunk.section &&
			each.start <= chunk.start &&
			chunk.end - each.start <= window
	);
	return { start: first?.start ?? chunk.start, end: chunk.end };
};
