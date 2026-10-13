import {
	DEFAULT_NEW_WORDS,
	DEFAULT_RETENTION,
	MAX_INTERVAL,
	type Retention,
	RETENTIONS,
} from '@memoriam/core';
import { useLiveQuery } from 'dexie-react-hooks';

import { db as defaultDb, type MemoriamDatabase } from './db.js';

/**
 * How practice is scheduled and typed, as the user has set it on this device
 * (docs/ARCHITECTURE.md §5, §7). Each is one of a few choices, and a value
 * that is none of them reads as the default.
 */

export interface Settings {
	/** How likely a review should find a chunk remembered. */
	readonly retention: Retention;
	/** Words of new chunks a day begins, at most. */
	readonly newWords: number;
	/** The longest a chunk goes between reviews, in days. */
	readonly maxInterval: number;
	/** Whether a key next to the right one, on a touch keyboard, is a slip. */
	readonly slips: boolean;
	/** The weekly rest day, which neither counts nor breaks a streak: 0 for Sunday, to 6. */
	readonly restDay?: number;
}

export const NEW_WORD_CHOICES = [20, 30, 50, 80, 120] as const;
export const INTERVAL_CHOICES = [90, 180, 365] as const;

export const DEFAULT_SETTINGS: Settings = {
	retention: DEFAULT_RETENTION,
	newWords: DEFAULT_NEW_WORDS,
	maxInterval: MAX_INTERVAL,
	slips: true,
};

export const SETTING_KEYS = {
	retention: 'schedule.retention',
	newWords: 'schedule.newWords',
	maxInterval: 'schedule.maxInterval',
	slips: 'practice.slips',
	restDay: 'streak.restDay',
} as const satisfies Record<keyof Settings, string>;

const oneOf = <T extends number>(
	choices: readonly T[],
	value: string | undefined,
	fallback: T
): T => choices.find((choice) => String(choice) === value) ?? fallback;

export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

const restDayOf = (value: string | undefined): Readonly<{ restDay?: number }> => {
	const day = WEEKDAYS.find((each) => String(each) === value);
	return day === undefined ? {} : { restDay: day };
};

export const readSettings = async (db: MemoriamDatabase): Promise<Settings> => {
	const kept = new Map(
		(await db.prefs.bulkGet(Object.values(SETTING_KEYS))).flatMap((row) =>
			row === undefined ? [] : [[row.key, row.value] as const]
		)
	);
	return {
		retention: oneOf(RETENTIONS, kept.get(SETTING_KEYS.retention), DEFAULT_SETTINGS.retention),
		newWords: oneOf(
			NEW_WORD_CHOICES,
			kept.get(SETTING_KEYS.newWords),
			DEFAULT_SETTINGS.newWords
		),
		maxInterval: oneOf(
			INTERVAL_CHOICES,
			kept.get(SETTING_KEYS.maxInterval),
			DEFAULT_SETTINGS.maxInterval
		),
		slips: kept.get(SETTING_KEYS.slips) !== 'false',
		...restDayOf(kept.get(SETTING_KEYS.restDay)),
	};
};

/** Keep a setting; one that is optional, left unset, is forgotten. */
export const saveSetting = async <K extends keyof Settings>(
	db: MemoriamDatabase,
	key: K,
	value: Settings[K] | undefined
): Promise<void> => {
	await (value === undefined
		? db.prefs.delete(SETTING_KEYS[key])
		: db.prefs.put({ key: SETTING_KEYS[key], value: String(value) }));
};

/** The settings, live; `undefined` while the first read is on its way. */
export const useSettings = (db: MemoriamDatabase = defaultDb): Settings | undefined =>
	useLiveQuery(() => readSettings(db), [db]);
