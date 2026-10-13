import {
	activityIsReadable,
	basename,
	CURRENT_CHUNKER,
	foldName,
	frontmatterIsEditable,
	isActivityPath,
	isHidden,
	joinPath,
	mergeActivity,
	mergePassage,
	normalizePath,
	parentPath,
	parsePassageFile,
	PASSAGE_EXTENSION,
	readActivity,
	ROOT,
	serializePassageFile,
	splitFrontmatter,
	uniqueFilename,
	UNTITLED_TITLE,
} from '@memoriam/core';

import { t } from '../i18n/t.js';
import { ensureCollections } from '../store/collections.js';
import { LOCAL_CONNECTION_ID, type MemoriamDatabase, type NoteRecord } from '../store/db.js';
import { keptText, rowFor, titleFromText } from '../store/passages.js';
import { readZip } from './readZip.js';

/**
 * Passages into the library from files (docs/ARCHITECTURE.md §10): markdown or
 * text files, or a backup's ZIP. Nothing the library holds is written over.
 *
 * - A passage it has already, by its `id` (or, with none, by its path), is
 *   merged: the same words and details, and only the progress is new, merges
 *   chunk by chunk (`mergePassage`); different words or details, and the
 *   incoming one comes in beside it as a copy.
 * - A year's activity it has already merges day by day (`mergeActivity`).
 * - Anything else is added, at its own path where that is free.
 */

/** A file to import: its path in the library it came from, and its text. */
export interface Incoming {
	readonly path: string;
	readonly text: string;
}

export interface Gathered {
	readonly files: readonly Incoming[];
	/** Folders an archive holds, which may be collections with nothing in them. */
	readonly folders: readonly string[];
	/** Names of files that could not be read: damaged, encrypted, not text. */
	readonly unreadable: readonly string[];
	/** Files that are no passage: pictures, a system's leftovers. */
	readonly skipped: number;
}

const NOTHING: Gathered = { files: [], folders: [], unreadable: [], skipped: 0 };

const TEXT = /\.(?:md|markdown|txt)$/i;
const ZIP = /\.zip$/i;
/** What an operating system leaves in an archive of a folder. */
const LEFTOVERS = /(?:^|\/)(?:__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;
/** The app's own folder, wherever in an archive the library's root is. */
const APP_FOLDER = /^(.*\/)?\.memoriam\/activity-\d{4}\.md$/;

/** UTF-8 text, its byte order mark dropped; none for bytes that are not. */
const decoded = (bytes: Uint8Array): string | undefined => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return undefined;
	}
};

const together = (a: Gathered, b: Gathered): Gathered => ({
	files: [...a.files, ...b.files],
	folders: [...a.folders, ...b.folders],
	unreadable: [...a.unreadable, ...b.unreadable],
	skipped: a.skipped + b.skipped,
});

/**
 * Where the library starts in an archive: at its root, or, for an export
 * unpacked and compressed again as a folder, in the folder that holds the
 * app's own.
 */
const rootOf = (names: readonly string[]): string => {
	const prefix = names
		.map((name) => APP_FOLDER.exec(name)?.[1])
		.find((each) => each !== undefined);
	return prefix !== undefined && names.every((name) => name.startsWith(prefix)) ? prefix : '';
};

const fromZip = async (file: File): Promise<Gathered> => {
	const read = await readZip(await file.arrayBuffer());
	if (!read.ok) return { ...NOTHING, unreadable: [file.name] };
	const entries = read.entries
		.map((entry) => ({ ...entry, name: entry.name.replace(/\\/g, '/') }))
		.filter((entry) => !LEFTOVERS.test(entry.name));
	const root = rootOf(entries.map((entry) => entry.name));
	return entries.reduce<Gathered>((gathered, entry) => {
		const path = normalizePath(entry.name.slice(root.length));
		if (entry.kind === 'folder') {
			return path === ROOT ? gathered : { ...gathered, folders: [...gathered.folders, path] };
		}
		if (entry.kind === 'unreadable') {
			return { ...gathered, unreadable: [...gathered.unreadable, entry.name] };
		}
		if (!TEXT.test(path)) return { ...gathered, skipped: gathered.skipped + 1 };
		const text = decoded(entry.bytes);
		return text === undefined
			? { ...gathered, unreadable: [...gathered.unreadable, entry.name] }
			: { ...gathered, files: [...gathered.files, { path, text }] };
	}, NOTHING);
};

const fromFile = async (file: File): Promise<Gathered> => {
	if (ZIP.test(file.name)) return fromZip(file);
	if (!TEXT.test(file.name)) return { ...NOTHING, skipped: 1 };
	const text = decoded(new Uint8Array(await file.arrayBuffer()));
	return text === undefined
		? { ...NOTHING, unreadable: [file.name] }
		: { ...NOTHING, files: [{ path: normalizePath(basename(file.name)), text }] };
};

/** The files chosen, read: each archive opened, each text decoded. */
export const gather = (uploads: readonly File[]): Promise<Gathered> =>
	uploads.reduce<Promise<Gathered>>(
		async (sofar, file) => together(await sofar, await fromFile(file)),
		Promise.resolve(NOTHING)
	);

export interface ImportReport {
	readonly added: number;
	/** Passages whose progress was merged into the library's own. */
	readonly merged: number;
	/** Passages the library already had as they are. */
	readonly unchanged: number;
	/** Passages that differ from the library's own, added beside them. */
	readonly copied: number;
	/** Years of practice brought in, or merged into the library's own. */
	readonly records: number;
	readonly skipped: number;
	readonly unreadable: readonly string[];
}

interface Placing {
	/** Every row, as the import leaves it so far. */
	readonly rows: readonly NoteRecord[];
	/** The rows to write, by id. */
	readonly changed: ReadonlyMap<string, NoteRecord>;
	readonly report: ImportReport;
}

interface Context {
	readonly connectionId: string;
	readonly now: number;
	readonly newId: () => string;
}

const count = (placing: Placing, key: Exclude<keyof ImportReport, 'unreadable'>): Placing => ({
	...placing,
	report: { ...placing.report, [key]: placing.report[key] + 1 },
});

const put = (placing: Placing, row: NoteRecord): Placing => ({
	...placing,
	rows: [...placing.rows.filter((each) => each.id !== row.id), row],
	changed: new Map(placing.changed).set(row.id, row),
});

const unreadable = (placing: Placing, path: string): Placing => ({
	...placing,
	report: { ...placing.report, unreadable: [...placing.report.unreadable, path] },
});

/** The names taken in a folder, folded as the library compares them. */
const namesIn = (rows: readonly NoteRecord[], folder: string): string[] =>
	rows
		.filter((row) => foldName(parentPath(row.path)) === foldName(folder))
		.map((row) => basename(row.path));

/** A passage file's path in the library: `.md`, whatever it came as. */
const passagePath = (path: string): string =>
	path.replace(/\.(?:markdown|txt)$/i, PASSAGE_EXTENSION);

const added = (placing: Placing, row: NoteRecord, what: 'added' | 'copied' | 'records') =>
	count(put(placing, row), what);

/** A text file: its words a new passage, named for the file. */
const placeText = (placing: Placing, file: Incoming, context: Context): Placing => {
	const folder = parentPath(file.path);
	const title =
		basename(file.path)
			.replace(/\.[^.]*$/, '')
			.trim() ||
		titleFromText(file.text) ||
		UNTITLED_TITLE;
	const id = context.newId();
	const stamp = new Date(context.now).toISOString();
	return added(
		placing,
		rowFor({
			id,
			connectionId: context.connectionId,
			path: joinPath(folder, uniqueFilename(title, namesIn(placing.rows, folder))),
			source: serializePassageFile({
				frontmatter: null,
				body: keptText(file.text),
				metadata: { id, title, created: stamp, updated: stamp, chunker: CURRENT_CHUNKER },
			}),
			createdAt: context.now,
			updatedAt: context.now,
		}),
		'added'
	);
};

/** A year's activity: merged into the library's own, or added where it has none. */
const placeActivity = (placing: Placing, file: Incoming, context: Context): Placing => {
	if (!activityIsReadable(file.text)) return unreadable(placing, file.path);
	const ours = placing.rows.find((row) => row.path === file.path);
	if (ours === undefined) {
		const id = basename(file.path).replace(/\.[^.]*$/, '');
		return added(
			placing,
			rowFor({
				id: placing.rows.some((row) => row.id === id) ? context.newId() : id,
				connectionId: context.connectionId,
				path: file.path,
				source: file.text,
				createdAt: context.now,
				updatedAt: context.now,
			}),
			'records'
		);
	}
	const merged = mergeActivity(ours.source, readActivity(file.text));
	if (!merged.ok) return unreadable(placing, file.path);
	if (merged.text === ours.source) return placing;
	return count(
		put(placing, rowFor({ ...ours, source: merged.text, updatedAt: context.now })),
		'records'
	);
};

/**
 * A passage that differs from the library's own: in the same collection,
 * with an id and a name of its own.
 */
const placeCopy = (
	placing: Placing,
	file: Incoming,
	ours: NoteRecord,
	title: string,
	context: Context
): Placing => {
	const folder = parentPath(ours.path);
	const id = context.newId();
	const named = t('settings.backup.copyTitle', { title });
	const { frontmatter, body } = splitFrontmatter(file.text);
	const source = frontmatterIsEditable(frontmatter)
		? serializePassageFile({ frontmatter, body, metadata: { id, title: named } })
		: file.text;
	return added(
		placing,
		rowFor({
			id,
			connectionId: context.connectionId,
			path: joinPath(folder, uniqueFilename(named, namesIn(placing.rows, folder))),
			source,
			createdAt: context.now,
			updatedAt: context.now,
		}),
		'copied'
	);
};

const placePassage = (placing: Placing, file: Incoming, context: Context): Placing => {
	const path = passagePath(file.path);
	const parsed = parsePassageFile(file.text, { filename: basename(path) });
	const ours =
		parsed.id === undefined
			? placing.rows.find((row) => foldName(row.path) === foldName(path))
			: placing.rows.find((row) => row.id === parsed.id && !isHidden(row.path));
	if (ours !== undefined) {
		const merged = mergePassage(ours.source, file.text);
		if (merged.kind === 'same') return count(placing, 'unchanged');
		if (merged.kind === 'merged') {
			// Practice, not an edit: `updatedAt` stays where the words left it.
			return count(put(placing, rowFor({ ...ours, source: merged.text })), 'merged');
		}
		return placeCopy(placing, file, ours, parsed.title, context);
	}
	const folder = parentPath(path);
	const free = !placing.rows.some((row) => foldName(row.path) === foldName(path));
	return added(
		placing,
		rowFor({
			id:
				parsed.id !== undefined && !placing.rows.some((row) => row.id === parsed.id)
					? parsed.id
					: context.newId(),
			connectionId: context.connectionId,
			path: free
				? path
				: joinPath(folder, uniqueFilename(parsed.title, namesIn(placing.rows, folder))),
			source: file.text,
			createdAt: parsed.createdAt ?? context.now,
			updatedAt: parsed.updatedAt ?? context.now,
		}),
		'added'
	);
};

const place = (placing: Placing, file: Incoming, context: Context): Placing => {
	if (isActivityPath(file.path)) return placeActivity(placing, file, context);
	if (isHidden(file.path)) return count(placing, 'skipped');
	if (/\.txt$/i.test(file.path)) return placeText(placing, file, context);
	return placePassage(placing, file, context);
};

/** Bring what was gathered into the library, in one transaction, and say what came of it. */
export const importLibrary = (
	db: MemoriamDatabase,
	gathered: Gathered,
	{ connectionId = LOCAL_CONNECTION_ID }: Readonly<{ connectionId?: string }> = {},
	now: number = Date.now()
): Promise<ImportReport> =>
	db.transaction('rw', db.notes, db.folders, async () => {
		const rows = await db.notes.where('connectionId').equals(connectionId).toArray();
		const context: Context = { connectionId, now, newId: () => crypto.randomUUID() };
		const placed = gathered.files.reduce<Placing>(
			(placing, file) => place(placing, file, context),
			{
				rows,
				changed: new Map(),
				report: {
					added: 0,
					merged: 0,
					unchanged: 0,
					copied: 0,
					records: 0,
					skipped: gathered.skipped,
					unreadable: gathered.unreadable,
				},
			}
		);
		const written = [...placed.changed.values()];
		await db.notes.bulkPut(written);
		await ensureCollections(
			db,
			[
				...written.filter((row) => !isHidden(row.path)).map((row) => parentPath(row.path)),
				...gathered.folders.filter((folder) => !isHidden(folder)),
			].filter((folder) => folder !== ROOT),
			connectionId,
			now
		);
		return placed.report;
	});
