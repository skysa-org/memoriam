import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	activityPath,
	chunkPassage,
	parsePassageFile,
	readActivity,
	readProgress,
} from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { libraryArchive } from '../src/archive/exportLibrary.js';
import { gather, importLibrary } from '../src/archive/importLibrary.js';
import { joined, zipParts } from '../src/archive/zip.js';
import { createDatabase, type MemoriamDatabase } from '../src/store/db.js';
import { createPassage, rowFor } from '../src/store/passages.js';

/**
 * Files into the library (docs/ARCHITECTURE.md §10): a backup back in, the
 * same passage practised elsewhere merged, a different one kept beside it,
 * and nothing the library holds written over.
 */

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`import-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

const NOW = Date.UTC(2026, 9, 13, 9);
const TEXT = 'Jesus wept.\n\nRejoice always.\n';
const [FIRST = '', SECOND = ''] = chunkPassage(TEXT, 1)?.chunks.map((chunk) => chunk.key) ?? [];

const rows = () => db.notes.where('connectionId').equals('local').sortBy('path');
const sourceOf = async (id: string) => (await db.notes.get(['local', id]))?.source ?? '';
const levels = (source: string) =>
	Object.fromEntries(
		[...readProgress(parsePassageFile(source).progress).chunks].map(([key, entry]) => [
			key,
			entry.level,
		])
	);

/** A passage's file with progress written in, as another device would have left it. */
const practised = (source: string, lines: readonly string[]) =>
	source.replace(
		'chunker: 1\n',
		`chunker: 1\nprogress:\n${lines.map((line) => `  ${line}\n`).join('')}`
	);

const file = (name: string, content: string | Uint8Array<ArrayBuffer>) => new File([content], name);

const bring = async (files: readonly File[], target = db) =>
	importLibrary(target, await gather(files), {}, NOW);

const passage = () =>
	createPassage(db, { title: 'Two verses', reference: '', collection: 'Verses', text: TEXT });

const activity = (lines: readonly string[]) =>
	`---\ndays:\n${lines.map((line) => `  ${line}\n`).join('')}---\n`;

describe('gather', () => {
	it('opens an archive Finder made, leaving out its own folder and the one around the library', async () => {
		const bytes = await readFile(
			join(dirname(fileURLToPath(import.meta.url)), 'fixtures/finder.zip')
		);
		const gathered = await gather([file('memoriam-2026-10-13.zip', new Uint8Array(bytes))]);
		expect(gathered.files.map((each) => each.path).sort()).toEqual([
			'.memoriam/activity-2026.md',
			'Psalms/Psalm 23.md',
			'Shortest verse.txt',
		]);
		expect([...gathered.folders].sort()).toEqual(['.memoriam', 'Empty', 'Psalms']);
		expect(gathered).toMatchObject({ skipped: 0, unreadable: [] });
	});

	it('tells apart what is no passage from what cannot be read', async () => {
		const gathered = await gather([
			file('photo.jpg', 'not words'),
			file('broken.md', new Uint8Array([0x4a, 0xff, 0x65])),
			file('broken.zip', 'PK, but no more'),
		]);
		expect(gathered).toEqual({
			files: [],
			folders: [],
			skipped: 1,
			unreadable: ['broken.md', 'broken.zip'],
		});
	});
});

describe('importLibrary', () => {
	it('brings in a Finder archive: its passages, its collections and its practice', async () => {
		const bytes = await readFile(
			join(dirname(fileURLToPath(import.meta.url)), 'fixtures/finder.zip')
		);
		const report = await bring([file('backup.zip', new Uint8Array(bytes))]);
		expect(report).toEqual({
			added: 2,
			merged: 0,
			unchanged: 0,
			copied: 0,
			records: 1,
			skipped: 0,
			unreadable: [],
		});
		const library = await rows();
		expect(library.map((row) => [row.path, row.title])).toEqual([
			['.memoriam/activity-2026.md', 'activity 2026'],
			['Psalms/Psalm 23.md', 'Psalm 23'],
			['shortest-verse.md', 'Shortest verse'],
		]);
		expect(library.find((row) => row.title === 'Psalm 23')?.id).toBe('f1');
		expect(parsePassageFile(library[2]?.source ?? '').body.trim()).toBe('Jesus wept.');
		expect((await db.folders.toArray()).map((folder) => folder.path).sort()).toEqual([
			'Empty',
			'Psalms',
		]);
	});

	it('puts a library back as it was exported, and finds nothing new the second time', async () => {
		const ours = await passage();
		await db.notes.put({
			...ours,
			source: practised(ours.source, [`${FIRST}: { level: 3 }`]),
		});
		await db.notes.put(
			rowFor({
				connectionId: 'local',
				id: 'activity-2026',
				path: activityPath(2026),
				source: activity(['2026-10-12~a: { words: 9, passes: 1 }']),
				createdAt: 0,
				updatedAt: 0,
			})
		);
		const exported = await libraryArchive(db);
		const backup = file('memoriam.zip', joined(exported.ok ? exported.parts : []));
		const before = (await rows()).map((row) => [row.id, row.path, row.source]);

		const elsewhere = createDatabase(`import-${crypto.randomUUID()}`);
		try {
			expect(await bring([backup], elsewhere)).toMatchObject({ added: 1, records: 1 });
			const after = await elsewhere.notes
				.where('connectionId')
				.equals('local')
				.sortBy('path');
			expect(after.map((row) => [row.id, row.path, row.source])).toEqual(before);
		} finally {
			await elsewhere.delete();
		}

		expect(await bring([backup])).toMatchObject({ added: 0, unchanged: 1, records: 0 });
		expect((await rows()).map((row) => [row.id, row.path, row.source])).toEqual(before);
	});

	it('merges the progress of the same passage practised elsewhere, chunk by chunk', async () => {
		const ours = await passage();
		await db.notes.put({
			...ours,
			source: practised(ours.source, [
				`${FIRST}: { level: 2, reviewed: 2026-10-10T09:00:00Z }`,
				`${SECOND}: { level: 3, reviewed: 2026-10-13T09:00:00Z }`,
			]),
		});
		const theirs = practised(ours.source, [
			`${FIRST}: { level: 4, reviewed: 2026-10-12T09:00:00Z }`,
			`${SECOND}: { level: 1, reviewed: 2026-10-11T09:00:00Z }`,
		]);

		expect(await bring([file('Two verses.md', theirs)])).toMatchObject({
			merged: 1,
			added: 0,
			copied: 0,
		});
		const row = await db.notes.get(['local', ours.id]);
		expect(levels(row?.source ?? '')).toEqual({ [FIRST]: 4, [SECOND]: 3 });
		expect(row?.updatedAt).toBe(ours.updatedAt);
		expect(await db.notes.count()).toBe(1);
	});

	it('keeps a passage whose words differ beside the library’s own, as a copy', async () => {
		const ours = await passage();
		const theirs = ours.source.replace('Rejoice always.', 'Pray without ceasing.');

		expect(await bring([file('Two verses.md', theirs)])).toMatchObject({ copied: 1 });
		expect(await sourceOf(ours.id)).toBe(ours.source);
		const copy = (await rows()).find((row) => row.id !== ours.id);
		expect(copy).toMatchObject({ path: 'Verses/two-verses-imported.md' });
		const parsed = parsePassageFile(copy?.source ?? '');
		expect(parsed).toMatchObject({ id: copy?.id, title: 'Two verses (imported)' });
		expect(parsed.body).toContain('Pray without ceasing.');
	});

	it('finds a passage with no id by its path', async () => {
		await db.notes.put(
			rowFor({
				connectionId: 'local',
				id: 'ode',
				path: 'Ode.md',
				source: 'Thou still unravish’d bride of quietness\n',
				createdAt: 0,
				updatedAt: 0,
			})
		);
		expect(
			await bring([file('ode.md', 'Thou still unravish’d bride of quietness\n')])
		).toMatchObject({ unchanged: 1, added: 0 });
	});

	it('adds a passage at a path the library has taken under another name of its own', async () => {
		const ours = await passage();
		const theirs = `---\nid: other\ntitle: Two verses\n---\n\nSomething else.\n`;
		expect(await bring([file('x.zip', zipOf({ [ours.path]: theirs }))])).toMatchObject({
			added: 1,
		});
		const added = await db.notes.get(['local', 'other']);
		expect(added?.path).toBe('Verses/two-verses-2.md');
		expect(added?.source).toBe(theirs);
		expect(await sourceOf(ours.id)).toBe(ours.source);
	});

	it('merges a year of practice into the library’s own, day by day', async () => {
		await db.notes.put(
			rowFor({
				connectionId: 'local',
				id: 'activity-2026',
				path: activityPath(2026),
				source: activity(['2026-10-12~a: { words: 9, passes: 1 }']),
				createdAt: 0,
				updatedAt: 0,
			})
		);
		const theirs = activity([
			'2026-10-12~a: { words: 4, passes: 1 }',
			'2026-10-13~b: { words: 20, passes: 2 }',
		]);
		const report = await bring([
			file('x.zip', zipOf({ '.memoriam/activity-2026.md': theirs })),
		]);
		expect(report).toMatchObject({ records: 1, added: 0 });
		const days = readActivity(await sourceOf('activity-2026')).days;
		expect(days.get('2026-10-12~a')?.words).toBe(9);
		expect(days.get('2026-10-13~b')?.words).toBe(20);
	});

	it('leaves out the app’s other files, and practice it cannot read', async () => {
		const report = await bring([
			file(
				'x.zip',
				zipOf({
					'.memoriam/notes.md': 'not the library’s',
					'.memoriam/activity-2025.md': '---\ndays: [not, a, map]\n---\n',
				})
			),
		]);
		expect(report).toMatchObject({
			skipped: 1,
			records: 0,
			unreadable: ['.memoriam/activity-2025.md'],
		});
		expect(await db.notes.count()).toBe(0);
	});

	it('names a text file’s passage for the file, beside any of that name', async () => {
		await bring([file('Jesus wept.txt', 'Jesus wept.\n')]);
		await bring([file('Jesus wept.txt', 'Jesus wept.\n')]);
		expect((await rows()).map((row) => [row.path, row.title])).toEqual([
			['jesus-wept-2.md', 'Jesus wept'],
			['jesus-wept.md', 'Jesus wept'],
		]);
	});
});

/** A ZIP of these files, as the app writes one. */
const zipOf = (files: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> => {
	const written = zipParts(Object.entries(files).map(([path, content]) => ({ path, content })));
	return joined(written.ok ? written.parts : []);
};
