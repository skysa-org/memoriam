import { type PassSummary } from './pass.js';

/**
 * A pass's grade for the scheduler, worked out from how it went and never
 * asked of the typist (docs/ARCHITECTURE.md §5, `docs/research.md` §3.7).
 * Hard is a pass, as FSRS means it; Again is a failure to recall.
 *
 * | Grade | When                                                                       |
 * |-------|----------------------------------------------------------------------------|
 * | Again | any hint; over 15% of words missed, or 2 on a chunk under 10 words; abandoned |
 * | Hard  | a miss or more, short of that; or no misses and 2 or more hesitations     |
 * | Good  | no misses, and at most 1 hesitation                                        |
 * | Easy  | reviews only: no misses, no hesitations, at the typist's usual pace or faster |
 */

export type Grade = 'again' | 'hard' | 'good' | 'easy';

/** More than this share of words missed is a failure. */
export const AGAIN_SHARE = 0.15;
/** A chunk this short fails on this many misses, where a share would be one. */
const SHORT_WORDS = 10;
const SHORT_AGAIN = 2;

export interface GradeOptions {
	/** A review of a learnt chunk, which alone can be Easy. */
	readonly review: boolean;
	/** The pass was left before its last word. */
	readonly abandoned?: boolean;
	/** The typist's usual median time per word; none yet, and nothing is Easy. */
	readonly usualMs?: number;
}

const failed = (pass: PassSummary): boolean =>
	pass.hinted > 0 ||
	pass.missed > AGAIN_SHARE * pass.words ||
	(pass.words < SHORT_WORDS && pass.missed >= SHORT_AGAIN);

export const grade = (pass: PassSummary, { review, abandoned, usualMs }: GradeOptions): Grade => {
	if (abandoned === true || failed(pass)) return 'again';
	if (pass.missed > 0 || pass.hesitations >= 2) return 'hard';
	const fluent =
		pass.hesitations === 0 &&
		usualMs !== undefined &&
		pass.medianMs !== undefined &&
		pass.medianMs <= usualMs;
	return review && fluent ? 'easy' : 'good';
};
