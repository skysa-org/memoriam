import { MAX_LEVEL } from '../progress/codec.js';
import { type PassSummary } from './pass.js';

/**
 * A chunk's next level on the fade ladder after a pass (docs/ARCHITECTURE.md
 * §4, "Moving between levels"; `docs/research.md` §2.1):
 *
 * | A pass                                  | Then                                    |
 * |-----------------------------------------|-----------------------------------------|
 * | every word, no hints, no hesitations    | up two                                  |
 * | at least 90% recalled, no hints         | up one                                  |
 * | 70% or more                             | the same level, missed words shown once |
 * | less                                    | down one                                |
 *
 * A chunk is learnt on one clean pass at the top level — every word recalled,
 * none hinted — and its practice stops for the session there.
 */

export const UP_SHARE = 0.9;
export const STAY_SHARE = 0.7;

export interface Faded {
	readonly level: number;
	/** A clean pass at the top: on to the scheduler. */
	readonly learnt: boolean;
}

const clamp = (level: number): number => Math.min(MAX_LEVEL, Math.max(0, level));

const step = (pass: PassSummary): number => {
	if (pass.hinted === 0 && pass.missed === 0 && pass.hesitations === 0) return 2;
	if (pass.hinted === 0 && pass.correct >= UP_SHARE) return 1;
	return pass.correct >= STAY_SHARE ? 0 : -1;
};

export const fade = (level: number, pass: PassSummary): Faded => ({
	level: clamp(level + step(pass)),
	learnt: level >= MAX_LEVEL && pass.missed === 0 && pass.hinted === 0,
});
