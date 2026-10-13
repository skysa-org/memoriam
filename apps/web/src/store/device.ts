import { type MemoriamDatabase } from './db.js';

/**
 * This device's name for itself: eight characters, made the first time it is
 * asked for and kept. A day's practice is recorded under it
 * (`activity-YYYY.md`, docs/ARCHITECTURE.md §3), so that each day key has one
 * writer and two devices' records merge exactly.
 *
 * Not a fingerprint and not sent anywhere but into the user's own files. A
 * device whose storage is cleared is a new device, which costs nothing: its
 * days are its own either way.
 */

export const DEVICE_KEY = 'device.id';

/** Crockford's base 32, lowercased, as chunk keys are. */
const BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';

const freshId = (): string =>
	Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => BASE32.charAt(byte % 32)).join(
		''
	);

/** One transaction, so two tabs asking at once still agree on the answer. */
export const deviceId = (db: MemoriamDatabase): Promise<string> =>
	db.transaction('rw', db.prefs, async () => {
		const found = await db.prefs.get(DEVICE_KEY);
		if (found !== undefined) return found.value;
		const id = freshId();
		await db.prefs.add({ key: DEVICE_KEY, value: id });
		return id;
	});
