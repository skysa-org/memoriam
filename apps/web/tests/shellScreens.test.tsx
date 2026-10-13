import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '../src/router.js';
import { db } from '../src/store/db.js';
import { createPassage, rowFor } from '../src/store/passages.js';

/**
 * What the shell adds around the screens: the command palette, the reminder
 * to back up, and asking the browser to keep the library.
 */

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
	vi.restoreAllMocks();
	Reflect.deleteProperty(navigator, 'storage');
});

describe('the command palette', () => {
	it('opens with Mod+K, and goes where it is asked', async () => {
		const user = userEvent.setup();
		open('/');
		await screen.findByRole('heading', { name: 'Today' });

		await user.keyboard('{Control>}k{/Control}');
		const field = await screen.findByRole('combobox', { name: 'Search commands' });
		expect(screen.getByRole('option', { name: /Show all commands/ }).textContent).toContain(
			'Ctrl+K'
		);
		await user.type(field, 'library');
		await user.keyboard('{Enter}');

		expect(await screen.findByRole('heading', { name: 'Library' })).toBeTruthy();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('offers what can be done with the passage open', async () => {
		const passage = await createPassage(db, {
			title: 'Jesus wept',
			reference: '',
			collection: '',
			text: 'Jesus wept.\n',
		});
		const user = userEvent.setup();
		const router = open(`/passage/${passage.id}`);
		await screen.findByRole('heading', { name: 'Jesus wept' });

		await user.keyboard('{Control>}k{/Control}');
		await user.type(await screen.findByRole('combobox'), 'practise this');
		await user.keyboard('{Enter}');

		await waitFor(() => {
			expect(router.state.location.pathname).toBe(`/practice/${passage.id}`);
		});
	});
});

describe('the reminder to back up', () => {
	it('shows on Today a week after the first passage, and is put off', async () => {
		await db.notes.put(
			rowFor({
				connectionId: 'local',
				id: 'a',
				path: 'a.md',
				source: '---\ntitle: Jesus wept\n---\n\nJesus wept.\n',
				createdAt: Date.now() - 8 * 86_400_000,
				updatedAt: Date.now() - 8 * 86_400_000,
			})
		);
		const user = userEvent.setup();
		open('/');

		const reminder = await screen.findByRole('complementary', { name: 'Backup' });
		expect(reminder.textContent).toContain('kept only in this browser');
		await user.click(screen.getByRole('button', { name: 'Not now' }));
		await waitFor(() => {
			expect(screen.queryByRole('complementary', { name: 'Backup' })).toBeNull();
		});
	});
});

describe('keeping the library', () => {
	it('says when the browser may clear it, and asks again on request', async () => {
		const persist = vi.fn(() => Promise.resolve(false));
		Object.defineProperty(navigator, 'storage', {
			configurable: true,
			value: { persist, persisted: () => Promise.resolve(false) },
		});
		const user = userEvent.setup();
		open('/settings');

		await user.click(await screen.findByRole('button', { name: 'Ask the browser to keep it' }));
		expect(await screen.findByText(/has not agreed yet/)).toBeTruthy();
		expect(persist).toHaveBeenCalledOnce();
	});

	it('says when the browser has agreed', async () => {
		Object.defineProperty(navigator, 'storage', {
			configurable: true,
			value: { persist: vi.fn(), persisted: () => Promise.resolve(true) },
		});
		open('/settings');
		expect(await screen.findByText(/has agreed to keep your library/)).toBeTruthy();
	});
});
