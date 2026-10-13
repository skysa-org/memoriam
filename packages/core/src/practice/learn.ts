import { addDays, instant, localDay } from '../day.js';
import { type ChunkProgress } from '../progress/codec.js';
import { fade, type Faded } from './fade.js';
import { type PassSummary, summarize, tallyMisses } from './pass.js';
import { type WordResult } from './typing.js';

/**
 * What a pass over a chunk being learnt does to its progress
 * (docs/ARCHITECTURE.md §4): its next level on the fade ladder, when it was
 * practised, and its misses word by word. A chunk learnt — a clean pass at the
 * top — is first due the next day, after sleep (`docs/research.md` §1). One
 * relearnt after a lapse is due when that review said (`schedule/fsrs.ts`).
 */

export interface LearnedPass {
	readonly progress: ChunkProgress;
	readonly faded: Faded;
	readonly summary: PassSummary;
}

export const learningPass = (
	before: ChunkProgress | undefined,
	results: readonly WordResult[],
	now: Date
): LearnedPass => {
	const summary = summarize(results);
	const faded = fade(before?.level ?? 0, summary);
	const misses = tallyMisses(before?.misses, results);
	const { misses: _, ...kept } = before ?? { level: 0 };
	return {
		progress: {
			...kept,
			level: faded.level,
			reviewed: instant(now),
			...(misses === undefined ? {} : { misses }),
			// Relearnt after a lapse, it keeps the day its review gave it.
			...(faded.learnt && before?.due === undefined
				? { due: addDays(localDay(now), 1) }
				: {}),
		},
		faded,
		summary,
	};
};

/** Whether a chunk has been learnt, and is the scheduler's now. */
export const isLearnt = (progress: ChunkProgress | undefined): boolean =>
	progress?.due !== undefined;
