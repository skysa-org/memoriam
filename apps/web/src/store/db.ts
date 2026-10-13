import Dexie, { type Table } from 'dexie';

import { letGoWhenFrozen } from './frozenTab.js';
import { watchForNewerTab } from './staleTab.js';

/**
 * The local store. The app boots and renders from here before any network
 * call, and every read and write works offline. See docs/ARCHITECTURE.md §7.
 *
 * Rows mirror skysa-notes' (`NoteRecord`, keyed `[connectionId+id]`) so that
 * sync can be ported onto them unchanged when it arrives (§10): a "note" here
 * is any markdown file in the library — a passage, or a year's activity.
 *
 * Until the first release, version 1 may still change. From then on a version
 * only adds, and what an older build wrote is carried forward by an upgrade.
 */

/**
 * IndexedDB cannot index a boolean, and sync will need to find dirty rows by
 * index rather than by scanning every one. 0/1 it is.
 */
export type Flag = 0 | 1;

/**
 * Until a storage account is connected, every row belongs to this stand-in
 * connection. The column exists from the start so attaching a real connection
 * is a data migration rather than a schema change.
 */
export const LOCAL_CONNECTION_ID = 'local';

export interface NoteRecord {
	/** Stable across renames and moves, and written into the frontmatter. */
	id: string;
	connectionId: string;
	/** Path within the library, `.md` included: `Psalms/Psalm 23.md`. */
	path: string;
	title: string;
	/** The file's whole text, byte for byte: the one source of truth. */
	source: string;
	/** Set on a write sync has not sent yet. */
	dirty: Flag;
	/** A delete sync has not sent yet: the row is gone from every list. */
	deletedLocally: Flag;
	/** Hash of `source`, for telling whether a write changed anything. */
	contentHash: string;
	/** What sync last saw of the remote, once there is one. */
	syncedHash?: string;
	remoteId?: string;
	remoteVersion?: string;
	createdAt: string;
	/** When the text was last edited. Practice never moves it. */
	updatedAt: string;
}

/** A collection: a folder in the library. */
export interface FolderRecord {
	connectionId: string;
	path: string;
	createdAt: string;
}

/** A write sync has yet to send, in the order it was made. */
export interface OpQueueRecord {
	seq?: number;
	connectionId: string;
	kind: 'write' | 'delete' | 'move' | 'createFolder' | 'deleteFolder';
	noteId?: string;
	path: string;
	toPath?: string;
	queuedAt: string;
}

export interface PreferenceRecord {
	key: string;
	value: string;
}

export type MemoriamDatabase = Dexie & {
	notes: Table<NoteRecord, [string, string]>;
	folders: Table<FolderRecord, [string, string]>;
	opQueue: Table<OpQueueRecord, number>;
	prefs: Table<PreferenceRecord, string>;
};

export const DATABASE_NAME = 'memoriam';

/** A note's primary key: the source it belongs to, then its id within it. */
export type NoteKey = [connectionId: string, id: string];

export const noteKey = (note: Pick<NoteRecord, 'connectionId' | 'id'>): NoteKey => [
	note.connectionId,
	note.id,
];

/**
 * Built without subclassing Dexie: the table properties are declared through
 * the cast instead, which keeps this module free of `this` and classes.
 */
export const createDatabase = (name: string = DATABASE_NAME): MemoriamDatabase => {
	const db = new Dexie(name) as MemoriamDatabase;

	// `[connectionId+path]` is not declared unique: a tombstone keeps its path
	// until its delete has been sent, so a passage made where a deleted one was
	// is two rows at one key, by design. Writers keep live paths apart.
	db.version(1).stores({
		notes: '[connectionId+id], id, connectionId, path, [connectionId+path], dirty, deletedLocally, updatedAt, remoteId',
		folders: '[connectionId+path], connectionId, path',
		opQueue: '++seq, connectionId, noteId, path',
		prefs: 'key',
	});

	// A build with a later version, opening this database in another tab, must
	// find this tab stopped rather than still writing (`store/staleTab.ts`).
	watchForNewerTab(db);
	// And a frozen tab must not hold reads open that every other tab then waits
	// behind (`store/frozenTab.ts`).
	letGoWhenFrozen(db);

	return db;
};

export const db = createDatabase();
