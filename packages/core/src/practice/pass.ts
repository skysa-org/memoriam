import { type WordResult } from './typing.js';

/**
 * A pass over a chunk, summed up for what follows it: its grade (`grade.ts`),
 * its next level (`fade.ts`), the misses kept in `progress`, and the typist's
 * pace.
 */

export interface PassSummary {
	readonly words: number;
	/** Words not recalled: a wrong key that was not a slip, or a hint. */
	readonly missed: number;
	readonly slipped: number;
	readonly hinted: number;
	readonly hesitations: number;
	/** The share of words recalled, from 0 to 1; 1 for a chunk of none. */
	readonly correct: number;
	/** The median time per word; undefined for none. */
	readonly medianMs?: number;
}

/** The middle of some numbers, or the mean of the middle two. */
export const median = (values: readonly number[]): number | undefined => {
	const sorted = [...values].sort((a, b) => a - b);
	const half = Math.floor(sorted.length / 2);
	if (sorted.length === 0) return undefined;
	return sorted.length % 2 === 1
		? sorted[half]
		: ((sorted[half - 1] ?? 0) + (sorted[half] ?? 0)) / 2;
};

const counted = (results: readonly WordResult[], test: (result: WordResult) => boolean): number =>
	results.filter(test).length;

export const summarize = (results: readonly WordResult[]): PassSummary => {
	const missed = counted(results, (result) => result.missed);
	const medianMs = median(results.map((result) => result.ms));
	return {
		words: results.length,
		missed,
		slipped: counted(results, (result) => result.slipped),
		hinted: counted(results, (result) => result.hinted),
		hesitations: counted(results, (result) => result.hesitated),
		correct: results.length === 0 ? 1 : (results.length - missed) / results.length,
		...(medianMs === undefined ? {} : { medianMs }),
	};
};

/**
 * Each word's misses over all time, with this pass's added: what the heat map
 * of missed words is drawn from, and what hiding weighs (`hide.ts`). None for
 * a chunk never missed. Counts kept for a different number of words — the
 * chunk's words changed — start again.
 */
export const tallyMisses = (
	before: readonly number[] | undefined,
	results: readonly WordResult[]
): number[] | undefined => {
	const kept = before?.length === results.length ? before : [];
	const tally = results.map((result, at) => (kept[at] ?? 0) + (result.missed ? 1 : 0));
	return tally.some((count) => count > 0) ? tally : undefined;
};
