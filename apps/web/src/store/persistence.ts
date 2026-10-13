import { isHidden } from '@memoriam/core';

import { LOCAL_CONNECTION_ID, type MemoriamDatabase } from './db.js';
import { getPreference, setPreference } from './prefs.js';

/**
 * Asking the browser to keep the library (docs/ARCHITECTURE.md §8, "Keeping
 * data"). Storage a site has not been granted for good is the browser's to
 * clear: when the disk runs short, and in Safari after seven days without use
 * unless the app is installed. Asked once there is a passage to keep, and
 * again a month later while the answer is no: Chromium and Safari answer by
 * how the site is used, so a later ask may be granted, and Firefox asks the
 * user, who is not to be asked every visit.
 */

/** Kept for good, the browser's to clear, or a browser that cannot say. */
export type Persistence = 'kept' | 'unkept' | 'unknown';

/** The part of `navigator.storage` this uses. */
export type StorageApi = Readonly<{
	persist?: () => Promise<boolean>;
	persisted?: () => Promise<boolean>;
}>;

/** When the browser was last asked, in epoch milliseconds. */
export const ASKED_KEY = 'storage.asked';

/** How long a refusal stands before the browser is asked again. */
export const ASK_AGAIN_DAYS = 30;

const DAY_MS = 86_400_000;

/** This browser's storage API; none in one too old to have it. */
export const browserStorage = (): StorageApi | undefined =>
	typeof navigator === 'undefined' || !('storage' in navigator) ? undefined : navigator.storage;

const answer = async (asked: (() => Promise<boolean>) | undefined): Promise<Persistence> => {
	if (asked === undefined) return 'unknown';
	try {
		return (await asked()) ? 'kept' : 'unkept';
	} catch {
		return 'unknown';
	}
};

/** Whether the browser has agreed to keep the library. */
export const persistence = (storage: StorageApi | undefined = browserStorage()) =>
	answer(storage?.persisted?.bind(storage));

/** Ask the browser to keep the library, and say what it answered. */
export const askToKeep = (storage: StorageApi | undefined = browserStorage()) =>
	answer(storage?.persist?.bind(storage));

/** Whether to ask now: there is a passage to keep, and no recent answer stands. */
export const shouldAsk = async (
	db: MemoriamDatabase,
	now: number,
	connectionId: string = LOCAL_CONNECTION_ID
): Promise<boolean> => {
	const asked = Number(await getPreference(db, ASKED_KEY));
	if (Number.isFinite(asked) && now - asked < ASK_AGAIN_DAYS * DAY_MS) return false;
	const rows = await db.notes.where('connectionId').equals(connectionId).toArray();
	return rows.some((row) => !isHidden(row.path));
};

/** Ask, if it is time to, and note that it was asked; the answer, or none if not asked. */
export const keepIfDue = async (
	db: MemoriamDatabase,
	storage: StorageApi | undefined,
	now: number
): Promise<Persistence | undefined> => {
	if ((await persistence(storage)) !== 'unkept') return undefined;
	if (!(await shouldAsk(db, now))) return undefined;
	await setPreference(db, ASKED_KEY, String(now));
	return askToKeep(storage);
};
