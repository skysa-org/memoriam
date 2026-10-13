import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activityPath, ROOT } from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { archiveName, libraryArchive } from '../src/archive/exportLibrary.js';
import { readZip, type ZipEntry } from '../src/archive/readZip.js';
import { crc32, joined, zipParts, type ZipWrite } from '../src/archive/zip.js';
import { createCollection } from '../src/store/collections.js';
import { createDatabase, type MemoriamDatabase } from '../src/store/db.js';
import { createPassage, rowFor } from '../src/store/passages.js';

/**
 * The archive both ways: what the writer makes, the reader takes apart again,
 * name for name and byte for byte; and a ZIP made by Finder, deflated, reads.
 */

const read = async (write: ZipWrite): Promise<ZipEntry[]> => {
	if (!write.ok) throw new Error(`not written: ${write.limit}`);
	const archive = await readZip(joined(write.parts).buffer);
	if (!archive.ok) throw new Error(`not read: ${archive.reason}`);
	return archive.entries;
};

const texts = (entries: readonly ZipEntry[]) =>
	Object.fromEntries(
		entries.flatMap((entry) =>
			entry.kind === 'file' ? [[entry.name, new TextDecoder().decode(entry.bytes)]] : []
		)
	);

const folders = (entries: readonly ZipEntry[]) =>
	entries.flatMap((entry) => (entry.kind === 'folder' ? [entry.name] : []));

describe('crc32', () => {
	it('gives the check value the standard gives', () => {
		expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
	});
});

describe('the archive round trip', () => {
	it('reads back every file, byte for byte, under the name it went in as', async () => {
		const files = [
			{ path: 'Psalms/Psalm 23.md', content: '---\ntitle: Psalm 23\n---\n\nThe Lord…\n' },
			{ path: 'Gedichte/Erlkönig.md', content: 'Wer reitet so spät\r\n' },
			{ path: '.memoriam/activity-2026.md', content: '---\ndays: {}\n---\n' },
		];
		const entries = await read(zipParts(files));
		expect(texts(entries)).toEqual(
			Object.fromEntries(files.map((file) => [file.path, file.content]))
		);
	});

	it('keeps an empty collection as a folder of its own, and no other', async () => {
		const entries = await read(
			zipParts(
				[{ path: 'Poems/Ozymandias.md', content: 'I met a traveller' }],
				[{ path: 'Poems' }, { path: 'Empty' }, { path: 'Empty' }, { path: ROOT }]
			)
		);
		expect(folders(entries)).toEqual(['Empty/']);
	});

	it('numbers a name another already takes, compared as a disk compares them', async () => {
		const entries = await read(
			zipParts([
				{ path: 'Poems/Psalm.md', content: 'one' },
				{ path: 'poems/psalm.md', content: 'two' },
				{ path: 'Poems', content: 'a file where a folder is' },
			])
		);
		expect(texts(entries)).toEqual({
			'Poems/Psalm.md': 'one',
			'poems/psalm (2).md': 'two',
			'Poems (2)': 'a file where a folder is',
		});
	});

	it('is the same bytes for the same files', () => {
		const files = [{ path: 'a.md', content: 'a', modifiedAt: Date.UTC(2026, 9, 13) }];
		const once = zipParts(files);
		const again = zipParts(files);
		expect(once.ok && again.ok && joined(once.parts)).toEqual(again.ok && joined(again.parts));
	});

	it('refuses what is no archive', async () => {
		expect(await readZip(new TextEncoder().encode('Jesus wept.').buffer)).toEqual({
			ok: false,
			reason: 'not-zip',
		});
	});

	it('reads an archive Finder made, deflated', async () => {
		const bytes = await readFile(
			join(dirname(fileURLToPath(import.meta.url)), 'fixtures/finder.zip')
		);
		const archive = await readZip(new Uint8Array(bytes).buffer);
		expect(archive.ok).toBe(true);
		const entries = archive.ok ? archive.entries : [];
		expect(texts(entries)['memoriam-2026-10-13/Shortest verse.txt']).toBe('Jesus wept.\n');
		expect(texts(entries)['memoriam-2026-10-13/Psalms/Psalm 23.md']).toContain(
			'title: Psalm 23'
		);
	});
});

describe('libraryArchive', () => {
	let db: MemoriamDatabase;

	beforeEach(() => {
		db = createDatabase(`archive-${crypto.randomUUID()}`);
	});

	afterEach(async () => {
		await db.delete();
	});

	it('holds every passage, every empty collection, and the activity files', async () => {
		const psalm = await createPassage(db, {
			title: 'Psalm 23',
			reference: 'Psalm 23',
			collection: 'Psalms',
			text: 'The Lord is my shepherd; I shall not want.\n',
		});
		await createCollection(db, 'Empty');
		const activity = '---\ndays:\n  2026-10-13~a: { words: 9, passes: 1 }\n---\n';
		await db.notes.put(
			rowFor({
				connectionId: 'local',
				id: 'activity-2026',
				path: activityPath(2026),
				source: activity,
				createdAt: 0,
				updatedAt: 0,
			})
		);

		const entries = await read(await libraryArchive(db));
		expect(texts(entries)).toEqual({
			'.memoriam/activity-2026.md': activity,
			[psalm.path]: psalm.source,
		});
		expect(folders(entries)).toEqual(['Empty/']);
	});

	it('is named for the day', () => {
		expect(archiveName(new Date(2026, 9, 13, 23, 30))).toBe('memoriam-2026-10-13.zip');
	});
});
