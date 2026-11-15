import type { Table } from 'dexie';

import type { MemoriamDatabase } from './db.js';

/**
 * The tables a transaction opens, for the transactions that open many. A
 * writer that asks for a table its caller's transaction did not open fails
 * there with a `SubTransactionError`, so the ones that nest share a list
 * rather than each spelling theirs. A wider scope than the work needs holds
 * more of the database from other tabs and other work for longer, so these
 * are as wide as they were, and a transaction with less to do still names
 * its own.
 */

/**
 * Typed as plain tables: a transaction asks no more of them, and an inferred
 * list would make every record type in it part of this module's exports.
 */
type Tables = Table[];

/**
 * The tables every writer of the library changes together: a row, the op that
 * sends it, and the binding that says whether one is owed (`store/queue.ts`).
 */
export const writerTables = (db: MemoriamDatabase): Tables => [
	db.notes,
	db.folders,
	db.opQueue,
	db.syncState,
	db.files,
];

/** The writers' tables, and the bytes sync keeps of the files beside the passages. */
export const libraryTables = (db: MemoriamDatabase): Tables => [...writerTables(db), db.fileBytes];

/**
 * Everything the library holds for a connection on this device: what it is let
 * go of the connection with. The prefs too, for the count of binds and unbinds
 * a decision made from a server's answer checks (`unbindLibrary`).
 */
export const connectionTables = (db: MemoriamDatabase): Tables => [...libraryTables(db), db.prefs];
