import type { NoteRecord } from './db.js';

/**
 * What state a row is in, asked by name rather than by its flag. A passage
 * deleted on this device while the library is connected stays as a row until
 * the delete is sent: a tombstone, which nothing but the sync and an undo
 * should treat as a passage.
 */

/** A row anything but sync should see. `undefined`, which is no row, is not. */
export const isLive = (note: Pick<NoteRecord, 'deletedLocally'> | undefined): boolean =>
	note?.deletedLocally === 0;

/** A row deleted on this device, kept until the delete is sent. `undefined` is not one. */
export const isTombstone = (note: Pick<NoteRecord, 'deletedLocally'> | undefined): boolean =>
	note?.deletedLocally === 1;
