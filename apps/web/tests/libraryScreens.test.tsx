import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAppRouter } from '../src/router.js';
import { db } from '../src/store/db.js';
import { createPassage } from '../src/store/passages.js';

/**
 * The Library's screens, through the app's own router: adding a passage,
 * reading it, deleting it and taking that back, and leaving an edit unsaved.
 */

const open = (path: string) => {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(<RouterProvider router={router} />);
	return router;
};

beforeEach(async () => {
	await db.notes.clear();
	await db.folders.clear();
});

afterEach(() => {
	cleanup();
});

describe('the Library', () => {
	it('adds a passage, and shows it on its own page and in the list', async () => {
		const user = userEvent.setup();
		open('/new');

		await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Ozymandias');
		await user.type(screen.getByRole('textbox', { name: 'Source' }), 'Shelley');
		await user.type(
			screen.getByRole('textbox', { name: 'Text' }),
			'I met a traveller from an antique land'
		);
		await user.click(screen.getByRole('button', { name: 'Add to library' }));

		expect(await screen.findByRole('heading', { name: 'Ozymandias' })).toBeTruthy();
		expect(screen.getByText('I met a traveller from an antique land')).toBeTruthy();

		await user.click(screen.getByRole('link', { name: 'Library' }));
		const row = await screen.findByRole('link', { name: /Ozymandias/ });
		expect(row.textContent).toContain('Shelley');
	});

	it('will not add a passage with no words', async () => {
		const user = userEvent.setup();
		open('/new');
		await user.type(await screen.findByRole('textbox', { name: 'Title' }), 'Nothing yet');
		const add = screen.getByRole('button', { name: 'Add to library' });
		expect((add as HTMLButtonElement).disabled).toBe(true);
	});

	it('takes back a delete from the notice it leaves', async () => {
		const user = userEvent.setup();
		const passage = await createPassage(db, {
			title: 'Psalm 23',
			reference: '',
			collection: '',
			text: 'The Lord is my shepherd',
		});
		open(`/passage/${passage.id}`);

		await user.click(await screen.findByRole('button', { name: 'Delete' }));
		const notice = await screen.findByRole('status');
		expect(notice.textContent).toContain('“Psalm 23” deleted.');
		expect(await db.notes.count()).toBe(0);

		await user.click(within(notice).getByRole('button', { name: 'Undo' }));
		expect(await screen.findByRole('link', { name: /Psalm 23/ })).toBeTruthy();
		expect(await db.notes.get(['local', passage.id])).toEqual(passage);
	});

	it('asks before leaving an edit that was not saved', async () => {
		const user = userEvent.setup();
		const passage = await createPassage(db, {
			title: 'Psalm 23',
			reference: '',
			collection: '',
			text: 'The Lord is my shepherd',
		});
		open(`/edit/${passage.id}`);

		const title = await screen.findByRole('textbox', { name: 'Title' });
		await user.type(title, ', changed');
		await user.click(screen.getByRole('link', { name: 'Library' }));

		const asked = await screen.findByRole('alertdialog');
		await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
		expect(screen.getByRole('textbox', { name: 'Title' })).toHaveProperty(
			'value',
			'Psalm 23, changed'
		);

		await user.click(screen.getByRole('link', { name: 'Library' }));
		await user.click(
			within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' })
		);
		expect(await screen.findByRole('heading', { name: 'Library' })).toBeTruthy();
		expect((await db.notes.get(['local', passage.id]))?.title).toBe('Psalm 23');
	});

	it('names a collection that is there already, rather than make a second', async () => {
		const user = userEvent.setup();
		open('/library');

		await user.click(await screen.findByRole('button', { name: 'New collection' }));
		await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Psalms');
		await user.click(screen.getByRole('button', { name: 'Create' }));
		expect(await screen.findByRole('heading', { name: 'Psalms' })).toBeTruthy();

		await user.click(screen.getByRole('button', { name: 'New collection' }));
		await user.type(screen.getByRole('textbox', { name: 'Name' }), 'PSALMS');
		await user.click(screen.getByRole('button', { name: 'Create' }));
		expect((await screen.findByRole('alert')).textContent).toBe(
			'There is already a collection called “Psalms”.'
		);
		expect(await db.folders.count()).toBe(1);
	});

	it('shows a passage as the parts it is learnt in, under its sections’ names', async () => {
		const passage = await createPassage(db, {
			title: 'Psalm 23',
			reference: '',
			collection: '',
			text: '# Verse 1\nThe Lord is my shepherd;\nI shall not want.\n\n# Verse 2\nHe makes me lie down in green pastures.\n',
		});
		open(`/passage/${passage.id}`);

		expect(await screen.findByRole('heading', { level: 2, name: 'Verse 1' })).toBeTruthy();
		expect(screen.getByRole('heading', { level: 2, name: 'Verse 2' })).toBeTruthy();
		expect(screen.getByText('17 words · 2 parts')).toBeTruthy();
		expect(screen.getByText('He makes me lie down in green pastures.')).toBeTruthy();
	});

	it('says so when a passage is not there', async () => {
		open('/passage/no-such-id');
		expect(await screen.findByRole('heading', { name: 'Not in your library' })).toBeTruthy();
	});
});
