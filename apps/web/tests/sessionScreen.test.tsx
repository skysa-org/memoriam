import {
	addDays,
	chunkPassage,
	localDay,
	parsePassageFile,
	readActivity,
	readProgress,
	ROOT,
} from '@memoriam/core';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppRouter } from '../src/router.js';
import { db } from '../src/store/db.js';
import { createPassage } from '../src/store/passages.js';
import { readSettings } from '../src/store/settings.js';

/** The day's practice, from Today, through the app's own router. */

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

const TEXT = 'Jesus wept.\n';
const KEY = chunkPassage(TEXT, 1)?.chunks[0]?.key ?? '';
const today = () => localDay(new Date());

/** A passage of one chunk, with `entry` as its progress, if any. */
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

const progressOf = async (id: string) => {
	const source = (await db.notes.get(['local', id]))?.source ?? '';
	return readProgress(parsePassageFile(source).progress).chunks.get(KEY);
};

describe('Today', () => {
	it('says what there is to do, and starts it', async () => {
		const user = userEvent.setup();
		await add();
		open('/');
		expect(await screen.findByText('0 of 2 new words')).toBeTruthy();
		await user.click(screen.getByRole('link', { name: 'Start' }));
		expect(await screen.findByText(/Learning · Part 1 of 1/)).toBeTruthy();
	});

	it('says when the day is done', async () => {
		await add(`{ level: 5, due: ${addDays(today(), 30)} }`);
		open('/');
		expect(await screen.findByText(/You are done for today/)).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Start' })).toBeNull();
	});
});

describe('the day’s session', () => {
	it('reviews a chunk that is due, and schedules the next review', async () => {
		const user = userEvent.setup();
		const passage = await add(`{ level: 5, due: ${today()} }`);
		open('/');
		expect(await screen.findByText('0 of 1 review')).toBeTruthy();
		await user.click(screen.getByRole('link', { name: 'Start' }));
		expect(await screen.findByText(/Review · Part 1 of 1/)).toBeTruthy();
		// Bare: nothing to see until it is typed.
		expect(document.querySelectorAll('.chunk-view .chunk-word')).toHaveLength(0);

		await user.click(screen.getByRole('button', { name: 'Start' }));
		await user.keyboard('jw');
		expect(await screen.findByText(/^Next review in \d+ days?\.$/)).toBeTruthy();
		const entry = await progressOf(passage.id);
		expect(entry?.level).toBe(5);
		expect(entry?.reps).toBe(1);
		expect(entry?.stability).toBeGreaterThan(0);
		expect((entry?.due ?? '') > today()).toBe(true);

		await user.keyboard('{Enter}');
		expect(await screen.findByText('You reviewed 1 part.')).toBeTruthy();
		const year = await db.notes
			.where('path')
			.equals(`.memoriam/activity-${today().slice(0, 4)}.md`)
			.first();
		const [day] = readActivity(year?.source ?? '').days.values();
		expect(day?.reviews).toBe(1);
		expect(day?.started).toBe(0);
	});

	it('learns a chunk forgotten at review again, once the reviews are done', async () => {
		const user = userEvent.setup();
		const passage = await add(`{ level: 5, due: ${today()} }`);
		open('/session');

		await user.click(await screen.findByRole('button', { name: 'Start' }));
		// One word of two missed: forgotten.
		await user.keyboard('xjw');
		expect(await screen.findByText(/comes back after your reviews/)).toBeTruthy();
		await waitFor(async () => {
			expect((await progressOf(passage.id))?.level).toBe(3);
		});
		const due = (await progressOf(passage.id))?.due;

		await user.keyboard('{Enter}');
		expect(await screen.findByText(/Learning again · Part 1 of 1/)).toBeTruthy();
		expect(screen.getByRole('img', { name: 'Level 3 of 5' })).toBeTruthy();
		// Clean and quick: up two levels, then a clean pass at the top.
		await user.keyboard('jw');
		await screen.findByText('Next time, more words are hidden.');
		await user.keyboard('{Enter}jw');
		expect(await screen.findByText(/^Learnt again\./)).toBeTruthy();
		await user.keyboard('{Enter}');
		expect(await screen.findByText('You reviewed 1 part.')).toBeTruthy();
		await waitFor(async () => {
			const entry = await progressOf(passage.id);
			expect(entry?.level).toBe(5);
			// Its review stays where the lapse put it.
			expect(entry?.due).toBe(due);
		});
	});

	it('says so when there is nothing to do', async () => {
		await add(`{ level: 5, due: ${addDays(today(), 30)} }`);
		open('/session');
		expect(await screen.findByText('There is nothing to practise right now.')).toBeTruthy();
	});
});

describe('Settings', () => {
	it('keeps each change on the device', async () => {
		const user = userEvent.setup();
		open('/');
		await user.click(await screen.findByRole('link', { name: 'Settings' }));
		await user.selectOptions(await screen.findByLabelText('New words a day'), '80 words');
		await user.selectOptions(screen.getByLabelText('Recall to aim for'), '95%');
		await user.click(screen.getByLabelText('Forgive slips of the finger'));
		await waitFor(async () => {
			const settings = await readSettings(db);
			expect(settings.newWords).toBe(80);
			expect(settings.retention).toBe(0.95);
			expect(settings.slips).toBe(false);
		});
		expect(screen.getByLabelText<HTMLSelectElement>('New words a day').value).toBe('80');
	});
});
