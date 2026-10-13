import { localDay } from '@memoriam/core';

import { noteExported } from '../store/backup.js';
import { isLive, LOCAL_CONNECTION_ID, type MemoriamDatabase } from '../store/db.js';
import { zipParts, type ZipWrite } from './zip.js';

/**
 * The whole library as a ZIP of its files (docs/ARCHITECTURE.md §3, "Layout"):
 * every passage at its path, each collection a folder, and the app's own
 * activity files under `.memoriam/`. Each file goes in byte for byte as this
 * device holds it, so the archive can be unpacked into any folder, or imported
 * here or on another device, and be the same library.
 */

/** The archive's parts, read in one transaction so the passages and collections agree. */
export const libraryArchive = (
	db: MemoriamDatabase,
	connectionId: string = LOCAL_CONNECTION_ID
): Promise<ZipWrite> =>
	db.transaction('r', db.notes, db.folders, async () => {
		const notes = await db.notes
			.where('connectionId')
			.equals(connectionId)
			.filter(isLive)
			.toArray();
		const folders = await db.folders.where('connectionId').equals(connectionId).toArray();
		return zipParts(
			[...notes]
				.sort((a, b) => a.path.localeCompare(b.path) || a.id.localeCompare(b.id))
				.map((note) => ({
					path: note.path,
					content: note.source,
					modifiedAt: note.updatedAt,
				})),
			folders.map((folder) => ({ path: folder.path, modifiedAt: folder.createdAt }))
		);
	});

/** What an archive is called: the app, and the day on the user's own clock. */
export const archiveName = (now: Date): string => `memoriam-${localDay(now)}.zip`;

/** How long the archive's address is kept for the browser to read, once the download is asked for. */
const DOWNLOAD_GRACE_MS = 60_000;

/**
 * Hand an archive to the user's disk, through a link clicked and taken away
 * again. Its address is let go a minute later: the click only asks for the
 * download, and some browsers have not begun reading when it returns.
 */
export const save = (parts: readonly Uint8Array<ArrayBuffer>[], filename: string): void => {
	const url = URL.createObjectURL(new Blob([...parts], { type: 'application/zip' }));
	const link = document.createElement('a');
	try {
		link.setAttribute('href', url);
		link.setAttribute('download', filename);
		link.setAttribute('hidden', '');
		document.body.append(link);
		link.click();
	} finally {
		link.remove();
		setTimeout(() => {
			URL.revokeObjectURL(url);
		}, DOWNLOAD_GRACE_MS);
	}
};

export type Exported =
	| Readonly<{ ok: true; name: string }>
	| Readonly<{ ok: false; limit: Exclude<ZipWrite, { ok: true }>['limit'] }>;

/**
 * Export the library, and say what the file is called, or why there is none.
 * The day is noted, so the reminder to back up waits a while (`store/backup.ts`).
 */
export const exportLibrary = async (
	db: MemoriamDatabase,
	now: Date = new Date()
): Promise<Exported> => {
	const archive = await libraryArchive(db);
	if (!archive.ok) return archive;
	const name = archiveName(now);
	save(archive.parts, name);
	await noteExported(db, now);
	return { ok: true, name };
};
