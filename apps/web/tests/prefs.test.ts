import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type MemoriamDatabase } from '../src/store/db.js';
import {
	dismissInstall,
	getInstallDismissed,
	getPreference,
	setPreference,
} from '../src/store/prefs.js';

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`prefs-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

describe('preferences', () => {
	it('reads nothing for a key never set, and what was set after', async () => {
		expect(await getPreference(db, 'retention')).toBeUndefined();
		await setPreference(db, 'retention', '0.9');
		expect(await getPreference(db, 'retention')).toBe('0.9');
	});

	it('remembers that the install banner was dismissed, for good', async () => {
		expect(await getInstallDismissed(db)).toBe(false);
		await dismissInstall(db, new Date('2026-10-13T12:00:00Z'));
		expect(await getInstallDismissed(db)).toBe(true);
		expect(await getPreference(db, 'installDismissed')).toBe('2026-10-13T12:00:00.000Z');
	});
});
