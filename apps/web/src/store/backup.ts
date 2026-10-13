import { daysBetween, isHidden, localDay } from '@memoriam/core';
import { useLiveQuery } from 'dexie-react-hooks';

import { db as defaultDb, LOCAL_CONNECTION_ID, type MemoriamDatabase } from './db.js';
import { getPreference, setPreference } from './prefs.js';

/**
 * When to remind the user to export a backup (docs/ARCHITECTURE.md §8,
 * "Keeping data"). Until sync, the library is only in this browser, which may
 * lose it: so once a week, if anything has changed since the last backup,
 * Today says so. "Not now" puts it off for a few days.
 */

/** When the library was last exported from this device, in epoch milliseconds. */
export const EXPORTED_KEY = 'backup.exported';
/** Until when the reminder is put off, in epoch milliseconds. */
export const SNOOZED_KEY = 'backup.snoozed';

/** How old the last backup may be before the user is reminded. */
export const BACKUP_DAYS = 7;
/** How long "Not now" puts the reminder off for. */
export const SNOOZE_DAYS = 3;

const DAY_MS = 86_400_000;

export interface BackupState {
	readonly exportedAt?: number;
	readonly snoozedUntil?: number;
	/** When the earliest passage was made; none in a library with none. */
	readonly since?: number;
	/** The last write to any file: an edit, an import, a day's practice. */
	readonly changedAt?: number;
}

export type BackupReminder =
	/** No backup has been made here. */
	| Readonly<{ kind: 'never' }>
	/** The last was this many days ago, and the library has changed since. */
	| Readonly<{ kind: 'since'; days: number }>;

/** Whether to remind the user to back up, and how to say it; none if not. */
export const backupReminder = (state: BackupState, now: number): BackupReminder | undefined => {
	const { exportedAt, snoozedUntil, since, changedAt } = state;
	if (since === undefined || changedAt === undefined) return undefined;
	if (snoozedUntil !== undefined && now < snoozedUntil) return undefined;
	const today = localDay(new Date(now));
	if (exportedAt === undefined) {
		return daysBetween(localDay(new Date(since)), today) >= BACKUP_DAYS
			? { kind: 'never' }
			: undefined;
	}
	if (changedAt <= exportedAt) return undefined;
	const days = daysBetween(localDay(new Date(exportedAt)), today);
	return days >= BACKUP_DAYS ? { kind: 'since', days } : undefined;
};

const timeOf = async (db: MemoriamDatabase, key: string): Promise<number | undefined> => {
	const kept = Number(await getPreference(db, key));
	return Number.isFinite(kept) && kept > 0 ? kept : undefined;
};

export const backupState = async (
	db: MemoriamDatabase,
	connectionId: string = LOCAL_CONNECTION_ID
): Promise<BackupState> => {
	const rows = await db.notes.where('connectionId').equals(connectionId).toArray();
	const passages = rows.filter((row) => !isHidden(row.path));
	const exportedAt = await timeOf(db, EXPORTED_KEY);
	const snoozedUntil = await timeOf(db, SNOOZED_KEY);
	return {
		...(exportedAt === undefined ? {} : { exportedAt }),
		...(snoozedUntil === undefined ? {} : { snoozedUntil }),
		...(passages.length === 0
			? {}
			: {
					since: Math.min(...passages.map((row) => row.createdAt)),
					changedAt: Math.max(...rows.map((row) => row.updatedAt)),
				}),
	};
};

/** The reminder, live: gone the moment a backup is made or put off. */
export const useBackupReminder = (
	now: Date = new Date(),
	db: MemoriamDatabase = defaultDb
): BackupReminder | undefined | null => {
	const day = localDay(now);
	const reminder = useLiveQuery(
		async () => backupReminder(await backupState(db), Date.now()) ?? null,
		// The day, so a page left open past midnight looks again.
		[db, day]
	);
	return reminder;
};

/** Note that the library was exported just now. */
export const noteExported = async (db: MemoriamDatabase, now: Date): Promise<void> => {
	await db.transaction('rw', db.prefs, async () => {
		await setPreference(db, EXPORTED_KEY, String(now.getTime()));
		await db.prefs.delete(SNOOZED_KEY);
	});
};

/** Put the reminder off for a few days. */
export const snoozeBackup = (db: MemoriamDatabase, now: Date): Promise<void> =>
	setPreference(db, SNOOZED_KEY, String(now.getTime() + SNOOZE_DAYS * DAY_MS));
