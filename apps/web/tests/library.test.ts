import { parsePassageFile, ROOT } from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	createCollection,
	deleteCollection,
	renameCollection,
	restoreCollection,
} from '../src/store/collections.js';
import { createDatabase, type MemoriamDatabase, type NoteRecord } from '../src/store/db.js';
import { deviceId } from '../src/store/device.js';
import { libraryView } from '../src/store/library.js';
import {
	createPassage,
	deletePassage,
	type PassageDetails,
	passageText,
	restorePassages,
	titleFromText,
	updatePassage,
} from '../src/store/passages.js';

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`library-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

const PSALM: PassageDetails = {
	title: 'Psalm 23',
	reference: 'Psalm 23 (ESV)',
	collection: ROOT,
	text: 'The Lord is my shepherd; I shall not want.\nHe makes me lie down in green pastures.\n',
};

const OCT_13 = Date.parse('2026-10-13T14:00:00Z');
const OCT_14 = Date.parse('2026-10-14T09:30:00Z');

const view = async () => libraryView(await db.notes.toArray(), await db.folders.toArray());

describe('adding a passage', () => {
	it('writes a file with its details above its words', async () => {
		const row = await createPassage(db, PSALM, {}, OCT_13);
		expect(row.path).toBe('psalm-23.md');
		expect(row.source).toBe(
			[
				'---',
				`id: ${row.id}`,
				'title: Psalm 23',
				'source: Psalm 23 (ESV)',
				'created: 2026-10-13T14:00:00.000Z',
				'updated: 2026-10-13T14:00:00.000Z',
				'chunker: 1',
				'---',
				'',
				'The Lord is my shepherd; I shall not want.',
				'He makes me lie down in green pastures.',
				'',
			].join('\n')
		);
		expect(row).toMatchObject({ title: 'Psalm 23', reference: 'Psalm 23 (ESV)', dirty: 1 });
	});

	it('says nothing of a source when none is given', async () => {
		const row = await createPassage(db, { ...PSALM, reference: '  ' });
		expect(row.source).not.toContain('source:');
		expect(row.reference).toBeUndefined();
	});

	it('takes a title from the first words when given none', async () => {
		const row = await createPassage(db, { ...PSALM, title: '' });
		expect(row.title).toBe('The Lord is my shepherd; I');
	});

	it('keeps the words as typed, between their first and last lines', async () => {
		const row = await createPassage(db, {
			...PSALM,
			text: '\n\n  I met a traveller\r\nfrom an antique land  \n\n\n',
		});
		expect(passageText(row.source)).toBe('  I met a traveller\nfrom an antique land\n');
	});

	it('gives a second passage of the same title a name of its own', async () => {
		const first = await createPassage(db, PSALM);
		const second = await createPassage(db, PSALM);
		expect([first.path, second.path]).toEqual(['psalm-23.md', 'psalm-23-2.md']);
	});

	it('puts a passage in a collection, which then exists', async () => {
		const row = await createPassage(db, { ...PSALM, collection: 'Psalms' });
		expect(row.path).toBe('Psalms/psalm-23.md');
		expect(await db.folders.toArray()).toMatchObject([{ path: 'Psalms' }]);
	});
});

describe('titleFromText', () => {
	it('is the first line that is not a label, cut to six words, without its last stop', () => {
		expect(titleFromText('# Part one\n\nShall I compare thee to a summer’s day?\n')).toBe(
			'Shall I compare thee to a'
		);
		expect(titleFromText('Hope is the thing with feathers —\n')).toBe(
			'Hope is the thing with feathers'
		);
		expect(titleFromText('# only a label\n')).toBe('');
	});
});

describe('editing a passage', () => {
	it('writes new words, and says when', async () => {
		const row = await createPassage(db, PSALM, {}, OCT_13);
		const edited = await updatePassage(
			db,
			row.id,
			{ ...PSALM, text: 'The Lord is my shepherd.\n' },
			{},
			OCT_14
		);
		expect(edited.ok).toBe(true);
		const now = await db.notes.get(['local', row.id]);
		expect(passageText(now?.source ?? '')).toBe('The Lord is my shepherd.\n');
		expect(now?.source).toContain('updated: 2026-10-14T09:30:00.000Z\n');
		expect(now?.source).toContain('created: 2026-10-13T14:00:00.000Z\n');
		expect(now?.updatedAt).toBe(OCT_14);
	});

	it('writes nothing when nothing changed', async () => {
		const row = await createPassage(db, PSALM, {}, OCT_13);
		const edited = await updatePassage(db, row.id, PSALM, {}, OCT_14);
		expect(edited).toEqual({ ok: true, passage: row });
		expect(await db.notes.get(['local', row.id])).toEqual(row);
	});

	it('renames the file with the title, and moves it with the collection', async () => {
		const row = await createPassage(db, PSALM);
		await updatePassage(db, row.id, { ...PSALM, title: 'The Shepherd' });
		expect((await db.notes.get(['local', row.id]))?.path).toBe('the-shepherd.md');
		await updatePassage(db, row.id, { ...PSALM, title: 'The Shepherd', collection: 'Psalms' });
		expect((await db.notes.get(['local', row.id]))?.path).toBe('Psalms/the-shepherd.md');
	});

	it('moves a file without renaming it, unless its name is taken there', async () => {
		await createPassage(db, { ...PSALM, collection: 'Psalms' });
		const row = await createPassage(db, PSALM);
		await updatePassage(db, row.id, { ...PSALM, collection: 'Psalms' });
		expect((await db.notes.get(['local', row.id]))?.path).toBe('Psalms/psalm-23-2.md');
	});

	it('takes the source away when it is emptied', async () => {
		const row = await createPassage(db, PSALM);
		await updatePassage(db, row.id, { ...PSALM, reference: '' });
		const now = await db.notes.get(['local', row.id]);
		expect(now?.source).not.toContain('source:');
		expect(now?.reference).toBeUndefined();
	});

	it('keeps what it does not know: progress, and keys another tool wrote', async () => {
		const row = await createPassage(db, PSALM, {}, OCT_13);
		const withProgress = row.source.replace(
			'chunker: 1\n',
			'chunker: 1\nprogress:\n  k3fq9ma: { level: 2 }\nmood: calm # mine\n'
		);
		await db.notes.put({ ...row, source: withProgress });
		await updatePassage(db, row.id, { ...PSALM, title: 'The Shepherd' }, {}, OCT_14);
		const now = await db.notes.get(['local', row.id]);
		expect(now?.source).toContain('progress:\n  k3fq9ma: { level: 2 }\nmood: calm # mine\n');
	});

	it('gives a file another tool wrote what one the app wrote has', async () => {
		const row = await createPassage(db, PSALM, {}, OCT_13);
		await db.notes.put({ ...row, source: 'The Lord is my shepherd.\n' });
		await updatePassage(db, row.id, PSALM, {}, OCT_14);
		const parsed = parsePassageFile((await db.notes.get(['local', row.id]))?.source ?? '');
		expect(parsed).toMatchObject({ id: row.id, chunker: 1, createdAt: OCT_13 });
	});

	it('refuses to change the details of a file whose frontmatter is broken', async () => {
		const row = await createPassage(db, PSALM);
		const broken = '---\ntitle: "unterminated\ntags: [a\n---\n\nwords\n';
		await db.notes.put({ ...row, source: broken });
		expect(await updatePassage(db, row.id, { ...PSALM, text: 'other words' })).toEqual({
			ok: false,
			reason: 'unreadable',
		});
		expect((await db.notes.get(['local', row.id]))?.source).toBe(broken);
	});

	it('says so when the passage has gone', async () => {
		expect(await updatePassage(db, 'nope', PSALM)).toEqual({ ok: false, reason: 'missing' });
	});
});

describe('deleting a passage', () => {
	it('takes it away, and puts it back as it was', async () => {
		const row = await createPassage(db, { ...PSALM, collection: 'Psalms' });
		const deleted = await deletePassage(db, row.id);
		expect(deleted).toEqual(row);
		expect(await db.notes.count()).toBe(0);
		await restorePassages(db, [row]);
		expect(await db.notes.get(['local', row.id])).toEqual(row);
	});

	it('puts it back under another name when its own was taken meanwhile', async () => {
		const row = await createPassage(db, PSALM);
		await deletePassage(db, row.id);
		await createPassage(db, PSALM);
		await restorePassages(db, [row]);
		expect((await db.notes.get(['local', row.id]))?.path).toBe('psalm-23-2.md');
	});

	it('leaves alone one that is back already', async () => {
		const row = await createPassage(db, PSALM);
		await deletePassage(db, row.id);
		await restorePassages(db, [row]);
		await restorePassages(db, [row]);
		expect(await db.notes.count()).toBe(1);
	});
});

describe('collections', () => {
	it('are made once under a name, however it is spelled', async () => {
		expect(await createCollection(db, 'Psalms')).toEqual({ ok: true, path: 'Psalms' });
		// The answer names the collection there is, as it spells its name.
		expect(await createCollection(db, 'psalms')).toEqual({
			ok: false,
			reason: 'exists',
			path: 'Psalms',
		});
	});

	it('keep only what a provider accepts of a name', async () => {
		expect(await createCollection(db, ' .Poems: 1/2 ')).toEqual({
			ok: true,
			path: 'Poems 1 2',
		});
	});

	it('take their passages with them when renamed, and touch none of their words', async () => {
		await createCollection(db, 'Psalms');
		const row = await createPassage(db, { ...PSALM, collection: 'Psalms' }, {}, OCT_13);
		expect(await renameCollection(db, 'Psalms', 'Scripture')).toEqual({
			ok: true,
			path: 'Scripture',
		});
		const now = await db.notes.get(['local', row.id]);
		expect(now).toEqual({ ...row, path: 'Scripture/psalm-23.md' });
		expect((await db.folders.toArray()).map((folder) => folder.path)).toEqual(['Scripture']);
	});

	it('may be respelled, but not renamed onto another', async () => {
		await createCollection(db, 'Psalms');
		await createCollection(db, 'Poems');
		expect(await renameCollection(db, 'Psalms', 'PSALMS')).toEqual({
			ok: true,
			path: 'PSALMS',
		});
		expect(await renameCollection(db, 'PSALMS', 'poems')).toEqual({
			ok: false,
			reason: 'exists',
			path: 'Poems',
		});
	});

	it('take their passages when deleted, and give them back on undo', async () => {
		await createCollection(db, 'Psalms');
		const one = await createPassage(db, { ...PSALM, collection: 'Psalms' });
		const two = await createPassage(db, { ...PSALM, title: 'Psalm 1', collection: 'Psalms' });
		const kept = await createPassage(db, PSALM);
		const removed = await deleteCollection(db, 'Psalms');
		expect(removed.passages.map((row) => row.id).sort()).toEqual([one.id, two.id].sort());
		expect((await view()).collections).toEqual([]);
		await restoreCollection(db, removed);
		const after = await view();
		expect(after.collections.map((each) => each.passages.length)).toEqual([2]);
		expect(after.unfiled.map((row: NoteRecord) => row.id)).toEqual([kept.id]);
	});
});

describe('libraryView', () => {
	it('lists passages in no collection first, then each collection, by name', async () => {
		await createCollection(db, 'Sonnets');
		await createPassage(db, { ...PSALM, title: 'Psalm 23', collection: 'Psalms' });
		await createPassage(db, { ...PSALM, title: 'Psalm 1', collection: 'Psalms' });
		await createPassage(db, { ...PSALM, title: 'Ozymandias' });
		const library = await view();
		expect(library.count).toBe(3);
		expect(library.unfiled.map((row) => row.title)).toEqual(['Ozymandias']);
		expect(
			library.collections.map((each) => [each.name, each.passages.map((row) => row.title)])
		).toEqual([
			['Psalms', ['Psalm 1', 'Psalm 23']],
			['Sonnets', []],
		]);
	});

	it("leaves out the app's own files", async () => {
		const row = await createPassage(db, PSALM);
		await db.notes.put({ ...row, id: 'activity', path: '.memoriam/activity-2026.md' });
		const library = await view();
		expect(library.count).toBe(1);
		expect(library.collections).toEqual([]);
	});
});

describe('deviceId', () => {
	it('is made once and kept', async () => {
		const first = await deviceId(db);
		expect(first).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
		expect(await deviceId(db)).toBe(first);
	});

	it('is the same for two asking at once', async () => {
		const [a, b] = await Promise.all([deviceId(db), deviceId(db)]);
		expect(a).toBe(b);
	});
});
