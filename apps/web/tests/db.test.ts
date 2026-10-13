import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, LOCAL_CONNECTION_ID, type MemoriamDatabase } from '../src/store/db.js';

const opened: Dexie[] = [];

afterEach(async () => {
	await Promise.all(opened.splice(0).map((db) => db.delete()));
});

describe('the schema', () => {
	it('carries a library written by version 1 forward, every passage in it live', async () => {
		const name = `db-${crypto.randomUUID()}`;
		const before = new Dexie(name);
		before.version(1).stores({
			notes: '[connectionId+id], id, connectionId, path, [connectionId+path], dirty, updatedAt',
			folders: '[connectionId+path], connectionId, path',
			prefs: 'key',
		});
		await before.table('notes').add({
			id: 'p1',
			connectionId: LOCAL_CONNECTION_ID,
			path: 'psalm-23.md',
			source: '---\ntitle: Psalm 23\n---\n\nThe Lord is my shepherd.\n',
			title: 'Psalm 23',
			tags: [],
			dirty: 1,
			createdAt: 0,
			updatedAt: 0,
		});
		before.close();

		const db: MemoriamDatabase = createDatabase(name);
		opened.push(db);
		expect(await db.notes.get([LOCAL_CONNECTION_ID, 'p1'])).toMatchObject({
			title: 'Psalm 23',
			deletedLocally: 0,
		});
		expect(await db.notes.where('deletedLocally').equals(0).count()).toBe(1);
		expect(await db.opQueue.count()).toBe(0);
		expect(await db.syncState.count()).toBe(0);
	});
});
