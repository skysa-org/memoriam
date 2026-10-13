import { foldName, isHidden, parentPath, ROOT, SEPARATOR } from '@memoriam/core';

import { LOCALE } from '../i18n/t.js';
import { type FolderRecord, type NoteRecord } from './db.js';

/**
 * The library as the Library screen lists it: the passages in no collection,
 * then each collection with the passages directly in it. The app's own files
 * (`.memoriam/`) are in the same table and in none of this (`isHidden`).
 */

export interface CollectionView {
	readonly path: string;
	/** As the user named it; a collection inside another reads as both names. */
	readonly name: string;
	readonly passages: readonly NoteRecord[];
}

export interface LibraryView {
	readonly unfiled: readonly NoteRecord[];
	readonly collections: readonly CollectionView[];
	/** Every passage, in a collection or not. */
	readonly count: number;
}

const collator = new Intl.Collator(LOCALE, { sensitivity: 'base', numeric: true });

const byTitle = (a: NoteRecord, b: NoteRecord): number =>
	collator.compare(a.title, b.title) || collator.compare(a.path, b.path);

/** A collection's name as a list shows it. */
export const collectionName = (path: string): string => path.split(SEPARATOR).join(' / ');

export const libraryView = (
	notes: readonly NoteRecord[],
	folders: readonly FolderRecord[]
): LibraryView => {
	const passages = notes.filter((note) => !isHidden(note.path));
	const paths = [
		...folders.map((folder) => folder.path),
		...passages.map((note) => parentPath(note.path)),
	].filter((path) => path !== ROOT && !isHidden(path));
	// One collection however its name is spelled across rows: a provider
	// takes `Psalms` and `psalms` for one folder.
	const distinct = [...new Map(paths.map((path) => [foldName(path), path])).values()];
	const inside = (path: string): NoteRecord[] =>
		passages.filter((note) => foldName(parentPath(note.path)) === foldName(path)).sort(byTitle);
	return {
		unfiled: inside(ROOT),
		collections: distinct
			.map((path) => ({ path, name: collectionName(path), passages: inside(path) }))
			.sort((a, b) => collator.compare(a.name, b.name)),
		count: passages.length,
	};
};
