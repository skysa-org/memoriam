import { ROOT } from '@memoriam/core';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { DatabaseProvider, useDb } from '../src/store/database.js';
import { db } from '../src/store/db.js';
import { usePassage } from '../src/store/hooks.js';
import { createPassage } from '../src/store/passages.js';
import { over } from './support/database.js';
import { freshDatabase } from './support/db.js';

/**
 * The database a component reads: the one the provider above it names, and the
 * app's own where none does.
 */

const passage = (title: string) => ({
	title,
	reference: '',
	collection: ROOT,
	text: 'Jesus wept.',
});

describe('the database a component is drawn over', () => {
	it('is the app’s own outside a provider', () => {
		const { result } = renderHook(useDb);

		expect(result.current).toBe(db);
	});

	it('is the provider’s, for the store’s hooks as well', async () => {
		const own = freshDatabase();
		const theirs = await createPassage(own, passage('Theirs'));

		const { result } = renderHook(
			() => ({ db: useDb(), passage: usePassage(theirs.id) }),
			over(own)
		);

		expect(result.current.db).toBe(own);
		await waitFor(() => {
			expect(result.current.passage?.title).toBe('Theirs');
		});
		expect(await db.notes.count()).toBe(0);
	});

	it('is never read from the one before, where the provider is given another', async () => {
		const first = freshDatabase();
		const second = freshDatabase();
		const row = await createPassage(first, passage('First'));
		await second.notes.put({ ...row, title: 'Second' });
		const current = { db: first };
		const { result, rerender } = renderHook(() => usePassage(row.id)?.title, {
			wrapper: ({ children }: { children: ReactNode }) => (
				<DatabaseProvider db={current.db}>{children}</DatabaseProvider>
			),
		});
		await waitFor(() => {
			expect(result.current).toBe('First');
		});

		current.db = second;
		rerender();

		expect(result.current).toBeUndefined();
		await waitFor(() => {
			expect(result.current).toBe('Second');
		});
	});
});
