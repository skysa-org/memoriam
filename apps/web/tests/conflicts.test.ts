import {
	chunkPassage,
	type ChunkProgress,
	conflictContent,
	conflictPath,
	parsePassageFile,
	readProgress,
	ROOT,
	writeProgress,
} from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	conflictsIn,
	copiedAt,
	isConflictCopy,
	keepBoth,
	keepCopy,
	keepOriginal,
	keepOrphan,
	linesAgainst,
	originalPathOf,
} from '../src/store/conflicts.js';
import { bindLibrary } from '../src/store/connection.js';
import { createDatabase, type MemoriamDatabase, type NoteRecord } from '../src/store/db.js';
import {
	createPassage,
	deletePassage,
	type PassageDetails,
	passageText,
	rowFor,
} from '../src/store/passages.js';

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`conflicts-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

const PSALM: PassageDetails = {
	title: 'Psalm 23',
	reference: '',
	collection: ROOT,
	text: 'The Lord is my shepherd; I shall not want.\n',
};

const OCT_13 = Date.parse('2026-10-13T14:00:00Z');
const OCT_14 = Date.parse('2026-10-14T09:30:00Z');
const AT = new Date('2026-10-13T14:32:00Z');

const row = async (id: string): Promise<NoteRecord | undefined> => db.notes.get(['local', id]);

/** A copy of `original` as sync makes one: its own id, beside it, with `source`. */
const copyOf = async (original: NoteRecord, source: string): Promise<NoteRecord> => {
	const id = crypto.randomUUID();
	const copy = rowFor({
		id,
		connectionId: 'local',
		path: conflictPath(original.path, AT),
		source: conflictContent(source, id),
		createdAt: original.createdAt,
		updatedAt: OCT_13,
	});
	await db.notes.add(copy);
	return copy;
};

const reworded = (original: NoteRecord, text: string): string =>
	original.source.replace(passageText(original.source), text);

const keyOf = (text: string): string => chunkPassage(text, 1)?.chunks[0]?.key ?? '';

const learnt = (source: string, entries: [string, ChunkProgress][]): string => {
	const written = writeProgress(source, { chunks: new Map(entries), opaque: {} });
	if (!written.ok) throw new Error(written.reason);
	return written.text;
};

const progressOf = (source: string | undefined) =>
	readProgress(parsePassageFile(source ?? '').progress).chunks;

describe('finding conflict copies', () => {
	it('knows a copy by the stamp in its name', () => {
		expect(isConflictCopy('psalm-23 (conflict 2026-10-13T14-32).md')).toBe(true);
		expect(isConflictCopy('poems/psalm-23 (conflict 2026-10-13T14-32)-2.md')).toBe(true);
		expect(isConflictCopy('psalm-23.md')).toBe(false);
		expect(isConflictCopy('psalm-23 (conflict).md')).toBe(false);
		expect(isConflictCopy('.memoriam/activity-2026 (conflict 2026-10-13T14-32).md')).toBe(
			false
		);
	});

	it('finds the original at the name without the stamp', () => {
		expect(originalPathOf('poems/psalm-23 (conflict 2026-10-13T14-32)-2.md')).toBe(
			'poems/psalm-23.md'
		);
	});

	it('reads when a copy was made from its name, in UTC', () => {
		expect(copiedAt('poems/psalm-23 (conflict 2026-10-13T14-32)-2.md')).toBe(
			Date.parse('2026-10-13T14:32:00Z')
		);
		expect(copiedAt('psalm-23.md')).toBeUndefined();
	});

	it('marks the lines one version has and the other does not', () => {
		expect(linesAgainst('One.\nTwo.\nThree.\n', 'One.\nThree. \nFour.\n')).toEqual([
			{ line: 'One.', differs: false },
			{ line: 'Two.', differs: true },
			{ line: 'Three.', differs: false },
		]);
	});

	it('pairs each live copy with its original, whatever the case of its name', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, reworded(original, 'Other words.\n'));
		const orphan = await createPassage(db, { ...PSALM, title: 'Gone' }, {}, OCT_13);
		const lonely = await copyOf(orphan, orphan.source);
		await deletePassage(db, orphan.id);
		await db.notes.put({ ...original, path: 'PSALM-23.md' });

		const found = conflictsIn(await db.notes.toArray());

		expect(found.map((each) => [each.copy.id, each.original?.id])).toEqual([
			[lonely.id, undefined],
			[copy.id, original.id],
		]);
	});
});

describe('keeping the copy', () => {
	it('puts its words at the original’s path under the original’s id, and lets the copy go', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, reworded(original, 'Other words.\n'));

		const done = await keepCopy(db, { copyId: copy.id, originalId: original.id }, OCT_14);

		expect(done.ok).toBe(true);
		const kept = await row(original.id);
		expect(kept?.path).toBe(original.path);
		expect(passageText(kept?.source ?? '')).toBe('Other words.\n');
		expect(parsePassageFile(kept?.source ?? '').id).toBe(original.id);
		expect(kept?.updatedAt).toBe(OCT_14);
		expect(await row(copy.id)).toBeUndefined();
		expect(conflictsIn(await db.notes.toArray())).toEqual([]);
	});

	it('keeps the progress of both where the words are the same', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const key = keyOf(PSALM.text);
		const theirs = learnt(original.source, [
			[key, { level: 2, reviewed: '2026-10-13T15:00:00.000Z' }],
		]);
		await db.notes.put({ ...original, source: theirs });
		const copy = await copyOf(
			original,
			learnt(original.source, [[key, { level: 4, reviewed: '2026-10-13T16:00:00.000Z' }]])
		);

		await keepCopy(db, { copyId: copy.id, originalId: original.id }, OCT_14);

		expect(progressOf((await row(original.id))?.source).get(key)?.level).toBe(4);
	});

	it('leaves a tombstone owed its delete while the library is connected', async () => {
		await bindLibrary(db, { connectionId: 'c1', provider: 'dropbox' });
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, reworded(original, 'Other words.\n'));

		await keepCopy(db, { copyId: copy.id, originalId: original.id }, OCT_14);

		expect(await row(copy.id)).toMatchObject({ deletedLocally: 1 });
		const ops = await db.opQueue.toArray();
		expect(ops.map((op) => [op.noteId, op.op])).toEqual(
			expect.arrayContaining([
				[original.id, 'write'],
				[copy.id, 'delete'],
			])
		);
	});

	it('is taken back whole', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, reworded(original, 'Other words.\n'));

		const done = await keepCopy(db, { copyId: copy.id, originalId: original.id }, OCT_14);
		if (!done.ok) throw new Error(done.reason);
		await done.undo();

		expect((await row(original.id))?.source).toBe(original.source);
		expect((await row(copy.id))?.source).toBe(copy.source);
		expect(conflictsIn(await db.notes.toArray())).toHaveLength(1);
	});

	it('takes back nothing written to the original since, and still brings the copy back', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, reworded(original, 'Other words.\n'));
		const done = await keepCopy(db, { copyId: copy.id, originalId: original.id }, OCT_14);
		if (!done.ok) throw new Error(done.reason);
		const kept = await row(original.id);
		const practised = learnt(kept?.source ?? '', [[keyOf('Other words.\n'), { level: 1 }]]);
		await db.notes.put({ ...(kept as NoteRecord), source: practised });

		await done.undo();

		expect((await row(original.id))?.source).toBe(practised);
		expect(await row(copy.id)).toBeDefined();
	});

	it('does nothing when either half has gone', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, reworded(original, 'Other words.\n'));
		await deletePassage(db, original.id);

		expect(await keepCopy(db, { copyId: copy.id, originalId: original.id })).toEqual({
			ok: false,
			reason: 'missing',
		});
		expect(await row(copy.id)).toBeDefined();
	});
});

describe('keeping the original', () => {
	it('lets the copy go and leaves the original’s words', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, reworded(original, 'Other words.\n'));

		const done = await keepOriginal(db, { copyId: copy.id, originalId: original.id });

		expect(done.ok).toBe(true);
		expect((await row(original.id))?.source).toBe(original.source);
		expect(await row(copy.id)).toBeUndefined();
	});

	it('takes the copy’s progress where the words are the same, without calling it an edit', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const key = keyOf(PSALM.text);
		const copy = await copyOf(
			original,
			learnt(original.source, [[key, { level: 3, reviewed: '2026-10-13T16:00:00.000Z' }]])
		);

		await keepOriginal(db, { copyId: copy.id, originalId: original.id });

		const kept = await row(original.id);
		expect(progressOf(kept?.source).get(key)?.level).toBe(3);
		expect(parsePassageFile(kept?.source ?? '').id).toBe(original.id);
		expect(kept?.updatedAt).toBe(original.updatedAt);
	});

	it('is taken back whole', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const key = keyOf(PSALM.text);
		const copy = await copyOf(original, learnt(original.source, [[key, { level: 3 }]]));

		const done = await keepOriginal(db, { copyId: copy.id, originalId: original.id });
		if (!done.ok) throw new Error(done.reason);
		await done.undo();

		expect((await row(original.id))?.source).toBe(original.source);
		expect((await row(copy.id))?.source).toBe(copy.source);
	});
});

describe('keeping both', () => {
	it('gives the copy a title and a name of its own', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, reworded(original, 'Other words.\n'));

		const done = await keepBoth(db, copy.id, 'Psalm 23 (other version)', OCT_14);

		expect(done.ok).toBe(true);
		const kept = await row(copy.id);
		expect(kept).toMatchObject({
			title: 'Psalm 23 (other version)',
			path: 'psalm-23-other-version.md',
		});
		expect(passageText(kept?.source ?? '')).toBe('Other words.\n');
		expect((await row(original.id))?.source).toBe(original.source);
		expect(conflictsIn(await db.notes.toArray())).toEqual([]);
	});
});

describe('keeping a copy whose original is gone', () => {
	it('takes the original’s name', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, original.source);
		await deletePassage(db, original.id);

		const done = await keepOrphan(db, copy.id);

		expect(done.ok).toBe(true);
		expect((await row(copy.id))?.path).toBe('psalm-23.md');
		expect(conflictsIn(await db.notes.toArray())).toEqual([]);
	});

	it('takes a name from its title where that one is taken', async () => {
		const original = await createPassage(db, PSALM, {}, OCT_13);
		const copy = await copyOf(original, original.source);
		await deletePassage(db, original.id);
		await createPassage(db, { ...PSALM, title: 'Psalm 23' }, {}, OCT_14);

		await keepOrphan(db, copy.id);

		const kept = await row(copy.id);
		expect(kept?.path).not.toBe('psalm-23.md');
		expect(isConflictCopy(kept?.path ?? '')).toBe(false);
	});
});
