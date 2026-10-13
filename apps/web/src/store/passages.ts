import {
	basename,
	CURRENT_CHUNKER,
	foldName,
	frontmatterIsEditable,
	joinPath,
	parentPath,
	parsePassageFile,
	serializePassageFile,
	splitFrontmatter,
	toLf,
	uniqueFilename,
	UNTITLED_TITLE,
} from '@memoriam/core';

import { ensureCollections } from './collections.js';
import { LOCAL_CONNECTION_ID, type MemoriamDatabase, type NoteRecord } from './db.js';

/**
 * Passages: adding one, editing its words and details, deleting it and taking
 * that back (docs/ARCHITECTURE.md §3, §7).
 *
 * A row is its file. Every writer here builds the file's new text and writes
 * the row from it, reading the title and source back out of what it wrote, so
 * nothing a list shows can say other than the file does. And every writer is
 * one transaction, since a name is chosen from the names already taken: read
 * and claimed apart, a second click can choose the same one, and two rows at
 * one path are one file to a provider.
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

/** The row for a file, with what a list shows read out of it. */
const rowFor = ({
	id,
	connectionId,
	path,
	source,
	createdAt,
	updatedAt,
}: Pick<
	NoteRecord,
	'id' | 'connectionId' | 'path' | 'source' | 'createdAt' | 'updatedAt'
>): NoteRecord => {
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
		dirty: 1,
	};
};

/** The names taken in a folder: by every row there but `except`. */
const namesIn = (rows: readonly NoteRecord[], folder: string, except?: string): string[] =>
	rows
		.filter((row) => row.id !== except && foldName(parentPath(row.path)) === foldName(folder))
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
	db.transaction('rw', db.notes, db.folders, async () => {
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
		return row;
	});

/** What editing a passage came to. */
export type Edited =
	| Readonly<{ ok: true; passage: NoteRecord }>
	/** No passage by that id: deleted, maybe in another tab. */
	| Readonly<{ ok: false; reason: 'missing' }>
	/**
	 * Its frontmatter is YAML the parser had to repair, which the app never
	 * rewrites, so a change to its details would not reach the file.
	 */
	| Readonly<{ ok: false; reason: 'unreadable' }>;

/**
 * Change a passage's words or details. What did not change is not written:
 * the same words and details give back the row as it was, `updated` and all.
 *
 * A new title, or another collection, moves the file: its name is the title's
 * slug, as a new passage's is.
 */
export const updatePassage = (
	db: MemoriamDatabase,
	id: string,
	details: PassageDetails,
	{ connectionId = LOCAL_CONNECTION_ID }: PassageScope = {},
	now: number = Date.now()
): Promise<Edited> =>
	db.transaction('rw', db.notes, db.folders, async () => {
		const row = await db.notes.get([connectionId, id]);
		if (row === undefined) return { ok: false, reason: 'missing' } as const;

		const title = chosenTitle(details);
		const reference = details.reference.trim();
		const text = keptText(details.text);
		const retitled = title !== row.title;
		const worded = text !== keptText(passageText(row.source));
		const detailed = retitled || reference !== (row.reference ?? '');
		const moved = retitled || foldName(details.collection) !== foldName(parentPath(row.path));
		if (!worded && !detailed && !moved) return { ok: true, passage: row } as const;

		const { frontmatter, body } = splitFrontmatter(row.source);
		if (!frontmatterIsEditable(frontmatter))
			return { ok: false, reason: 'unreadable' } as const;
		const { chunker } = parsePassageFile(row.source);

		// The blank line under the block is kept, as `\n`: the words are, and a
		// line ending of another kind ahead of them would leave the file in two.
		const lead = LEADING_BLANK.exec(body)?.[0] === '' ? '' : '\n';
		const taken = namesIn(await rowsOf(db, connectionId), details.collection, id);
		const name = basename(row.path);
		const keepsName = !retitled && !taken.some((each) => foldName(each) === foldName(name));
		const edited = worded || detailed;
		const next = rowFor({
			...row,
			path: moved
				? joinPath(details.collection, keepsName ? name : uniqueFilename(title, taken))
				: row.path,
			source: serializePassageFile({
				frontmatter,
				body: worded ? `${lead}${text}` : body,
				metadata: {
					// A file another tool wrote gains what one the app wrote has:
					// none of these is written over a value the file already has.
					id: row.id,
					created: new Date(row.createdAt).toISOString(),
					...(chunker === undefined ? { chunker: CURRENT_CHUNKER } : {}),
					title,
					source: reference === '' ? undefined : reference,
					...(edited ? { updated: new Date(now).toISOString() } : {}),
				},
			}),
			updatedAt: edited ? now : row.updatedAt,
		});
		await ensureCollections(db, [details.collection], connectionId, now);
		await db.notes.put(next);
		return { ok: true, passage: next } as const;
	});

/** Delete a passage. What it gives back is what `restorePassages` puts back. */
export const deletePassage = (
	db: MemoriamDatabase,
	id: string,
	{ connectionId = LOCAL_CONNECTION_ID }: PassageScope = {}
): Promise<NoteRecord | undefined> =>
	db.transaction('rw', db.notes, async () => {
		const row = await db.notes.get([connectionId, id]);
		if (row !== undefined) await db.notes.delete([connectionId, id]);
		return row;
	});

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

/**
 * Put deleted passages back, each with the file it had, all from one
 * connection as one delete took them. One that is somehow here already — put
 * back from another tab — is left as it is.
 */
export const restorePassages = (
	db: MemoriamDatabase,
	rows: readonly NoteRecord[],
	now: number = Date.now()
): Promise<void> =>
	db.transaction('rw', db.notes, db.folders, async () => {
		const connectionId = rows[0]?.connectionId ?? LOCAL_CONNECTION_ID;
		const here = await db.notes.bulkGet(rows.map((row) => [row.connectionId, row.id]));
		const gone = rows.filter((_, at) => here[at] === undefined);
		const back = freePaths(await rowsOf(db, connectionId), gone);
		await ensureCollections(
			db,
			back.map((row) => parentPath(row.path)),
			connectionId,
			now
		);
		await db.notes.bulkAdd(back);
	});
