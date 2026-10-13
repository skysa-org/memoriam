import { addDays, daysBetween, weekday } from '../day.js';
import { type DayActivity } from './activity.js';
import { type Kept } from './streak.js';

/**
 * Practice by the day, as weeks of cells (docs/ARCHITECTURE.md §6): each day's
 * words typed, on a scale of 0 to 4 set by the days practised in view, so a
 * light week still shows its shape beside a heavy one.
 */

export interface HeatDay {
	readonly day: string;
	readonly words: number;
	/** 0 for none; 1 to 4 by the quarter of the practised days in view it falls in. */
	readonly level: 0 | 1 | 2 | 3 | 4;
	/** How a day not practised was kept from breaking the streak. */
	readonly kept?: Kept;
}

/** A week, from its first day; days after `today` are left out. */
export type HeatWeek = readonly HeatDay[];

const LEVELS = [1, 2, 3, 4] as const;

const levelOf = (words: number, cuts: readonly number[]): HeatDay['level'] => {
	if (words <= 0) return 0;
	return LEVELS.find((_, at) => words <= (cuts[at] ?? Infinity)) ?? 4;
};

/** The quarter points of the words of the days practised, highest last. */
const quarters = (words: readonly number[]): number[] => {
	const sorted = words.filter((each) => each > 0).sort((a, b) => a - b);
	return [0.25, 0.5, 0.75, 1].map(
		(share) => sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0
	);
};

/**
 * The `weeks` weeks up to the one with `today` in it, each from `weekStart`
 * (0 for Sunday, 1 for Monday), oldest first.
 */
export const heatmap = (
	days: ReadonlyMap<string, DayActivity>,
	today: string,
	{
		weeks,
		weekStart = 1,
		kept = new Map(),
	}: Readonly<{ weeks: number; weekStart?: number; kept?: ReadonlyMap<string, Kept> }>
): HeatWeek[] => {
	const back = (weekday(today) - weekStart + 7) % 7;
	const first = addDays(today, -back - 7 * (weeks - 1));
	const span = Array.from({ length: daysBetween(first, today) + 1 }, (_, at) =>
		addDays(first, at)
	);
	const cuts = quarters(span.map((day) => days.get(day)?.words ?? 0));
	const cells = span.map((day): HeatDay => {
		const words = days.get(day)?.words ?? 0;
		const how = kept.get(day);
		return {
			day,
			words,
			level: levelOf(words, cuts),
			...(how === undefined ? {} : { kept: how }),
		};
	});
	return Array.from({ length: weeks }, (_, week) => cells.slice(week * 7, week * 7 + 7));
};
