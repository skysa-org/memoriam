import type { NoteRecord } from './db.js';

/** A row anything but sync should see. */
export const isLive = (note: Pick<NoteRecord, 'deletedLocally'>): boolean =>
	note.deletedLocally === 0;
