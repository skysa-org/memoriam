import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exportLibrary } from '../src/archive/exportLibrary.js';
import {
	BACKUP_DAYS,
	backupReminder,
	backupState,
	EXPORTED_KEY,
	snoozeBackup,
	SNOOZED_KEY,
} from '../src/store/backup.js';
import { bindLibrary } from '../src/store/connection.js';
import { createDatabase, type MemoriamDatabase } from '../src/store/db.js';
import { rowFor } from '../src/store/passages.js';
import { getPreference } from '../src/store/prefs.js';

/** When Today reminds the user to back up, and what puts the reminder away. */

const NOW = new Date(2026, 9, 13, 9).getTime();
const DAY = 86_400_000;
const ago = (days: number) => NOW - days * DAY;

describe('backupReminder', () => {
	it('says nothing of a library with nothing in it', () => {
		expect(backupReminder({}, NOW)).toBeUndefined();
	});

	it('waits a week from the first passage before the first reminder', () => {
		expect(backupReminder({ since: ago(BACKUP_DAYS - 1), changedAt: ago(0) }, NOW)).toBe(
			undefined
		);
		expect(backupReminder({ since: ago(BACKUP_DAYS), changedAt: ago(0) }, NOW)).toEqual({
			kind: 'never',
		});
	});

	it('reminds a week after the last backup, if anything has changed since', () => {
		const state = { since: ago(60), exportedAt: ago(9) };
		expect(backupReminder({ ...state, changedAt: ago(10) }, NOW)).toBeUndefined();
		expect(backupReminder({ ...state, changedAt: ago(2) }, NOW)).toEqual({
			kind: 'since',
			days: 9,
		});
		expect(
			backupReminder({ ...state, exportedAt: ago(3), changedAt: ago(1) }, NOW)
		).toBeUndefined();
	});

	it('keeps quiet while put off', () => {
		const state = { since: ago(60), changedAt: ago(1) };
		expect(backupReminder({ ...state, snoozedUntil: NOW + 1 }, NOW)).toBeUndefined();
		expect(backupReminder({ ...state, snoozedUntil: NOW }, NOW)).toEqual({ kind: 'never' });
	});

	it('keeps quiet while the library syncs', () => {
		expect(
			backupReminder({ since: ago(60), changedAt: ago(1), synced: true }, NOW)
		).toBeUndefined();
	});
});

describe('the backup store', () => {
	let db: MemoriamDatabase;

	beforeEach(() => {
		db = createDatabase(`backup-${crypto.randomUUID()}`);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await db.delete();
	});

	const row = (path: string, createdAt: number, updatedAt: number) =>
		rowFor({
			connectionId: 'local',
			id: path,
			path,
			source: 'Jesus wept.\n',
			createdAt,
			updatedAt,
		});

	it('dates the library by its passages, and its changes by every file', async () => {
		expect(await backupState(db)).toEqual({});
		await db.notes.bulkPut([
			row('a.md', ago(30), ago(20)),
			row('b.md', ago(10), ago(10)),
			row('.memoriam/activity-2026.md', ago(40), ago(1)),
		]);
		expect(await backupState(db)).toEqual({ since: ago(30), changedAt: ago(1) });
		await bindLibrary(db, { connectionId: 'c1', provider: 'dropbox' });
		expect(await backupState(db)).toMatchObject({ synced: true });
	});

	it('notes an export, which ends any putting off', async () => {
		vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
		await db.notes.put(row('a.md', ago(30), ago(20)));
		await snoozeBackup(db, new Date(NOW));
		expect(Number(await getPreference(db, SNOOZED_KEY))).toBe(NOW + 3 * DAY);

		await exportLibrary(db, new Date(NOW));
		expect(await getPreference(db, EXPORTED_KEY)).toBe(String(NOW));
		expect(await getPreference(db, SNOOZED_KEY)).toBeUndefined();
		expect(backupReminder(await backupState(db), NOW + 30 * DAY)).toBeUndefined();
	});
});
