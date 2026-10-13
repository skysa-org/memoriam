import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readZip } from '../src/archive/readZip.js';
import { createAppRouter } from '../src/router.js';
import { db } from '../src/store/db.js';
import { createPassage } from '../src/store/passages.js';

/**
 * Backup on the Settings screen: the library saved as a ZIP, and files
 * brought in, with what came of it said in words.
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
	vi.restoreAllMocks();
});

describe('Backup', () => {
	it('saves the library as a ZIP, and says what it is called', async () => {
		const psalm = await createPassage(db, {
			title: 'Psalm 23',
			reference: '',
			collection: 'Psalms',
			text: 'The Lord is my shepherd; I shall not want.\n',
		});
		const blobs: Blob[] = [];
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			blobs.push(blob as Blob);
			return 'blob:backup';
		});
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
		const clicked = vi
			.spyOn(HTMLAnchorElement.prototype, 'click')
			.mockImplementation(() => undefined);
		const user = userEvent.setup();
		open('/settings');

		await user.click(await screen.findByRole('button', { name: 'Export a backup' }));
		expect(
			(await screen.findByText(/^Saved as memoriam-\d{4}-\d{2}-\d{2}\.zip\.$/)).closest(
				'[role="status"]'
			)
		).toBeTruthy();
		expect(clicked).toHaveBeenCalledOnce();
		const archive = await readZip(await (blobs[0] ?? new Blob()).arrayBuffer());
		expect(archive.ok && archive.entries.map((entry) => entry.name)).toEqual([psalm.path]);
	});

	it('brings in the files chosen, and says what came of each', async () => {
		const user = userEvent.setup();
		open('/settings');

		await user.upload(await screen.findByLabelText('Import'), [
			new File(['Jesus wept.\n'], 'Jesus wept.txt', { type: 'text/plain' }),
			new File(['Rejoice always.\n'], 'Rejoice.md', { type: 'text/markdown' }),
			new File([new Uint8Array([0xff])], 'broken.md', { type: 'text/markdown' }),
		]);

		const status = await screen.findByText('2 passages added.');
		expect(status.closest('[role="status"]')?.textContent).toContain(
			'These could not be read, and were left out: broken.md.'
		);
		await waitFor(async () => {
			expect((await db.notes.toArray()).map((row) => row.title).sort()).toEqual([
				'Jesus wept',
				'Rejoice',
			]);
		});
	});
});
