import {
	basename,
	conflictContent,
	foldName,
	isHidden,
	joinPath,
	mergePassage,
	parentPath,
	replaceBasename,
	uniqueFilename,
} from '@memoriam/core';
import { useLiveQuery } from 'dexie-react-hooks';

import {
	db as appDatabase,
	isLive,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
	writerTables,
} from './db.js';
import {
	buryOrDrop,
	type Edited,
	passageText,
	restorePassages,
	rowFor,
	updatePassage,
} from './passages.js';
import { queueMove, queueWrite } from './queue.js';

/**
 * Passages changed in two places at once (docs/ARCHITECTURE.md §10,
 * "Conflicts"). Sync merges what it can — the progress of two devices that
 * practised the same words — and keeps both versions of anything else: the
 * remote's at the passage's path, and this device's beside it as a copy named
 * `name (conflict 2026-10-13T14-32).md` (`conflictPath` in core). Nothing is
 * lost, and nothing is decided for the user. These are the ways to decide.
 *
 * A copy is found by its name alone, so it is found on every device the copy
 * reaches, however long ago the sync that made it.
 */

/** ` (conflict 2026-10-13T14-32)`, with `-2` for a second in the minute, before `.md`. */
const CONFLICT_SUFFIX = / \(conflict \d{4}-\d{2}-\d{2}T\d{2}-\d{2}\)(?:-\d+)?(?=\.md$)/u;

/** The stamp alone, in UTC as `conflictStamp` in core writes it. */
const STAMP = / \(conflict (\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})\)(?:-\d+)?\.md$/u;

/** When sync made a copy, to the minute, from its name. */
export const copiedAt = (path: string): number | undefined => {
	const [, day, hour, minute] = STAMP.exec(basename(path)) ?? [];
	if (day === undefined || hour === undefined || minute === undefined) return undefined;
	const at = Date.parse(`${day}T${hour}:${minute}:00Z`);
	return Number.isNaN(at) ? undefined : at;
};

export const isConflictCopy = (path: string): boolean =>
	!isHidden(path) && CONFLICT_SUFFIX.test(basename(path));

/**
 * Where the passage a copy was made from is: its name without the stamp. A
 * name cut short to fit the stamp in (`conflictName` in core) leads nowhere,
 * and its copy has no original to be shown beside.
 */
export const originalPathOf = (path: string): string =>
	replaceBasename(path, basename(path).replace(CONFLICT_SUFFIX, ''));

export interface Conflict {
	readonly copy: NoteRecord;
	/** The passage at the copy's original path, if there still is one. */
	readonly original: NoteRecord | undefined;
}

/** The conflict copies among `notes`, each with its original, in the order of their paths. */
export const conflictsIn = (notes: readonly NoteRecord[]): Conflict[] => {
	const live = notes.filter(isLive);
	const originals = new Map(
		live.filter((note) => !isConflictCopy(note.path)).map((note) => [foldName(note.path), note])
	);
	return live
		.filter((note) => isConflictCopy(note.path))
		.sort((a, b) => a.path.localeCompare(b.path))
		.map((copy) => ({ copy, original: originals.get(foldName(originalPathOf(copy.path))) }));
};

/** A version's lines, each marked where the other version has no such line. */
export const linesAgainst = (
	text: string,
	other: string
): readonly Readonly<{ line: string; differs: boolean }>[] => {
	const theirs = new Set(other.split('\n').map((line) => line.trimEnd()));
	return text
		.replace(/\n$/u, '')
		.split('\n')
		.map((line) => ({ line, differs: !theirs.has(line.trimEnd()) }));
};

/** The library's conflicts, live; `undefined` while they are read. */
export const useConflicts = (database: MemoriamDatabase = appDatabase): Conflict[] | undefined =>
	useLiveQuery(
		async () =>
			conflictsIn(
				await database.notes.where('connectionId').equals(LOCAL_CONNECTION_ID).toArray()
			),
		[database]
	);

/** What a choice came to, and how to take it back. */
export type Resolved =
	Readonly<{ ok: true; undo: () => Promise<void> }> | Readonly<{ ok: false; reason: 'missing' }>;

interface Pair {
	readonly copyId: string;
	readonly originalId: string;
}

/** Both rows of a pair, live, or nothing: either may have gone in another tab. */
const bothOf = async (
	db: MemoriamDatabase,
	{ copyId, originalId }: Pair
): Promise<{ copy: NoteRecord; original: NoteRecord } | undefined> => {
	const [copy, original] = await db.notes.bulkGet([
		[LOCAL_CONNECTION_ID, copyId],
		[LOCAL_CONNECTION_ID, originalId],
	]);
	if (copy === undefined || original === undefined) return undefined;
	return isLive(copy) && isLive(original) ? { copy, original } : undefined;
};

/** `row` with its file now `source`, queued for the remote; the source written. */
const rewrite = async (
	db: MemoriamDatabase,
	row: NoteRecord,
	source: string,
	updatedAt: number
): Promise<string> => {
	if (source === row.source) return source;
	const next = rowFor({ ...row, source, updatedAt }, row);
	await db.notes.put(next);
	await queueWrite(db, next);
	return source;
};

/**
 * Put a pair back as it was before a choice: the copy brought back from its
 * delete, and the original's file as it was — unless the original has changed
 * since the choice wrote it (`written`), practised or pulled. That change is
 * kept, and with the copy back, so is every version there was.
 */
const putPairBack =
	(db: MemoriamDatabase, original: NoteRecord, copy: NoteRecord, written: string) =>
	async (): Promise<void> => {
		await db.transaction('rw', writerTables(db), async () => {
			const now = await db.notes.get([original.connectionId, original.id]);
			if (now !== undefined && isLive(now) && now.source === written) {
				await rewrite(db, now, original.source, original.updatedAt);
			}
		});
		await restorePassages(db, [copy]);
	};

/**
 * Keep the copy's version: its words and details take the original's place,
 * at the original's path and under its id, and the copy goes. Where the two
 * versions have the same words, the progress of both is kept (`mergePassage`).
 */
export const keepCopy = (
	db: MemoriamDatabase,
	pair: Pair,
	now: number = Date.now()
): Promise<Resolved> =>
	db.transaction('rw', writerTables(db), async () => {
		const both = await bothOf(db, pair);
		if (both === undefined) return { ok: false, reason: 'missing' } as const;
		const { copy, original } = both;
		// The copy's file as the original's: the same text, with the original's id.
		const taking = conflictContent(copy.source, original.id);
		const merged = mergePassage(taking, original.source);
		const written = await rewrite(
			db,
			original,
			merged.kind === 'merged' ? merged.text : taking,
			now
		);
		await buryOrDrop(db, [copy]);
		return { ok: true, undo: putPairBack(db, original, copy, written) } as const;
	});

/**
 * Keep the original's version, and let the copy go. Where the two versions
 * have the same words, the copy's progress is kept in the original.
 */
export const keepOriginal = (db: MemoriamDatabase, pair: Pair): Promise<Resolved> =>
	db.transaction('rw', writerTables(db), async () => {
		const both = await bothOf(db, pair);
		if (both === undefined) return { ok: false, reason: 'missing' } as const;
		const { copy, original } = both;
		// Compared under one id: the copy's own is the one thing it must differ in.
		const merged = mergePassage(original.source, conflictContent(copy.source, original.id));
		// Practice is not an edit: `updatedAt` stays.
		const written =
			merged.kind === 'merged'
				? await rewrite(db, original, merged.text, original.updatedAt)
				: original.source;
		await buryOrDrop(db, [copy]);
		return { ok: true, undo: putPairBack(db, original, copy, written) } as const;
	});

/**
 * Keep both, as two passages: the copy is given a title of its own, which
 * moves it to a name of its own and out of the conflicts. Nothing is lost, so
 * there is nothing to take back.
 */
export const keepBoth = (
	db: MemoriamDatabase,
	copyId: string,
	title: string,
	now: number = Date.now()
): Promise<Edited> =>
	db.transaction('rw', writerTables(db), async () => {
		const copy = await db.notes.get([LOCAL_CONNECTION_ID, copyId]);
		if (copy === undefined || !isLive(copy)) return { ok: false, reason: 'missing' } as const;
		return updatePassage(
			db,
			copyId,
			{
				title,
				reference: copy.reference ?? '',
				collection: parentPath(copy.path),
				text: passageText(copy.source),
			},
			{},
			now
		);
	});

/**
 * Keep a copy whose original is gone: it takes the original's name, or, where
 * another passage has that name now, one from its title. It is a move, and
 * nothing else about it changes.
 */
export const keepOrphan = (db: MemoriamDatabase, copyId: string): Promise<Edited> =>
	db.transaction('rw', writerTables(db), async () => {
		const copy = await db.notes.get([LOCAL_CONNECTION_ID, copyId]);
		if (copy === undefined || !isLive(copy)) return { ok: false, reason: 'missing' } as const;
		const folder = parentPath(copy.path);
		const taken = (await db.notes.where('connectionId').equals(LOCAL_CONNECTION_ID).toArray())
			.filter(
				(row) =>
					isLive(row) &&
					row.id !== copyId &&
					foldName(parentPath(row.path)) === foldName(folder)
			)
			.map((row) => basename(row.path));
		const wanted = basename(originalPathOf(copy.path));
		const free = !taken.some((name) => foldName(name) === foldName(wanted));
		// A move and no write, so as dirty as it was (`updatePassage`).
		const next = {
			...copy,
			path: joinPath(folder, free ? wanted : uniqueFilename(copy.title, taken)),
		};
		await db.notes.put(next);
		await queueMove(db, next, copy.path);
		return { ok: true, passage: next } as const;
	});
