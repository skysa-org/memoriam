import { type MemoriamDatabase } from './db.js';

/**
 * This device's settings. Small enough that a key/value table is the whole
 * story; every read returns a usable default so a fresh install needs no
 * seeding.
 */

export const getPreference = async (
	db: MemoriamDatabase,
	key: string
): Promise<string | undefined> => (await db.prefs.get(key))?.value;

export const setPreference = async (
	db: MemoriamDatabase,
	key: string,
	value: string
): Promise<void> => {
	await db.prefs.put({ key, value });
};

export const INSTALL_DISMISSED_KEY = 'installDismissed';

/**
 * Whether the banner offering to install the app has been dismissed on this
 * device (`install/InstallBanner.tsx`). Once is for good. Kept as when, which
 * nothing reads yet.
 */
export const getInstallDismissed = async (db: MemoriamDatabase): Promise<boolean> =>
	(await getPreference(db, INSTALL_DISMISSED_KEY)) !== undefined;

export const dismissInstall = (db: MemoriamDatabase, now: Date = new Date()): Promise<void> =>
	setPreference(db, INSTALL_DISMISSED_KEY, now.toISOString());
