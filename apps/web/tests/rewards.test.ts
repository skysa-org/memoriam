import { activityPath, addDays, chunkPassage, localDay, ROOT } from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type MemoriamDatabase } from '../src/store/db.js';
import { createPassage, rowFor } from '../src/store/passages.js';
import { recordBadges, rewardsFor } from '../src/store/rewards.js';

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`rewards-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

const NOW = new Date(2026, 9, 13, 9, 0);
const TODAY = localDay(NOW);
const TEXT = 'Jesus wept.\n';
const KEY = chunkPassage(TEXT, 1)?.chunks[0]?.key ?? '';

const rows = () => db.notes.where('connectionId').equals('local').toArray();

/** A year's activity file, written as another device or tool might have left it. */
const activity = (lines: readonly string[], badges: readonly string[] = []) =>
	db.notes.put(
		rowFor({
			connectionId: 'local',
			id: 'activity-2026',
			path: activityPath(2026),
			source: `---\ndays:\n${lines.map((line) => `  ${line}\n`).join('')}${
				badges.length === 0
					? ''
					: `badges:\n${badges.map((line) => `  ${line}\n`).join('')}`
			}---\n`,
			createdAt: 0,
			updatedAt: 0,
		})
	);

const day = (offset: number, device = 'a') =>
	`${addDays(TODAY, offset)}~${device}: { words: 30, passes: 2, reviews: 1, started: 0, ms: 60000 }`;

describe('rewardsFor', () => {
	it('counts the streak over every device’s days', async () => {
		await activity([day(-2, 'a'), day(-1, 'b'), day(0, 'a')]);
		const rewards = rewardsFor(await rows(), {}, NOW);
		expect(rewards.streak).toMatchObject({ length: 3, practisedToday: true });
		expect(rewards.days.get(TODAY)?.words).toBe(30);
	});

	it('measures each passage, and leaves the app’s own files out', async () => {
		const passage = await createPassage(
			db,
			{ title: 'Jesus wept', reference: '', collection: ROOT, text: TEXT },
			{},
			NOW.getTime()
		);
		await db.notes.put({
			...passage,
			source: passage.source.replace(
				'chunker: 1\n',
				`chunker: 1\nprogress:\n  ${KEY}: { level: 5, due: ${addDays(TODAY, 3)}, learnt: ${TODAY} }\n`
			),
		});
		await activity([day(0)]);
		const rewards = rewardsFor(await rows(), {}, NOW);
		expect(rewards.passages.map((each) => each.title)).toEqual(['Jesus wept']);
		expect(rewards.measures.get(passage.id)).toMatchObject({ mastery: 1, learnt: true });
		expect(Object.fromEntries(rewards.unrecorded)).toEqual({ 'first-learnt': TODAY });
	});

	it('takes a badge a file records over the same badge earned now', async () => {
		await activity(
			[day(-1), day(0)],
			['comeback: 2026-01-02', 'some-future-badge: 2026-10-01']
		);
		const rewards = rewardsFor(await rows(), {}, NOW);
		expect(rewards.badges.get('comeback')).toBe('2026-01-02');
		expect(rewards.unrecorded.has('comeback')).toBe(false);
		expect([...rewards.badges.keys()]).not.toContain('some-future-badge');
	});
});

describe('recordBadges', () => {
	it('writes badges into this year’s file, keeping its days', async () => {
		await activity([day(0)]);
		expect(await recordBadges(db, new Map([['first-learnt', TODAY]]), {}, NOW)).toBe(true);
		const rewards = rewardsFor(await rows(), {}, NOW);
		expect(rewards.badges.get('first-learnt')).toBe(TODAY);
		expect(rewards.days.get(TODAY)?.passes).toBe(2);
	});

	it('makes the year’s file if there is none', async () => {
		expect(await recordBadges(db, new Map([['clean-run', TODAY]]), {}, NOW)).toBe(true);
		const file = await db.notes.get(['local', 'activity-2026']);
		expect(file?.source).toBe(`---\nbadges:\n  clean-run: ${TODAY}\n---\n`);
	});
});
