import { activityPath, addDays, chunkPassage, localDay, readActivity, ROOT } from '@memoriam/core';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppRouter } from '../src/router.js';
import { db } from '../src/store/db.js';
import { createPassage, rowFor } from '../src/store/passages.js';
import { readSettings } from '../src/store/settings.js';

/** The streak, the Progress screen, and badges, through the app's own router. */

const open = (path: string) => {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(<RouterProvider router={router} />);
	return router;
};

beforeEach(async () => {
	await db.notes.clear();
	await db.folders.clear();
	await db.prefs.clear();
});

afterEach(() => {
	cleanup();
});

const today = () => localDay(new Date());
const year = () => Number(today().slice(0, 4));
const TEXT = 'Jesus wept.\n';
const KEY = chunkPassage(TEXT, 1)?.chunks[0]?.key ?? '';

/** Days practised on another device, by how many days before today. */
const practised = (...before: readonly number[]) =>
	db.notes.put(
		rowFor({
			connectionId: 'local',
			id: `activity-${String(year())}`,
			path: activityPath(year()),
			source: `---\ndays:\n${before
				.map(
					(back) =>
						`  ${addDays(today(), -back)}~other: { words: 30, passes: 2, reviews: 0, started: 0, ms: 60000 }\n`
				)
				.join('')}---\n`,
			createdAt: 0,
			updatedAt: 0,
		})
	);

const add = async (entry?: string) => {
	const passage = await createPassage(db, {
		title: 'Jesus wept',
		reference: '',
		collection: ROOT,
		text: TEXT,
	});
	if (entry === undefined) return passage;
	const source = passage.source.replace(
		'chunker: 1\n',
		`chunker: 1\nprogress:\n  ${KEY}: ${entry}\n`
	);
	await db.notes.put({ ...passage, source });
	return { ...passage, source };
};

const badgesRecorded = async () => {
	const file = await db.notes.get(['local', `activity-${String(year())}`]);
	return readActivity(file?.source ?? '').badges;
};

describe('the streak on Today', () => {
	it('counts the days in a row', async () => {
		await add();
		await practised(2, 1);
		open('/');
		expect(await screen.findByText('2-day streak')).toBeTruthy();
	});

	it('offers a way to keep it after a day missed, and never scolds', async () => {
		await add();
		await practised(3, 2);
		open('/');
		expect(
			await screen.findByText(/^Your streak can carry on: type 60 words by the end of/)
		).toBeTruthy();
	});
});

describe('Progress', () => {
	it('shows the streak, the days practised, and the badges to earn', async () => {
		const user = userEvent.setup();
		await practised(2, 1, 0);
		open('/');
		await user.click(await screen.findByRole('link', { name: 'Progress' }));
		expect(await screen.findByText('3 days in a row')).toBeTruthy();
		expect(
			screen.getByRole('img', { name: 'Practice over the last 26 weeks: 3 days practised.' })
		).toBeTruthy();
		expect(screen.getByText('First passage learnt')).toBeTruthy();
		expect(screen.getAllByText('Not yet earned').length).toBeGreaterThan(0);
	});
});

describe('badges', () => {
	it('are written down as they are earned, and said so briefly', async () => {
		await add(`{ level: 5, due: ${addDays(today(), 30)}, learnt: ${today()} }`);
		open('/');
		expect(await screen.findByText('New badge: First passage learnt')).toBeTruthy();
		await waitFor(async () => {
			expect((await badgesRecorded()).get('first-learnt')).toBe(today());
		});
	});

	it('are earned by a run through a whole passage without a miss', async () => {
		const user = userEvent.setup();
		const passage = await add(`{ level: 5, due: ${addDays(today(), 30)} }`);
		open(`/practice/${passage.id}`);
		await user.click(await screen.findByRole('button', { name: 'Run through it' }));
		await user.click(await screen.findByRole('button', { name: 'Start' }));
		expect(screen.getByText('Running through')).toBeTruthy();
		await user.keyboard('jw');
		await screen.findByText('You recalled 2 of 2 words.');
		await user.keyboard('{Enter}');
		expect(await screen.findByText(/^Word perfect: you ran through/)).toBeTruthy();
		await waitFor(async () => {
			expect((await badgesRecorded()).get('clean-run')).toBe(today());
		});
	});
});

describe('the passage’s page', () => {
	it('marks the words most often missed', async () => {
		const passage = await add('{ level: 2, misses: "0,3" }');
		open(`/passage/${passage.id}`);
		const marked = await screen.findByTitle('Missed 3 times');
		expect(marked.textContent).toBe('wept');
		expect(marked.className).toContain('heat-2');
		// The line still reads as it is written.
		expect(marked.closest('.passage-line')?.textContent).toBe('Jesus wept.');
	});
});

describe('the rest day', () => {
	it('is kept with the other settings', async () => {
		const user = userEvent.setup();
		open('/settings');
		await user.selectOptions(await screen.findByLabelText('Rest day'), 'Sunday');
		await waitFor(async () => {
			expect((await readSettings(db)).restDay).toBe(0);
		});
		await user.selectOptions(screen.getByLabelText('Rest day'), 'None');
		await waitFor(async () => {
			expect((await readSettings(db)).restDay).toBeUndefined();
		});
	});
});
