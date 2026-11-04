import type { MemoriamDatabase } from './db.js';

/**
 * The tables every writer of the library changes together: a row, the op that
 * sends it, and the binding that says whether one is owed (`store/queue.ts`).
 */
export const writerTables = (db: MemoriamDatabase) => [
	db.notes,
	db.folders,
	db.opQueue,
	db.syncState,
	db.files,
];
