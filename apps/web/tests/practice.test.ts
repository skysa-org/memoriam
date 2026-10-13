import {
	chunkPassage,
	type ChunkProgress,
	parsePassageFile,
	readActivity,
	readProgress,
	ROOT,
} from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type MemoriamDatabase } from '../src/store/db.js';
import { createPassage } from '../src/store/passages.js';
import { type PassRecord, recordPass, recordPractice, usualPace } from '../src/store/practice.js';

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`practice-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

const TEXT =
	'The Lord is my shepherd; I shall not want.\nHe makes me lie down in green pastures.\n\nHe restores my soul.\n';

const KEYS = chunkPassage(TEXT, 1)?.chunks.map((chunk) => chunk.key) ?? [];

const NOW = new Date(2026, 9, 13, 21, 30);

const add = () =>
	createPassage(
		db,
		{ title: 'Psalm 23', reference: '', collection: ROOT, text: TEXT },
		{},
		NOW.getTime() - 1000
	);

const pass = (
	id: string,
	key: string,
	progress: ChunkProgress,
	more: Partial<PassRecord> = {}
): PassRecord => ({
	id,
	key,
	update: () => progress,
	activity: { words: 17, passes: 1, reviews: 0, ms: 9000 },
	device: 'k3fq9mab',
	...more,
});

const fileOf = async (id: string) => (await db.notes.get(['local', id]))?.source ?? '';

describe('recordPass', () => {
	it('writes the chunk’s progress, and nothing else of the file', async () => {
		const row = await add();
		const result = await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 2 }), {}, NOW);
		expect(result).toEqual({ ok: true, progress: { level: 2 }, activity: true });
		const source = await fileOf(row.id);
		expect(source).toBe(
			row.source.replace(
				'chunker: 1\n',
				`chunker: 1\nprogress:\n  ${KEYS[0] ?? ''}: { level: 2 }\n`
			)
		);
		const now = await db.notes.get(['local', row.id]);
		expect(now?.updatedAt).toBe(row.updatedAt);
		expect(now?.dirty).toBe(1);
	});

	it('gives the update what the file has now, and keeps the other chunks', async () => {
		const row = await add();
		const [first = '', second = ''] = KEYS;
		await recordPass(db, pass(row.id, second, { level: 4 }), {}, NOW);
		const seen: (ChunkProgress | undefined)[] = [];
		await recordPass(
			db,
			{
				...pass(row.id, first, { level: 1 }),
				update: (before) => (seen.push(before), { level: 1 }),
			},
			{},
			NOW
		);
		await recordPass(
			db,
			{
				...pass(row.id, first, { level: 3 }),
				update: (before) => (seen.push(before), { level: 3 }),
			},
			{},
			NOW
		);
		expect(seen).toEqual([undefined, { level: 1 }]);
		const progress = readProgress(parsePassageFile(await fileOf(row.id)).progress);
		// In passage order, whatever order they were practised in.
		expect([...progress.chunks]).toEqual([
			[first, { level: 3 }],
			[second, { level: 4 }],
		]);
	});

	it('adds the pass to the day’s practice, in the year’s activity file', async () => {
		const row = await add();
		await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 1 }), {}, NOW);
		await recordPass(db, pass(row.id, KEYS[1] ?? '', { level: 1 }), {}, NOW);
		const year = await db.notes.where('path').equals('.memoriam/activity-2026.md').toArray();
		expect(year).toHaveLength(1);
		// Both chunks were begun: all 21 of their words count against the day's new ones.
		expect([...readActivity(year[0]?.source ?? '').days]).toEqual([
			['2026-10-13~k3fq9mab', { words: 34, passes: 2, reviews: 0, started: 21, ms: 18000 }],
		]);
	});

	it('counts a chunk begun once, on its first pass', async () => {
		const row = await add();
		await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 1 }), {}, NOW);
		await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 2 }), {}, NOW);
		const [year] = await db.notes.where('path').equals('.memoriam/activity-2026.md').toArray();
		expect(readActivity(year?.source ?? '').days.get('2026-10-13~k3fq9mab')?.started).toBe(17);
	});

	it('says so when the passage’s words no longer have the chunk', async () => {
		const row = await add();
		expect(await recordPass(db, pass(row.id, 'zzzzzzz', { level: 1 }), {}, NOW)).toEqual({
			ok: false,
			reason: 'changed',
		});
		expect(await recordPass(db, pass('nope', KEYS[0] ?? '', { level: 1 }), {}, NOW)).toEqual({
			ok: false,
			reason: 'missing',
		});
	});

	it('refuses a file whose frontmatter it cannot safely rewrite, and keeps it as it was', async () => {
		const row = await add();
		const broken = `---\ntitle: "unterminated\n---\n\n${TEXT}`;
		await db.notes.put({ ...row, source: broken });
		expect(await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 1 }), {}, NOW)).toEqual({
			ok: false,
			reason: 'unreadable',
		});
		expect(await fileOf(row.id)).toBe(broken);
		expect(await db.notes.where('path').equals('.memoriam/activity-2026.md').count()).toBe(0);
	});

	it('records the pass even when the activity file cannot be added to', async () => {
		const row = await add();
		await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 1 }), {}, NOW);
		const [year] = await db.notes.where('path').equals('.memoriam/activity-2026.md').toArray();
		if (year === undefined) throw new Error('no activity file');
		await db.notes.put({ ...year, source: '---\ndays: [broken\n---\n' });
		const result = await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 2 }), {}, NOW);
		expect(result).toEqual({ ok: true, progress: { level: 2 }, activity: false });
		expect((await db.notes.get(['local', year.id]))?.source).toBe('---\ndays: [broken\n---\n');
	});

	it('learns the typist’s pace from clean passes, a fifth at a time', async () => {
		const row = await add();
		expect(await usualPace(db)).toBeUndefined();
		await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 1 }, { pace: 1000 }), {}, NOW);
		expect(await usualPace(db)).toBe(1000);
		await recordPass(db, pass(row.id, KEYS[0] ?? '', { level: 1 }, { pace: 500 }), {}, NOW);
		expect(await usualPace(db)).toBe(900);
	});
});

describe('recordPractice', () => {
	it('adds a pass that is no one chunk’s to the day, and changes no passage', async () => {
		const row = await add();
		const added = await recordPractice(
			db,
			{ activity: { words: 21, passes: 1, reviews: 0, ms: 7000 }, device: 'k3fq9mab' },
			{},
			NOW
		);
		expect(added).toBe(true);
		expect(await fileOf(row.id)).toBe(row.source);
		const [year] = await db.notes.where('path').equals('.memoriam/activity-2026.md').toArray();
		expect([...readActivity(year?.source ?? '').days]).toEqual([
			['2026-10-13~k3fq9mab', { words: 21, passes: 1, reviews: 0, started: 0, ms: 7000 }],
		]);
	});
});
