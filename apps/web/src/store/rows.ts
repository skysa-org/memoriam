import type { Collection, Table } from 'dexie';

/**
 * A connection's rows in `table`: every table that holds rows for a connection
 * has a `connectionId` index, and almost every read of one asks this. A query
 * like any other, so a live query that asks it observes what it did before.
 */
export const rowsOf = <T, K>(table: Table<T, K>, connectionId: string): Collection<T, K> =>
	table.where('connectionId').equals(connectionId);
