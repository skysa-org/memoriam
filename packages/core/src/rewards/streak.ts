import { addDays, daysBetween, weekday } from '../day.js';
import { median } from '../practice/pass.js';
import { type DayActivity } from './activity.js';

/**
 * The streak, worked out afresh from the days practised (docs/ARCHITECTURE.md
 * §6), so it needs nothing stored and syncs as the activity files do. It is
 * forgiving by design (`docs/research.md` §5):
 *
 * - a day counts once any pass is finished on it, on any device;
 * - each 7 days in a row earns a freeze, and at most 2 are held; a freeze is
 *   spent by itself on a day missed;
 * - a day missed with no freeze to spend can be mended within 2 days by a day
 *   of twice the usual practice;
 * - a weekly rest day, if one is chosen, neither counts nor breaks it;
 * - today is never missed: it is not over.
 */

export const MAX_FREEZES = 2;
/** Days in a row that earn a freeze. */
export const FREEZE_EVERY = 7;
/** Days after a miss in which a repair can be made. */
export const REPAIR_DAYS = 2;
/** Practised days a usual day is measured over. */
const USUAL_DAYS = 28;
/** The fewest words a repair asks for. */
export const REPAIR_FLOOR = 40;
/** Days without practice that make coming back a comeback. */
export const BREAK_DAYS = 7;
/** Streak lengths worth marking: each a badge (`badges.ts`). */
export const STREAK_MILESTONES = [7, 30, 100, 365] as const;

/** How a day that was not practised was kept from breaking the streak. */
export type Kept = 'freeze' | 'repair' | 'rest';

export interface Streak {
	/** Days practised in the streak that runs to today; 0 for none. */
	readonly length: number;
	/** The longest streak there has been. */
	readonly best: number;
	/** Freezes held. */
	readonly freezes: number;
	readonly practisedToday: boolean;
	/** The days not practised that the streak kept, and how. */
	readonly kept: ReadonlyMap<string, Kept>;
	/** The day each milestone length was first reached. */
	readonly reached: ReadonlyMap<number, string>;
	/** Days practice came back after a break of `BREAK_DAYS` or more. */
	readonly comebacks: readonly string[];
	/** A day missed that `words` words of practice by the end of `until` would mend. */
	readonly repair?: Readonly<{ missed: string; until: string; words: number }>;
}

export interface StreakOptions {
	/** The weekly rest day: 0 for Sunday, to 6 for Saturday. */
	readonly restDay?: number;
}

export const NO_STREAK: Streak = {
	length: 0,
	best: 0,
	freezes: 0,
	practisedToday: false,
	kept: new Map(),
	reached: new Map(),
	comebacks: [],
};

interface Walk {
	readonly length: number;
	readonly best: number;
	readonly freezes: number;
	/** Days practised in a row, toward the next freeze. */
	readonly inARow: number;
	readonly kept: ReadonlyMap<string, Kept>;
	readonly reached: ReadonlyMap<number, string>;
	readonly comebacks: readonly string[];
	readonly last?: string;
	/** Days missed with nothing to keep them, waiting on a repair. */
	readonly missed: readonly string[];
	/** Days practised since the last of those. */
	readonly since: number;
}

const practised = (day: DayActivity | undefined): boolean => (day?.passes ?? 0) > 0;

/** The words a repair asks for: twice a usual day before `missed`, and at least the floor. */
export const repairWords = (days: ReadonlyMap<string, DayActivity>, missed: string): number => {
	const before = [...days]
		.filter(([day, activity]) => day < missed && practised(activity))
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.slice(-USUAL_DAYS)
		.map(([, activity]) => activity.words);
	return Math.max(REPAIR_FLOOR, 2 * (median(before) ?? 0));
};

const practise = (walk: Walk, day: string, days: ReadonlyMap<string, DayActivity>): Walk => {
	const back =
		walk.last !== undefined && daysBetween(walk.last, day) - 1 >= BREAK_DAYS
			? [...walk.comebacks, day]
			: walk.comebacks;
	const first = walk.missed[0];
	const mended = first !== undefined && (days.get(day)?.words ?? 0) >= repairWords(days, first);
	const length = walk.length + 1;
	const inARow = walk.inARow + 1;
	const earned = inARow % FREEZE_EVERY === 0 ? 1 : 0;
	const milestone = STREAK_MILESTONES.find((each) => each === length && !walk.reached.has(each));
	return {
		...walk,
		length,
		best: Math.max(walk.best, length),
		freezes: Math.min(MAX_FREEZES, walk.freezes + earned),
		inARow,
		kept: mended
			? new Map([...walk.kept, ...walk.missed.map((each) => [each, 'repair'] as const)])
			: walk.kept,
		reached: milestone === undefined ? walk.reached : new Map(walk.reached).set(milestone, day),
		comebacks: back,
		last: day,
		missed: mended ? [] : walk.missed,
		since: mended ? 0 : walk.since + 1,
	};
};

const miss = (walk: Walk, day: string): Walk => {
	if (walk.length === 0) return walk;
	if (walk.freezes > 0) {
		return {
			...walk,
			freezes: walk.freezes - 1,
			inARow: 0,
			kept: new Map(walk.kept).set(day, 'freeze'),
		};
	}
	return { ...walk, missed: [...walk.missed, day], since: 0 };
};

/** Once the first day missed can no longer be mended, the streak is what came after it. */
const settle = (walk: Walk, day: string): Walk => {
	const first = walk.missed[0];
	if (first === undefined || daysBetween(first, day) < REPAIR_DAYS) return walk;
	return { ...walk, length: walk.since, inARow: walk.since, missed: [], since: 0 };
};

/** The streak on `today`, from each day's practice, every device's summed (`dayTotals`). */
export const streakOf = (
	days: ReadonlyMap<string, DayActivity>,
	today: string,
	{ restDay }: StreakOptions = {}
): Streak => {
	const first = [...days.keys()].filter((day) => practised(days.get(day))).sort()[0];
	if (first === undefined || first > today) return NO_STREAK;
	const span = Array.from({ length: daysBetween(first, today) + 1 }, (_, at) =>
		addDays(first, at)
	);
	const walk = span.reduce<Walk>(
		(before, day) => {
			if (practised(days.get(day))) return settle(practise(before, day, days), day);
			if (day === today) return before;
			if (restDay === weekday(day)) {
				return before.length === 0
					? before
					: settle({ ...before, kept: new Map(before.kept).set(day, 'rest') }, day);
			}
			return settle(miss(before, day), day);
		},
		{
			length: 0,
			best: 0,
			freezes: 0,
			inARow: 0,
			kept: new Map(),
			reached: new Map(),
			comebacks: [],
			missed: [],
			since: 0,
		}
	);
	const missed = walk.missed[0];
	return {
		length: walk.length,
		best: walk.best,
		freezes: walk.freezes,
		practisedToday: practised(days.get(today)),
		kept: walk.kept,
		reached: walk.reached,
		comebacks: walk.comebacks,
		...(missed === undefined
			? {}
			: {
					repair: {
						missed,
						until: addDays(missed, REPAIR_DAYS),
						words: repairWords(days, missed),
					},
				}),
	};
};
