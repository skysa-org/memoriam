import {
	addBadges,
	type Badge,
	type DayActivity,
	dayTotals,
	earnedBadges,
	isActivityPath,
	isBadge,
	isHidden,
	localDay,
	type Measure,
	measure,
	readActivity,
	recordedBadges,
	type Streak,
	streakOf,
} from '@memoriam/core';
import { useLiveQuery } from 'dexie-react-hooks';

import {
	db as defaultDb,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
} from './db.js';
import { changeActivity } from './practice.js';
import { readied } from './schedule.js';
import { readSettings, type Settings } from './settings.js';

/**
 * Rewards, worked out afresh from the passages and the activity files each
 * time they change (docs/ARCHITECTURE.md §6): nothing is stored but the day
 * each badge was earned.
 */

export interface Rewards {
	readonly today: string;
	readonly streak: Streak;
	/** Each day's practice, every device's summed. */
	readonly days: ReadonlyMap<string, DayActivity>;
	/** Each passage's measure, by id. */
	readonly measures: ReadonlyMap<string, Measure>;
	/** The passages, by title, each with its measure. */
	readonly passages: readonly Readonly<{ id: string; title: string; measure: Measure }>[];
	/** Every badge earned, and the day it was: recorded, or earned now and not yet. */
	readonly badges: ReadonlyMap<Badge, string>;
	/** Badges earned that no activity file records yet. */
	readonly unrecorded: ReadonlyMap<Badge, string>;
}

export const rewardsFor = (
	rows: readonly NoteRecord[],
	settings: Pick<Settings, 'restDay'>,
	now: Date
): Rewards => {
	const today = localDay(now);
	const activities = rows
		.filter((row) => isActivityPath(row.path))
		.map((row) => readActivity(row.source));
	const days = dayTotals(activities);
	const streak = streakOf(
		days,
		today,
		settings.restDay === undefined ? {} : { restDay: settings.restDay }
	);
	const measured = rows
		.filter((row) => !isHidden(row.path))
		.flatMap((row) => {
			const passage = readied(row);
			return passage === undefined
				? []
				: [
						{
							id: row.id,
							title: row.title,
							measure: measure(passage.chunked, passage.progress, now),
						},
					];
		});
	const passages = [...measured].sort((a, b) => a.title.localeCompare(b.title));
	const measures = new Map(passages.map((passage) => [passage.id, passage.measure]));
	const recorded = new Map(
		[...recordedBadges(activities)].flatMap(([badge, day]) =>
			isBadge(badge) ? [[badge, day] as const] : []
		)
	);
	const earned = earnedBadges({ today, passages: [...measures.values()], streak });
	const unrecorded = new Map([...earned].filter(([badge]) => !recorded.has(badge)));
	return {
		today,
		streak,
		days,
		measures,
		passages,
		badges: new Map([...unrecorded, ...recorded]),
		unrecorded,
	};
};

/** The rewards, live. */
export const useRewards = (
	now: Date = new Date(),
	db: MemoriamDatabase = defaultDb,
	connectionId: string = LOCAL_CONNECTION_ID
): Rewards | undefined => {
	const day = localDay(now);
	return useLiveQuery(
		async () => {
			const rows = await db.notes.where('connectionId').equals(connectionId).toArray();
			return rewardsFor(rows, await readSettings(db), new Date());
		},
		// The day, so a page left open past midnight counts the new one.
		[db, connectionId, day]
	);
};

/** Write badges earned into this year's activity file; false where it cannot be read. */
export const recordBadges = (
	db: MemoriamDatabase,
	badges: ReadonlyMap<Badge, string>,
	{ connectionId = LOCAL_CONNECTION_ID }: Readonly<{ connectionId?: string }> = {},
	now: Date = new Date()
): Promise<boolean> =>
	db.transaction('rw', db.notes, () =>
		changeActivity(db, connectionId, now, (text) => addBadges(text, badges))
	);
