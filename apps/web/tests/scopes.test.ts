import { describe, expect, it } from 'vitest';

import { connectionTables, libraryTables, writerTables } from '../src/store/scopes.js';
import { freshDatabase } from './support/db.js';

const names = (tables: readonly { name: string }[]): string[] =>
	tables.map((table) => table.name).sort();

describe('the scopes transactions share', () => {
	it('lets go of a connection with every table that holds its rows', async () => {
		// A table keyed or indexed by connection that the library is not let go
		// of a connection with would keep rows of a binding this device no
		// longer has. A table added later has to be added to `connectionTables`.
		const db = freshDatabase();
		await db.open();
		const byConnection = db.tables
			.filter(({ schema }) =>
				[schema.primKey, ...schema.indexes].some((index) =>
					[index.keyPath].flat().includes('connectionId')
				)
			)
			.map((table) => table.name);
		const scope = names(connectionTables(db));

		expect(byConnection.filter((name) => !scope.includes(name))).toEqual([]);
		// And the count of binds and unbinds, kept in the prefs.
		expect(scope).toContain('prefs');
	});

	it('widens each scope from the one before it', () => {
		const db = freshDatabase();

		expect(names(libraryTables(db))).toEqual(expect.arrayContaining(names(writerTables(db))));
		expect(names(connectionTables(db))).toEqual(
			expect.arrayContaining(names(libraryTables(db)))
		);
	});
});
