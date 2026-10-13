import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDatabase, type MemoriamDatabase } from '../src/store/db.js';
import { rowFor } from '../src/store/passages.js';
import {
	ASK_AGAIN_DAYS,
	ASKED_KEY,
	keepIfDue,
	persistence,
	type StorageApi,
} from '../src/store/persistence.js';
import { getPreference, setPreference } from '../src/store/prefs.js';

/** Asking the browser to keep the library: once there is one, and not too often. */

const NOW = Date.UTC(2026, 9, 13);
const DAY = 86_400_000;

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`persist-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

/** A browser that keeps nothing for good until asked, and then answers `grants`. */
const storage = (grants: boolean, kept = false) => {
	const persist = vi.fn(() => Promise.resolve(grants));
	return { persist, persisted: () => Promise.resolve(kept) } satisfies StorageApi;
};

const passage = () =>
	db.notes.put(
		rowFor({
			connectionId: 'local',
			id: 'a',
			path: 'a.md',
			source: 'Jesus wept.\n',
			createdAt: 0,
			updatedAt: 0,
		})
	);

describe('keepIfDue', () => {
	it('asks once there is a passage, and notes when', async () => {
		const browser = storage(true);
		expect(await keepIfDue(db, browser, NOW)).toBeUndefined();
		expect(browser.persist).not.toHaveBeenCalled();

		await passage();
		expect(await keepIfDue(db, browser, NOW)).toBe('kept');
		expect(await getPreference(db, ASKED_KEY)).toBe(String(NOW));
	});

	it('takes a no for a month', async () => {
		const browser = storage(false);
		await passage();
		expect(await keepIfDue(db, browser, NOW)).toBe('unkept');
		expect(await keepIfDue(db, browser, NOW + (ASK_AGAIN_DAYS - 1) * DAY)).toBeUndefined();
		expect(await keepIfDue(db, browser, NOW + ASK_AGAIN_DAYS * DAY)).toBe('unkept');
		expect(browser.persist).toHaveBeenCalledTimes(2);
	});

	it('does not ask a browser that keeps it already, or cannot say', async () => {
		await passage();
		await setPreference(db, ASKED_KEY, 'never');
		const kept = storage(true, true);
		expect(await keepIfDue(db, kept, NOW)).toBeUndefined();
		expect(kept.persist).not.toHaveBeenCalled();
		expect(await keepIfDue(db, undefined, NOW)).toBeUndefined();
		expect(await keepIfDue(db, {}, NOW)).toBeUndefined();
	});
});

describe('persistence', () => {
	it('is unknown where the browser cannot say, or fails to', async () => {
		expect(await persistence(undefined)).toBe('unknown');
		expect(await persistence({ persisted: () => Promise.reject(new Error('no')) })).toBe(
			'unknown'
		);
		expect(await persistence(storage(false, true))).toBe('kept');
	});
});
