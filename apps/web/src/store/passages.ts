import {
	basename,
	conflictContent,
	CURRENT_CHUNKER,
	editedProgress,
	foldName,
	frontmatterIsEditable,
	joinPath,
	mergePassage,
	parentPath,
	type ParsedPassageFile,
	parsePassageFile,
	sameApartFromProgress,
	serializePassageFile,
	splitFrontmatter,
	toLf,
	uniqueFilename,
	UNTITLED_TITLE,
} from '@memoriam/core';

import { ensureCollections } from './collections.js';
import {
	isLive,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
	writerTables,
} from './db.js';
import { isBound, queueDelete, queueMove, queueRestore, queueWrite } from './queue.js';

/**
 * Passages: adding one, editing its words and details, deleting it and taking
 * that back (docs/ARCHITECTURE.md §3, §7).
 *
 * A row is its file. Every writer here builds the file's new text and writes
 * the row from it, reading the title and source back out of what it wrote, so
 * nothing a list shows can say other than the file does. And every writer is
 * one transaction, since a name is chosen from the names already taken: read
 * and claimed apart, a second click can choose the same one, and two rows at
 * one path are one file to a provider. The op that sends a change to the
 * remote is queued in the same transaction (`store/queue.ts`).
 *
 * A passage deleted while the library is connected stays as a tombstone until
 * the delete has been sent (`NoteRecord.deletedLocally`). Its name is free at
 * once, and nothing here will edit one.
 */

export interface PassageScope {
	connectionId?: string;
}

/** What the editor gives: a passage's words and the details around them. */
export interface PassageDetails {
	/** Empty for one taken from the words (`titleFromText`). */
	readonly title: string;
	/** Where the words are from; empty for nowhere said. */
	readonly reference: string;
	/** The collection's path; `ROOT` for none. */
	readonly collection: string;
	readonly text: string;
}

/** The blank lines a body opens with, which part it from the frontmatter. */
const LEADING_BLANK = /^(?:[ \t]*(?:\r\n|\n|\r))*/;

/** A passage's words as the editor shows them: the body, from its first line. */
export const passageText = (source: string): string =>
	toLf(splitFrontmatter(source).body).replace(LEADING_BLANK, '');

/**
 * The words as they are kept: `\n` line endings, from the first line that is
 * not blank to the last, and one line ending after that.
 */
export const keptText = (text: string): string =>
	`${toLf(text).replace(LEADING_BLANK, '').trimEnd()}\n`;

/** As many words as a title needs: a list can show this many, and a filename hold them. */
const TITLE_WORDS = 6;

/**
 * A title from a passage's words, for one given none: its first line that is
 * not a section's label, as far as its sixth word, without the punctuation it
 * ends on. Empty when there is no such line.
 */
export const titleFromText = (text: string): string => {
	const line = toLf(text)
		.split('\n')
		.map((each) => each.trim())
		.find((each) => each !== '' && !each.startsWith('#'));
	if (line === undefined) return '';
	return line
		.split(/\s+/)
		.slice(0, TITLE_WORDS)
		.join(' ')
		.replace(/[\p{P}\s]+$/u, '');
};

const chosenTitle = (details: PassageDetails): string =>
	details.title.trim() || titleFromText(details.text) || UNTITLED_TITLE;

/**
 * What a row knows of the remote file it is bound to, which a new text for the
 * row leaves as it was: sync is what changes it (`sync/store.ts`).
 */
const bindingOf = (row: NoteRecord | undefined) => ({
	...(row?.remoteId === undefined ? {} : { remoteId: row.remoteId }),
	...(row?.remoteVersion === undefined ? {} : { remoteVersion: row.remoteVersion }),
	...(row?.syncedHash === undefined ? {} : { syncedHash: row.syncedHash }),
	deletedLocally: row?.deletedLocally ?? 0,
});

/**
 * The row for a file, with what a list shows read out of it: an edit the user
 * made, so dirty. `replacing` is the row it takes the place of, whose binding
 * to the remote carries over.
 */
export const rowFor = (
	{
		id,
		connectionId,
		path,
		source,
		createdAt,
		updatedAt,
	}: Pick<NoteRecord, 'id' | 'connectionId' | 'path' | 'source' | 'createdAt' | 'updatedAt'>,
	replacing?: NoteRecord
): NoteRecord => {
	// Named one by one rather than spread: handed a whole row, a spread would
	// keep a source the file no longer has.
	const parsed = parsePassageFile(source, { filename: basename(path) });
	return {
		id,
		connectionId,
		path,
		source,
		createdAt,
		updatedAt,
		title: parsed.title,
		...(parsed.source === undefined ? {} : { reference: parsed.source }),
		tags: parsed.tags,
		...bindingOf(replacing),
		dirty: 1,
	};
};

/**
 * When a file sync brought in was last edited, as far as anyone here can say
 * (skysa-notes' `editedAt`, and §10's rule for practice). New here, it is what
 * the file says, or now. Read again, it only moves forward, and practice never
 * moves it: a file that changed only its progress keeps the row's time. The
 * file's own time where that is later than the row's; otherwise now, for a file
 * another tool changed and kept the old date of.
 */
const editedAt = (
	parsed: Readonly<{ updatedAt?: number }>,
	existing: NoteRecord | undefined,
	source: string,
	now: number
): number => {
	if (existing === undefined) return parsed.updatedAt ?? now;
	if (sameApartFromProgress(existing.source, source)) return existing.updatedAt;
	if (parsed.updatedAt !== undefined && parsed.updatedAt > existing.updatedAt) {
		return parsed.updatedAt;
	}
	return now;
};

/**
 * The row for a file sync brought in, clean, and still a tombstone if
 * `existing` was one: a delete here outranks a change there. The caller binds
 * it to the remote file it came from.
 */
export const pulledRow = ({
	id,
	connectionId,
	path,
	source,
	existing,
	now,
	parsed = parsePassageFile(source, { filename: basename(path) }),
}: Readonly<{
	id: string;
	connectionId: string;
	path: string;
	source: string;
	existing: NoteRecord | undefined;
	now: number;
	/** The file already read, by a caller that read it before its transaction. */
	parsed?: ParsedPassageFile;
}>): NoteRecord => ({
	id,
	connectionId,
	path,
	source,
	title: parsed.title,
	...(parsed.source === undefined ? {} : { reference: parsed.source }),
	tags: parsed.tags,
	createdAt: parsed.createdAt ?? existing?.createdAt ?? now,
	updatedAt: editedAt(parsed, existing, source, now),
	dirty: 0,
	deletedLocally: existing?.deletedLocally ?? 0,
});

/** The names taken in a folder: by every live row there but `except`. */
const namesIn = (rows: readonly NoteRecord[], folder: string, except?: string): string[] =>
	rows
		.filter(
			(row) =>
				row.id !== except &&
				isLive(row) &&
				foldName(parentPath(row.path)) === foldName(folder)
		)
		.map((row) => basename(row.path));

const rowsOf = (db: MemoriamDatabase, connectionId: string): Promise<NoteRecord[]> =>
	db.notes.where('connectionId').equals(connectionId).toArray();

/** Add a passage. */
export const createPassage = (
	db: MemoriamDatabase,
	details: PassageDetails,
	{ connectionId = LOCAL_CONNECTION_ID }: PassageScope = {},
	now: number = Date.now()
): Promise<NoteRecord> =>
	db.transaction('rw', writerTables(db), async () => {
		const id = crypto.randomUUID();
		const title = chosenTitle(details);
		const reference = details.reference.trim();
		const stamp = new Date(now).toISOString();
		const taken = namesIn(await rowsOf(db, connectionId), details.collection);
		const row = rowFor({
			id,
			connectionId,
			path: joinPath(details.collection, uniqueFilename(title, taken)),
			source: serializePassageFile({
				frontmatter: null,
				body: keptText(details.text),
				metadata: {
					id,
					title,
					...(reference === '' ? {} : { source: reference }),
					created: stamp,
					updated: stamp,
					chunker: CURRENT_CHUNKER,
				},
			}),
			createdAt: now,
			updatedAt: now,
		});
		await ensureCollections(db, [details.collection], connectionId, now);
		await db.notes.add(row);
		await queueWrite(db, row);
		return row;
	});

/** What editing a passage came to. */
export type Edited =
	| Readonly<{ ok: true; passage: NoteRecord }>
	/** No passage by that id: deleted, maybe in another tab. */
	| Readonly<{ ok: false; reason: 'missing' }>
	/**
	 * Its frontmatter is YAML the parser had to repair, which the app never
	 * rewrites, or YAML the writer will not take apart (an anchor on a key it
	 * would change): a change to its details or its progress would not reach
	 * the file.
	 */
	| Readonly<{ ok: false; reason: 'unreadable' }>;

/** An edit to a passage's file. */
interface Edit {
	readonly title: string;
	/** Empty for none. */
	readonly reference: string;
	/** The new words, as they are kept (`keptText`); none for the same words. */
	readonly text?: string;
	/** When, for an edit to the words or details; none for a move alone. */
	readonly at?: number;
}

/**
 * A passage's file with an edit made, or `undefined` where the edit would not
 * reach it whole: frontmatter the app never rewrites, or a block the writer
 * hands back as it came (an anchor on a key it would change). New words under
 * the old progress would leave that progress keyed to words the passage no
 * longer has, so the edit is refused rather than half made.
 */
const editedSource = (
	row: NoteRecord,
	{ title, reference, text, at }: Edit
): string | undefined => {
	const { frontmatter, body } = splitFrontmatter(row.source);
	if (!frontmatterIsEditable(frontmatter)) return undefined;
	const parsed = parsePassageFile(row.source);
	const progress =
		text === undefined
			? ({ changed: false } as const)
			: editedProgress(body, text, parsed.chunker ?? CURRENT_CHUNKER, parsed.progress);
	// The blank line under the block is kept, as `\n`: the words are, and a
	// line ending of another kind ahead of them would leave the file in two.
	const lead = LEADING_BLANK.exec(body)?.[0] === '' ? '' : '\n';
	const source = serializePassageFile({
		frontmatter,
		body: text === undefined ? body : `${lead}${text}`,
		metadata: {
			// A file another tool wrote gains what one the app wrote has:
			// none of these is written over a value the file already has.
			id: row.id,
			created: new Date(row.createdAt).toISOString(),
			...(parsed.chunker === undefined ? { chunker: CURRENT_CHUNKER } : {}),
			title,
			source: reference === '' ? undefined : reference,
			...(at === undefined ? {} : { updated: new Date(at).toISOString() }),
			...(progress.changed ? { progress: progress.block } : {}),
		},
	});
	const back = parsePassageFile(source);
	const whole =
		back.title === title &&
		(back.source ?? '') === reference &&
		(!progress.changed || JSON.stringify(back.progress) === JSON.stringify(progress.block));
	return whole ? source : undefined;
};

/**
 * Change a passage's words or details. What did not change is not written:
 * the same words and details give back the row as it was, `updated` and all.
 *
 * A new title, or another collection, moves the file: its name is the title's
 * slug, as a new passage's is.
 *
 * New words carry the passage's progress with them, in the same write
 * (`editedProgress`): a chunk whose words mostly survived keeps what was learnt
 * of it, under its new key.
 */
export const updatePassage = (
	db: MemoriamDatabase,
	id: string,
	details: PassageDetails,
	{ connectionId = LOCAL_CONNECTION_ID }: PassageScope = {},
	now: number = Date.now()
): Promise<Edited> =>
	db.transaction('rw', writerTables(db), async () => {
		const row = await db.notes.get([connectionId, id]);
		if (row === undefined || !isLive(row)) return { ok: false, reason: 'missing' } as const;

		const title = chosenTitle(details);
		const reference = details.reference.trim();
		const text = keptText(details.text);
		const retitled = title !== row.title;
		const worded = text !== keptText(passageText(row.source));
		const detailed = retitled || reference !== (row.reference ?? '');
		const moved = retitled || foldName(details.collection) !== foldName(parentPath(row.path));
		if (!worded && !detailed && !moved) return { ok: true, passage: row } as const;

		const edited = worded || detailed;
		const source = editedSource(row, {
			title,
			reference,
			...(worded ? { text } : {}),
			...(edited ? { at: now } : {}),
		});
		if (source === undefined) return { ok: false, reason: 'unreadable' } as const;

		const taken = namesIn(await rowsOf(db, connectionId), details.collection, id);
		const name = basename(row.path);
		const keepsName = !retitled && !taken.some((each) => foldName(each) === foldName(name));
		const next = rowFor(
			{
				...row,
				path: moved
					? joinPath(details.collection, keepsName ? name : uniqueFilename(title, taken))
					: row.path,
				source,
				updatedAt: edited ? now : row.updatedAt,
			},
			row
		);
		await ensureCollections(db, [details.collection], connectionId, now);
		await db.notes.put(next);
		if (next.path !== row.path) await queueMove(db, next, row.path);
		if (next.source !== row.source) await queueWrite(db, next);
		return { ok: true, passage: next } as const;
	});

/**
 * Delete a passage. What it gives back is what `restorePassages` puts back.
 * Connected, it is a tombstone, owed its delete; otherwise there is nobody to
 * tell, and the row goes.
 */
export const deletePassage = (
	db: MemoriamDatabase,
	id: string,
	{ connectionId = LOCAL_CONNECTION_ID }: PassageScope = {}
): Promise<NoteRecord | undefined> =>
	db.transaction('rw', writerTables(db), async () => {
		const row = await db.notes.get([connectionId, id]);
		if (row === undefined || !isLive(row)) return undefined;
		await buryOrDrop(db, [row]);
		return row;
	});

/**
 * Delete rows, as `deletePassage` does: tombstones owed their deletes while
 * the library is connected, and gone otherwise. For a writer already in a
 * transaction over `writerTables`.
 */
export const buryOrDrop = async (
	db: MemoriamDatabase,
	rows: readonly NoteRecord[]
): Promise<void> => {
	if (!(await isBound(db))) {
		await db.notes.bulkDelete(rows.map((row) => [row.connectionId, row.id]));
		return;
	}
	const buried = rows.map((row) => ({ ...row, deletedLocally: 1 as const, dirty: 1 as const }));
	await db.notes.bulkPut(buried);
	await buried.reduce<Promise<void>>(async (pending, row) => {
		await pending;
		await queueDelete(db, row);
	}, Promise.resolve());
};

/**
 * Where each of `rows` goes back to: the path it had, or, where a passage added
 * meanwhile has its name, the next free one in the same folder.
 */
const freePaths = (live: readonly NoteRecord[], rows: readonly NoteRecord[]): NoteRecord[] =>
	rows.reduce<NoteRecord[]>((placed, row) => {
		const folder = parentPath(row.path);
		const taken = namesIn([...live, ...placed], folder);
		const name = basename(row.path);
		const free = !taken.some((each) => foldName(each) === foldName(name));
		return [
			...placed,
			free ? row : { ...row, path: joinPath(folder, uniqueFilename(row.title, taken)) },
		];
	}, []);

/** Cut loose from the remote: a passage whose file is gone, made again. */
const unbound = ({
	remoteId: _remoteId,
	remoteVersion: _remoteVersion,
	syncedHash: _syncedHash,
	...row
}: NoteRecord): NoteRecord => row;

/**
 * What a passage is put back as, from its tombstone and the row as it was
 * deleted. Usually the two are one file. A pull can write into a tombstone,
 * though, since a tombstone owes the remote nothing but its delete: then the
 * progress of both is kept where the words agree, and otherwise the text that
 * was deleted comes back beside the remote's, as a copy of its own.
 */
const putBack = (
	tombstone: NoteRecord,
	deleted: NoteRecord
): Readonly<{ row: NoteRecord; copy?: NoteRecord }> => {
	const lifted = { ...tombstone, deletedLocally: 0 as const, dirty: 1 as const };
	const merged = mergePassage(tombstone.source, deleted.source);
	if (merged.kind === 'same') return { row: lifted };
	if (merged.kind === 'merged') {
		return { row: rowFor({ ...lifted, source: merged.text }, lifted) };
	}
	const id = crypto.randomUUID();
	return {
		row: lifted,
		copy: rowFor({ ...unbound(deleted), id, source: conflictContent(deleted.source, id) }),
	};
};

/**
 * Put deleted passages back, each with the file it had, all from one
 * connection as one delete took them. One that is somehow here already — put
 * back from another tab — is left as it is.
 *
 * A tombstone still here is lifted, which withdraws a delete not yet sent. One
 * whose file the remote still has keeps its path, for the reason the remote
 * keeps it in a conflict: the file is there. A passage made at that name
 * meanwhile moves aside to the next free one, as skysa-notes' undo moves it. A
 * row already gone is made again, cut loose from the file its delete removed,
 * at its old path or the next free one.
 */
export const restorePassages = (
	db: MemoriamDatabase,
	rows: readonly NoteRecord[],
	now: number = Date.now()
): Promise<void> =>
	db.transaction('rw', writerTables(db), async () => {
		const connectionId = rows[0]?.connectionId ?? LOCAL_CONNECTION_ID;
		const here = await db.notes.bulkGet(rows.map((row) => [row.connectionId, row.id]));
		const back = rows.flatMap((row, at) => {
			const current = here[at];
			if (current !== undefined && isLive(current)) return [];
			if (current === undefined) return [{ row: { ...unbound(row), dirty: 1 as const } }];
			return [putBack(current, row)];
		});
		const was = new Map(here.flatMap((row) => (row === undefined ? [] : [[row.id, row]])));
		const keeping = back
			.map((each) => each.row)
			.filter((row) => was.get(row.id)?.remoteId !== undefined);
		const held = new Set(keeping.map((row) => foldName(row.path)));
		const live = (await rowsOf(db, connectionId)).filter(isLive);
		const inTheWay = live.filter((row) => held.has(foldName(row.path)));
		const settled = live.filter((row) => !held.has(foldName(row.path)));
		const aside = freePaths([...settled, ...keeping], inTheWay);
		const placed = freePaths(
			[...settled, ...keeping, ...aside],
			[
				...back.map((each) => each.row).filter((row) => !keeping.includes(row)),
				...back.flatMap((each) => (each.copy === undefined ? [] : [each.copy])),
			]
		);
		await ensureCollections(
			db,
			[...keeping, ...placed].map((row) => parentPath(row.path)),
			connectionId,
			now
		);
		await db.notes.bulkPut([...aside, ...keeping, ...placed]);
		await aside.reduce<Promise<void>>(async (pending, row, at) => {
			await pending;
			await queueMove(db, row, inTheWay[at]?.path ?? row.path);
		}, Promise.resolve());
		await [...keeping, ...placed].reduce<Promise<void>>(async (pending, row) => {
			await pending;
			const tombstone = was.get(row.id);
			if (tombstone === undefined) {
				await queueWrite(db, row);
				return;
			}
			if (row.path !== tombstone.path) await queueMove(db, row, tombstone.path);
			await queueRestore(db, row);
		}, Promise.resolve());
	});
