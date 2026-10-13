import { daysBetween, localDay } from '../day.js';
import { type ChunkedPassage } from '../passage/chunk.js';
import { type ChunkProgress, MAX_LEVEL, type Progress } from '../progress/codec.js';
import { recall } from '../schedule/fsrs.js';

/**
 * How well a passage is known (docs/ARCHITECTURE.md §6), from its own
 * progress and nothing else:
 *
 * - mastery, the share of its words in chunks learnt and not since forgotten;
 * - health, how likely those chunks are to be recalled now, by FSRS, weighted
 *   by their words;
 * - mastered, once every chunk is held for 3 weeks or more (a stability of
 *   21 days);
 * - held since, the day its last chunk was first learnt, while every chunk is
 *   kept up: none forgotten, none overdue.
 */

/** Stability, in days, at which a chunk counts as mastered. */
export const MASTERED_STABILITY = 21;

export interface Measure {
	readonly words: number;
	/** Words in chunks learnt and not since forgotten. */
	readonly learntWords: number;
	/** `learntWords` over `words`: 0 to 1. */
	readonly mastery: number;
	/** Mean recall now of the chunks learnt, by their words: 0 to 1; none before any is learnt. */
	readonly health?: number;
	/** Every chunk learnt. */
	readonly learnt: boolean;
	readonly mastered: boolean;
	/** The day the last of its chunks was first learnt, if every chunk is learnt and kept up. */
	readonly heldSince?: string;
}

const learnt = (entry: ChunkProgress | undefined): boolean =>
	entry?.due !== undefined && entry.level >= MAX_LEVEL;

export const measure = (chunked: ChunkedPassage, progress: Progress, now: Date): Measure => {
	const today = localDay(now);
	const chunks = chunked.chunks.map((chunk) => ({
		words: chunk.end - chunk.start,
		entry: progress.chunks.get(chunk.key),
	}));
	const words = chunks.reduce((sum, chunk) => sum + chunk.words, 0);
	const learntWords = chunks
		.filter((chunk) => learnt(chunk.entry))
		.reduce((sum, chunk) => sum + chunk.words, 0);
	const recalled = chunks.flatMap((chunk) => {
		const chance = chunk.entry === undefined ? undefined : recall(chunk.entry, now);
		return chance === undefined ? [] : [{ words: chunk.words, chance }];
	});
	const recalledWords = recalled.reduce((sum, each) => sum + each.words, 0);
	const health =
		recalledWords === 0
			? undefined
			: recalled.reduce((sum, each) => sum + each.chance * each.words, 0) / recalledWords;
	const all = chunks.length > 0 && chunks.every((chunk) => learnt(chunk.entry));
	const keptUp = all && chunks.every((chunk) => (chunk.entry?.due ?? '') >= today);
	const days = chunks.map((chunk) => chunk.entry?.learnt);
	const heldSince =
		keptUp && days.every((day) => day !== undefined)
			? days.reduce<string>((latest, day) => (day > latest ? day : latest), '')
			: undefined;
	return {
		words,
		learntWords,
		mastery: words === 0 ? 0 : learntWords / words,
		...(health === undefined ? {} : { health }),
		learnt: all,
		mastered:
			all && chunks.every((chunk) => (chunk.entry?.stability ?? 0) >= MASTERED_STABILITY),
		...(heldSince === undefined ? {} : { heldSince }),
	};
};

/** How many days a passage has been held, kept up, by `today`; none if it is not. */
export const daysHeld = (passage: Measure, today: string): number | undefined =>
	passage.heldSince === undefined ? undefined : daysBetween(passage.heldSince, today);
