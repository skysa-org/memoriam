import {
	type Card,
	createEmptyCard,
	fsrs,
	type Grade as Rating,
	Rating as Ratings,
	State,
} from 'ts-fsrs';

import { addDays, instant, localDay } from '../day.js';
import { type Grade } from '../practice/grade.js';
import { type ChunkProgress, MAX_LEVEL } from '../progress/codec.js';

/**
 * Each learnt chunk is a card in FSRS, through ts-fsrs (docs/ARCHITECTURE.md
 * §5, `docs/research.md` §3.4). Its state lives in the chunk's own entry under
 * `progress`, and is turned into a ts-fsrs card only to be reviewed:
 *
 * - `due` is a day, not an instant: a chunk is due on a day of the user's own.
 * - `stability` and `difficulty` are kept to two places, and what the file
 *   has is the truth (§3).
 * - `reviewed` is when it was last practised, and so where FSRS counts the
 *   days since from.
 * - A chunk learnt but not yet reviewed has no `stability`: a new card, whose
 *   first review — the day after it was learnt — is its first rating.
 *
 * Short-term steps are off, since the fade ladder does first learning; fuzz is
 * on, so reviews learnt together do not stay together.
 */

/** How likely a review should find a chunk remembered. */
export const RETENTIONS = [0.85, 0.9, 0.95] as const;
export type Retention = (typeof RETENTIONS)[number];
export const DEFAULT_RETENTION: Retention = 0.9;

/** The longest a chunk goes between reviews, in days. */
export const MAX_INTERVAL = 365;

/** The level a forgotten chunk is relearnt from. */
export const LAPSE_LEVEL = 3;

export interface ScheduleSettings {
	readonly retention: number;
	readonly maxInterval: number;
}

export const DEFAULT_SCHEDULE: ScheduleSettings = {
	retention: DEFAULT_RETENTION,
	maxInterval: MAX_INTERVAL,
};

const RATINGS: Readonly<Record<Grade, Rating>> = {
	again: Ratings.Again,
	hard: Ratings.Hard,
	good: Ratings.Good,
	easy: Ratings.Easy,
};

const round = (value: number): number => Math.round(value * 100) / 100;

/** A day as a moment: its local noon, clear of any change of clocks. */
const noonOf = (day: string): Date => {
	const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
	return new Date(year, month - 1, date, 12);
};

const daysBetween = (from: string, to: string): number =>
	Math.round((noonOf(to).getTime() - noonOf(from).getTime()) / 86_400_000);

/** A chunk's entry as a ts-fsrs card; none for a chunk not yet learnt. */
export const cardOf = (progress: ChunkProgress): Card | undefined => {
	const { due, stability, difficulty, reviewed } = progress;
	if (due === undefined) return undefined;
	const last = reviewed === undefined ? undefined : new Date(reviewed);
	if (stability === undefined || difficulty === undefined) {
		return { ...createEmptyCard<Card>(last ?? noonOf(due)), due: noonOf(due) };
	}
	return {
		due: noonOf(due),
		stability,
		difficulty,
		elapsed_days: 0,
		scheduled_days: last === undefined ? 0 : Math.max(0, daysBetween(localDay(last), due)),
		learning_steps: 0,
		reps: progress.reps ?? 0,
		lapses: progress.lapses ?? 0,
		state: State.Review,
		...(last === undefined ? {} : { last_review: last }),
	};
};

const schedulerFor = ({ retention, maxInterval }: ScheduleSettings) =>
	fsrs({
		request_retention: retention,
		maximum_interval: maxInterval,
		enable_fuzz: true,
		enable_short_term: false,
	});

/**
 * A learnt chunk's entry after a review graded `grade`: its card moved on by
 * FSRS, due on a day at least one after today. Forgotten — graded Again — it
 * drops to `LAPSE_LEVEL`, and is relearnt up the ladder before its next review.
 */
export const reviewed = (
	progress: ChunkProgress,
	grade: Grade,
	now: Date,
	settings: ScheduleSettings = DEFAULT_SCHEDULE
): ChunkProgress => {
	const card = cardOf(progress);
	if (card === undefined) return progress;
	const next = schedulerFor(settings).next(card, now, RATINGS[grade]).card;
	const today = localDay(now);
	const due = localDay(next.due) <= today ? addDays(today, 1) : localDay(next.due);
	return {
		...progress,
		level: grade === 'again' ? Math.min(progress.level, LAPSE_LEVEL) : MAX_LEVEL,
		due,
		stability: round(next.stability),
		difficulty: round(next.difficulty),
		reps: next.reps,
		lapses: next.lapses,
		reviewed: instant(now),
	};
};

/**
 * How likely a learnt chunk is remembered now, from 0 to 1: what the due
 * queue is ordered by, the least likely first, and what memory health is the
 * mean of (§6). A chunk not yet reviewed counts as certain until it is due.
 */
export const recall = (progress: ChunkProgress, now: Date): number | undefined => {
	const card = cardOf(progress);
	if (card === undefined) return undefined;
	if (card.state === State.New) return 1;
	return schedulerFor(DEFAULT_SCHEDULE).get_retrievability(card, now, false);
};

/** Whether a chunk is due for review on `today`: learnt, not relearning, its day come. */
export const isDue = (progress: ChunkProgress | undefined, today: string): boolean =>
	progress?.due !== undefined && progress.level >= MAX_LEVEL && progress.due <= today;

/** Whether a chunk was forgotten at a review and is being learnt again. */
export const isRelearning = (progress: ChunkProgress | undefined): boolean =>
	progress?.due !== undefined && progress.level < MAX_LEVEL;
