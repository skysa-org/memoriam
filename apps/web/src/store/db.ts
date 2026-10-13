import { type ProviderKind } from '@memoriam/core';
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
 * The library's rows, every one of them. skysa-notes keys a row by the source
 * it came from, and moves the rows into a source when one is connected; here
 * there is one library, which a connection binds rather than takes in (§10,
 * "The web store"), so the rows stay under this id whether it syncs or not.
 */
export const LOCAL_CONNECTION_ID = 'local';

export interface NoteRecord {
	/** Stable across renames and moves, and written into the frontmatter. */
	id: string;
	connectionId: string;
	/** Path within the library, `.md` included: `psalms/psalm-23.md`. */
	path: string;
	/** The file's whole text, byte for byte: the one source of truth. */
	source: string;
	/** Read from `source` whenever it is written, so a list need not parse every file. */
	title: string;
	/** The frontmatter's `source`: where the words are from. Read as `title` is. */
	reference?: string;
	tags: string[];
	/** Provider file id. Absent until the passage has been sent, and once cut loose. */
	remoteId?: string;
	/** Opaque provider version: etag, rev, cTag, headRevisionId. Compare only. */
	remoteVersion?: string;
	/**
	 * `contentHash` of the file as this row and its remote file last agreed on
	 * it, pulled or sent. Only the sync store writes it (`SyncNote.syncedHash`).
	 */
	syncedHash?: string;
	/** Set on every write the user made: what the remote is owed. */
	dirty: Flag;
	/**
	 * A tombstone: deleted here while the library is connected, and kept until
	 * the delete has been sent, since the row carries the `remoteId` the delete
	 * needs. Every reader but sync passes over one (`isLive`).
	 */
	deletedLocally: Flag;
	createdAt: number;
	/** When the words or details were last edited. Practice never moves it. */
	updatedAt: number;
}

/** A row anything but sync should see. */
export const isLive = (note: Pick<NoteRecord, 'deletedLocally'>): boolean =>
	note.deletedLocally === 0;

/** A collection: a folder in the library, kept even while it holds nothing. */
export interface FolderRecord {
	connectionId: string;
	path: string;
	/** The provider's id for its directory, once it has one. */
	remoteId?: string;
	createdAt: number;
}

/**
 * The connection the library is bound to, if any: at most one row, keyed by
 * the id `apps/api` gave the connection. skysa-notes' `SyncStateRecord`, less
 * what several sources at once need: a label, a detached state, an import
 * that can be cancelled, a resume to verify.
 */
export interface SyncStateRecord {
	connectionId: string;
	provider?: ProviderKind;
	/** The provider's id for the account, once the API has named it. */
	accountId?: string;
	/** What the server calls the account, as it last said it: a label and nothing else. */
	displayName?: string;
	/** Opaque provider cursor; persisted only after a batch commits. */
	cursor?: string;
	rootId?: string;
	lastSyncAt?: number;
	/** Random per browser install, reported in the marker file for debugging. */
	clientId: string;
	/**
	 * The access token `apps/api` last minted, so a reload needs no round trip.
	 * Short-lived; never a refresh token, which never leaves the server.
	 */
	accessToken?: string;
	/** Epoch milliseconds. */
	accessTokenExpiresAt?: number;
	/** When the library was bound to it. */
	boundAt: number;
	/** The files in the library that are not UTF-8 text, which sync leaves alone. */
	unreadable?: { remoteId: string; path: string; movedAside?: string[] }[];
}

export type QueuedOperation =
	'write' | 'move' | 'delete' | 'mkdir' | 'rmdir' | 'upload' | 'move-file' | 'delete-file';

/** What the remote is owed, in order (`store/queue.ts`). */
export interface OpQueueRecord {
	seq?: number;
	connectionId: string;
	op: QueuedOperation;
	noteId?: string;
	fileId?: string;
	path: string;
	targetPath?: string;
	remoteId?: string;
	copyOf?: string;
	attempts: number;
	lastError?: string;
	queuedAt: number;
	/**
	 * A write practice made: sent with the next sync rather than straight after
	 * (§10, "Push timing"). Set on writes only.
	 */
	lazy?: true;
}

/**
 * A file in the library that is not a passage: a picture, a PDF, anything the
 * user keeps beside them. Nothing here shows one or makes one; sync keeps a
 * row for each the remote has, so that renaming a collection takes them with
 * it (§10, "Files, kept dormant").
 */
export interface FileRecord {
	connectionId: string;
	id: string;
	path: string;
	remoteId?: string;
	remoteVersion?: string;
	/** In bytes. */
	size: number;
}

/** A file's bytes, where this device holds them; as skysa-notes keeps them. */
export interface FileBytesRecord {
	connectionId: string;
	id: string;
	bytes: ArrayBuffer;
	/** The remote version these bytes are, for cached ones. */
	version?: string;
	/** 1 while the bytes exist nowhere else. */
	pinned: Flag;
	lastUsedAt: number;
}

/**
 * The credential that proves this device's right to a connection
 * (`store/credentials.ts`), keyed by the connection it reaches, or by
 * `PENDING_CREDENTIAL_ID` while a connect is on its way to the provider.
 */
export interface CredentialRecord {
	id: string;
	/** `sk1_…`. Never logged, put in a URL, or shown. */
	credential: string;
	provider: ProviderKind;
	createdAt: number;
}

/** The id a credential is kept under until the server says which connection it reaches. */
export const PENDING_CREDENTIAL_ID = 'pending';

export interface PreferenceRecord {
	key: string;
	value: string;
}

export type MemoriamDatabase = Dexie & {
	notes: Table<NoteRecord, [string, string]>;
	folders: Table<FolderRecord, [string, string]>;
	prefs: Table<PreferenceRecord, string>;
	syncState: Table<SyncStateRecord, string>;
	opQueue: Table<OpQueueRecord, number>;
	files: Table<FileRecord, [string, string]>;
	fileBytes: Table<FileBytesRecord, [string, string]>;
	credentials: Table<CredentialRecord, string>;
};

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

	// `[connectionId+path]` is not declared unique, as skysa-notes' is not: a
	// tombstone keeps its path until its delete has been sent, and a new
	// passage may be made there meanwhile. Writers keep live paths apart
	// (`store/passages.ts`).
	db.version(1).stores({
		notes: '[connectionId+id], id, connectionId, path, [connectionId+path], dirty, updatedAt',
		folders: '[connectionId+path], connectionId, path',
		prefs: 'key',
	});

	// Sync (§10): what the remote is owed, the connection it is owed to, and
	// the files beside the passages. A row from version 1 is live: nothing
	// could delete one but outright.
	db.version(2)
		.stores({
			notes: '[connectionId+id], id, connectionId, path, [connectionId+path], dirty, deletedLocally, updatedAt, remoteId',
			syncState: 'connectionId',
			opQueue: '++seq, connectionId, noteId, path, fileId',
			files: '[connectionId+id], connectionId, [connectionId+path], [connectionId+remoteId]',
			fileBytes: '[connectionId+id], connectionId, [pinned+lastUsedAt]',
		})
		.upgrade(async (tx) => {
			const rows = (await tx.table('notes').toArray()) as Omit<
				NoteRecord,
				'deletedLocally'
			>[];
			await tx.table('notes').bulkPut(rows.map((row) => ({ ...row, deletedLocally: 0 })));
		});

	// Connecting (§10, "The sync client"): the credential each connection is
	// reached with. IndexedDB, never localStorage (CLAUDE.md).
	db.version(3).stores({ credentials: 'id' });

	// A build with a later version, opening this database in another tab, must
	// find this tab stopped rather than still writing (`store/staleTab.ts`).
	watchForNewerTab(db);
	// And a frozen tab must not hold reads open that every other tab then waits
	// behind (`store/frozenTab.ts`).
	letGoWhenFrozen(db);

	return db;
};

export const db = createDatabase();
