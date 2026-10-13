import { addDays } from '../day.js';
import { daysHeld, type Measure } from './mastery.js';
import { type Streak } from './streak.js';

/**
 * Milestone badges (docs/ARCHITECTURE.md §6): for what is learnt and kept,
 * more than for volume (`docs/research.md` §5). Each is earned once, and the
 * day it was is kept in the activity files' `badges:` (`addBadges`), so one
 * earned stays earned whatever later becomes of the passage that earned it.
 */

/** Words learnt, across the library. */
export const WORD_BADGES = [
	[100, 'words-100'],
	[500, 'words-500'],
	[1000, 'words-1000'],
	[5000, 'words-5000'],
] as const;

/** Days in a row (`STREAK_MILESTONES`). */
export const STREAK_BADGES = [
	[7, 'streak-7'],
	[30, 'streak-30'],
	[100, 'streak-100'],
	[365, 'streak-365'],
] as const;

/** Days a passage has been held, every part learnt and kept up. */
export const HELD_BADGES = [
	[30, 'held-30'],
	[90, 'held-90'],
	[365, 'held-365'],
] as const;

export const BADGES = [
	'first-learnt',
	'first-mastered',
	...WORD_BADGES.map(([, badge]) => badge),
	...STREAK_BADGES.map(([, badge]) => badge),
	...HELD_BADGES.map(([, badge]) => badge),
	'clean-run',
	'comeback',
] as const;

export type Badge = (typeof BADGES)[number];

export const isBadge = (value: string): value is Badge => BADGES.some((badge) => badge === value);

export interface BadgeInput {
	readonly today: string;
	readonly passages: readonly Measure[];
	readonly streak: Streak;
}

const earliest = (days: readonly string[]): string | undefined => [...days].sort()[0];

/**
 * The badges what the library and the activity show now have earned, and the
 * day each was, as near as can be told: a streak's, the day it reached its
 * length; a passage held, the day it had been held long enough; a comeback,
 * the day of the first; the rest, today. `clean-run` is earned by a pass, not
 * by a state, and is not here.
 */
export const earnedBadges = ({ today, passages, streak }: BadgeInput): Map<Badge, string> => {
	const words = passages.reduce((sum, passage) => sum + passage.learntWords, 0);
	const held = passages.flatMap((passage) => {
		const days = daysHeld(passage, today);
		return days === undefined || passage.heldSince === undefined
			? []
			: [{ days, since: passage.heldSince }];
	});
	const entries: (readonly [Badge, string | undefined])[] = [
		[
			'first-learnt',
			earliest(
				passages.flatMap((passage) => (passage.learnt ? [passage.heldSince ?? today] : []))
			),
		],
		['first-mastered', passages.some((passage) => passage.mastered) ? today : undefined],
		...WORD_BADGES.map(
			([count, badge]) => [badge, words >= count ? today : undefined] as const
		),
		...STREAK_BADGES.map(([length, badge]) => [badge, streak.reached.get(length)] as const),
		...HELD_BADGES.map(
			([count, badge]) =>
				[
					badge,
					earliest(
						held
							.filter((each) => each.days >= count)
							.map((each) => addDays(each.since, count))
					),
				] as const
		),
		['comeback', streak.comebacks[0]],
	];
	return new Map(
		entries.flatMap(([badge, day]) => (day === undefined ? [] : [[badge, day] as const]))
	);
};
