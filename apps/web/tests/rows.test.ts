import { describe, expect, it } from 'vitest';

import { rowsOf } from '../src/store/rows.js';
import { freshDatabase } from './support/db.js';

describe('rowsOf', () => {
	it("is one connection's rows, and none of another's", async () => {
		const db = freshDatabase();
		await db.folders.bulkPut([
			{ connectionId: 'c1', path: 'a', createdAt: 0 },
			{ connectionId: 'c1', path: 'b', createdAt: 0 },
			{ connectionId: 'c10', path: 'a', createdAt: 0 },
		]);

		const paths = (await rowsOf(db.folders, 'c1').toArray()).map((row) => row.path);

		expect(paths.sort()).toEqual(['a', 'b']);
		expect(await rowsOf(db.folders, 'c2').count()).toBe(0);
	});
});
