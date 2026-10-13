import {
	addDays,
	chunkPassage,
	localDay,
	parsePassageFile,
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

/** Practising a passage, through the app's own router, typed as a keyboard types. */

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

const add = () =>
	createPassage(db, {
		title: 'Jesus wept',
		reference: '',
		collection: ROOT,
		text: 'Jesus wept.\n',
	});

describe('practice', () => {
	it('learns a chunk pass by pass, and records each in the file', async () => {
		const user = userEvent.setup();
		const passage = await add();
		open(`/practice/${passage.id}`);

		await user.click(await screen.findByRole('button', { name: 'Start' }));
		const capture = screen.getByRole('textbox', { name: 'Type the first letter of each word' });
		expect(document.activeElement).toBe(capture);

		await user.keyboard('jw');
		expect((await screen.findByRole('status')).textContent).toContain(
			'You recalled 2 of 2 words.'
		);
		// Clean and quick, each pass skips a level: 0, 2, 4, then the top.
		// One pass after another: each waits for the one before to be typed.
		const levels = await [2, 4, 5].reduce<Promise<string[]>>(async (before) => {
			const seen = await before;
			await user.keyboard('{Enter}jw');
			const status = await screen.findByRole('status');
			return [...seen, status.textContent];
		}, Promise.resolve([]));
		expect(levels.at(-1)).toContain('Learnt.');
		expect(levels.slice(0, -1).every((text) => !text.includes('Learnt.'))).toBe(true);

		await user.keyboard('{Enter}');
		expect(await screen.findByText(/Every part of this passage is learnt/)).toBeTruthy();
		// The last pass is written as the screen moves on: wait for it.
		await waitFor(async () => {
			const source = (await db.notes.get(['local', passage.id]))?.source ?? '';
			const [entry] = readProgress(parsePassageFile(source).progress).chunks.values();
			expect(entry?.level).toBe(5);
			expect(entry?.due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});
	});

	it('shows a word in red on a wrong letter, and counts it missed', async () => {
		const user = userEvent.setup();
		const passage = await add();
		open(`/practice/${passage.id}`);

		await user.click(await screen.findByRole('button', { name: 'Start' }));
		await user.keyboard('x');
		expect(document.querySelector('.chunk-word.wrong')?.textContent).toBe('Jesus');
		await user.keyboard('jw');
		expect((await screen.findByRole('status')).textContent).toContain(
			'You recalled 1 of 2 words.'
		);
	});

	it('says so when there is nothing left to learn', async () => {
		const passage = await add();
		const key = chunkPassage('Jesus wept.\n', 1)?.chunks[0]?.key ?? '';
		const learnt = passage.source.replace(
			'chunker: 1\n',
			`chunker: 1\nprogress:\n  ${key}: { level: 5, due: ${addDays(localDay(new Date()), 30)} }\n`
		);
		await db.notes.put({ ...passage, source: learnt });
		open(`/practice/${passage.id}`);
		expect(await screen.findByText(/Every part of this passage is learnt/)).toBeTruthy();
	});
});
