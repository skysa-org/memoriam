import { addDays, chunkPassage, localDay, MAX_LEVEL, ROOT } from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type MemoriamDatabase } from '../src/store/db.js';
import { createPassage } from '../src/store/passages.js';
import { recordPass } from '../src/store/practice.js';
import { planCounts, planFor, startedOn } from '../src/store/schedule.js';
import { DEFAULT_SETTINGS, readSettings, saveSetting } from '../src/store/settings.js';

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`schedule-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

const TEXT =
	'The Lord is my shepherd; I shall not want.\nHe makes me lie down in green pastures.\n\nHe restores my soul.\n';
const KEYS = chunkPassage(TEXT, 1)?.chunks.map((chunk) => chunk.key) ?? [];

const NOW = new Date(2026, 9, 13, 9, 0);
const TODAY = localDay(NOW);

const add = (title = 'Psalm 23', text = TEXT) =>
	createPassage(db, { title, reference: '', collection: ROOT, text }, {}, NOW.getTime() - 1000);

const rows = () => db.notes.where('connectionId').equals('local').toArray();

describe('the day’s plan', () => {
	it('learns a library’s new chunks, up to the day’s new words', async () => {
		await add();
		const plan = planFor(await rows(), { ...DEFAULT_SETTINGS, newWords: 20 }, NOW);
		// The first chunk is 17 words; the next, 4 more, would pass the cap of 20.
		expect(plan.steps).toEqual([{ kind: 'learn', id: expect.any(String) as string, chunk: 0 }]);
		expect(planCounts(plan)).toEqual({ reviews: 0, newWords: 17, fresh: 17 });
	});

	it('counts the words begun today against the cap, on every device', async () => {
		const row = await add();
		await recordPass(
			db,
			{
				id: row.id,
				key: KEYS[0] ?? '',
				update: () => ({ level: 1 }),
				activity: { words: 17, passes: 1, reviews: 0, ms: 9000 },
				device: 'k3fq9mab',
			},
			{},
			NOW
		);
		expect(startedOn(await rows(), TODAY)).toBe(17);
		expect(startedOn(await rows(), addDays(TODAY, 1))).toBe(0);
		const plan = planFor(await rows(), { ...DEFAULT_SETTINGS, newWords: 20 }, NOW);
		// The chunk begun goes on; no new one is begun past the cap.
		expect(plan.steps.map((step) => step.kind)).toEqual(['learn']);
		expect(planCounts(plan)).toEqual({ reviews: 0, newWords: 17, fresh: 0 });
		expect(plan.startedToday).toBe(17);
	});

	it('reviews what is due, and leaves the app’s own files out', async () => {
		const row = await add();
		const due = row.source.replace(
			'chunker: 1\n',
			`chunker: 1\nprogress:\n  ${KEYS[0] ?? ''}: { level: ${String(MAX_LEVEL)}, due: ${TODAY} }\n  ${KEYS[1] ?? ''}: { level: 3, due: ${addDays(TODAY, 4)} }\n`
		);
		await db.notes.put({ ...row, source: due });
		const plan = planFor(await rows(), DEFAULT_SETTINGS, NOW);
		expect(plan.steps).toEqual([
			{ kind: 'review', id: row.id, chunks: [0] },
			{ kind: 'relearn', id: row.id, chunk: 1 },
		]);
		expect(planCounts(plan)).toEqual({ reviews: 2, newWords: 0, fresh: 0 });
		expect([...plan.passages.keys()]).toEqual([row.id]);
	});
});

describe('settings', () => {
	it('are the defaults until one is set, and a value that is no choice reads as the default', async () => {
		expect(await readSettings(db)).toEqual(DEFAULT_SETTINGS);
		await saveSetting(db, 'newWords', 80);
		await saveSetting(db, 'retention', 0.95);
		await saveSetting(db, 'slips', false);
		expect(await readSettings(db)).toEqual({
			...DEFAULT_SETTINGS,
			newWords: 80,
			retention: 0.95,
			slips: false,
		});
		await db.prefs.put({ key: 'schedule.maxInterval', value: '7' });
		expect((await readSettings(db)).maxInterval).toBe(DEFAULT_SETTINGS.maxInterval);
	});
});
