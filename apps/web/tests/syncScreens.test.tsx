import { conflictContent, conflictPath, ROOT } from '@memoriam/core';
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiClient, type Connection, type Result } from '../src/api/client.js';
import { SyncKeeper } from '../src/components/SyncKeeper.js';
import { SyncSettings } from '../src/components/SyncSettings.js';
import { createAppRouter } from '../src/router.js';
import { bindLibrary, boundConnection } from '../src/store/connection.js';
import {
	beginConnect,
	keepCredential,
	newCredential,
	pendingCredential,
} from '../src/store/credentials.js';
import { createDatabase, db, type MemoriamDatabase, type NoteRecord } from '../src/store/db.js';
import { createPassage, passageText, rowFor } from '../src/store/passages.js';
import { type ConnectOutcome } from '../src/sync/connectReturn.js';
import { type SchedulerStatus } from '../src/sync/scheduler.js';

/**
 * Sync on the Settings screen — connecting, how it stands, letting it go —
 * and the screen for passages changed in two places at once.
 */

const unused = (): Promise<never> => Promise.reject(new Error('not expected in this test'));

const CONNECTION: Connection = {
	id: 'c1',
	provider: 'dropbox',
	displayName: 'Ann',
	accountId: 'account-1',
	createdAt: 0,
	lastUsedAt: null,
	grantId: 'grant-1',
};

interface Fakes {
	readonly config: ReturnType<typeof vi.fn<ApiClient['config']>>;
	readonly startConnect: ReturnType<typeof vi.fn<ApiClient['startConnect']>>;
	readonly signOut: ReturnType<typeof vi.fn<ApiClient['signOut']>>;
	readonly client: ApiClient;
}

const fakes = (answer: Result<Connection> = { ok: true, value: CONNECTION }): Fakes => {
	const config = vi.fn<ApiClient['config']>(() =>
		Promise.resolve({ providers: ['dropbox', 'gdrive'] })
	);
	const startConnect = vi.fn<ApiClient['startConnect']>(() =>
		Promise.resolve({ ok: true, value: 'https://provider.example/consent' })
	);
	const signOut = vi.fn<ApiClient['signOut']>(() =>
		Promise.resolve({ ok: true, value: { disconnected: true } })
	);
	const client: ApiClient = {
		config,
		connection: () => Promise.resolve(answer),
		grants: unused,
		revokeGrant: unused,
		signOut,
		token: unused,
		startConnect,
		withCredential: () => client,
	};
	return { config, startConnect, signOut, client };
};

/** A scheduler that says one thing. The same object each time, as a store's snapshot must be. */
const schedulerShowing = (status: Partial<SchedulerStatus> = {}) => {
	const said: SchedulerStatus = { phase: 'idle', conflicts: [], ...status };
	return {
		status: () => said,
		subscribe: () => () => undefined,
		syncNow: vi.fn(() => Promise.resolve()),
	};
};

const holding = (outcome?: ConnectOutcome) => {
	const held = new Map<'outcome', ConnectOutcome>(
		outcome === undefined ? [] : [['outcome', outcome]]
	);
	return {
		peek: () => held.get('outcome'),
		forget: vi.fn(() => {
			held.delete('outcome');
		}),
	};
};

let database: MemoriamDatabase;

beforeEach(() => {
	database = createDatabase(`sync-screens-${crypto.randomUUID()}`);
});

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	await database.delete();
});

const showSettings = (props: Parameters<typeof SyncSettings>[0]) => {
	const rootRoute = createRootRoute({
		component: () => <SyncSettings database={database} {...props} />,
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ['/'] }),
	});
	render(<RouterProvider router={router} />);
};

const bound = async () => {
	await keepCredential(database, 'c1', {
		id: 'c1',
		credential: newCredential(),
		provider: 'dropbox',
		createdAt: 1,
	});
	await bindLibrary(database, { connectionId: 'c1', provider: 'dropbox', displayName: 'Ann' });
};

describe('connecting', () => {
	it('offers the providers the server can connect, and leaves for the one chosen', async () => {
		const { client, startConnect } = fakes();
		const leave = vi.fn();
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding(), leave });

		await user.click(await screen.findByRole('button', { name: 'Connect Dropbox' }));

		expect(screen.getByRole('button', { name: 'Connect Google Drive' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Connect OneDrive' })).toBeNull();
		await waitFor(() => {
			expect(leave).toHaveBeenCalledWith('https://provider.example/consent');
		});
		// Written down before the browser leaves: the one thing that cannot wait.
		const pending = await pendingCredential(database);
		expect(pending?.provider).toBe('dropbox');
		expect(startConnect).toHaveBeenCalledWith('dropbox', expect.any(String), '/');
	});

	it('says so when the server cannot be reached', async () => {
		const { client, config } = fakes();
		config.mockRejectedValue(new TypeError('Failed to fetch'));
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		expect(
			await screen.findByText('Sync is not available here: the server could not be reached.')
		).toBeTruthy();
	});

	it('says so when the server will not start, and stays', async () => {
		const { client, startConnect } = fakes();
		startConnect.mockResolvedValue({ ok: false, refusal: 'forbidden_origin' });
		const leave = vi.fn();
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding(), leave });

		await user.click(await screen.findByRole('button', { name: 'Connect Dropbox' }));

		expect(
			await screen.findByText('The server would not start connecting Dropbox.')
		).toBeTruthy();
		expect(leave).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Connect Dropbox' })).toHaveProperty(
			'disabled',
			false
		);
	});

	it('says how connecting went, once', async () => {
		const { client } = fakes();
		const held = holding('denied');
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: held });

		expect(
			await screen.findByText(
				'Nothing was connected: the storage provider was not given access.'
			)
		).toBeTruthy();
		await waitFor(() => {
			expect(held.forget).toHaveBeenCalled();
		});
		expect(held.peek()).toBeUndefined();
	});
});

describe('connected', () => {
	it('names the account, says how syncing stands, and syncs when asked', async () => {
		await bound();
		const { client } = fakes();
		const scheduler = schedulerShowing({ phase: 'syncing' });
		const user = userEvent.setup();
		showSettings({ client, scheduler, connectReturn: holding() });

		expect(await screen.findByText('Syncing with Dropbox as Ann.')).toBeTruthy();
		expect(screen.getByText('Syncing…')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Sync now' })).toHaveProperty('disabled', true);
		cleanup();

		const offline = schedulerShowing({ phase: 'offline' });
		showSettings({ client, scheduler: offline, connectReturn: holding() });
		await user.click(await screen.findByRole('button', { name: 'Sync now' }));
		expect(offline.syncNow).toHaveBeenCalledOnce();
		expect(screen.getByText(/^Offline\./)).toBeTruthy();
	});

	it('asks for the provider again when it has to be', async () => {
		await bound();
		const { client, startConnect } = fakes();
		const leave = vi.fn();
		const user = userEvent.setup();
		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'attention', refusal: 'reauthorize_required' }),
			connectReturn: holding(),
			leave,
		});

		expect(
			await screen.findByText(
				'Dropbox needs to be connected again before your library can sync.'
			)
		).toBeTruthy();
		await user.click(screen.getByRole('button', { name: 'Connect again' }));
		await waitFor(() => {
			expect(leave).toHaveBeenCalled();
		});
		expect(startConnect).toHaveBeenCalledWith('dropbox', expect.any(String), '/');
	});

	it('disconnects on the server, then here, keeping every passage', async () => {
		await bound();
		await createPassage(database, {
			title: 'Psalm 23',
			reference: '',
			collection: ROOT,
			text: 'The Lord is my shepherd.\n',
		});
		const { client, signOut } = fakes();
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
		const dialog = await screen.findByRole('alertdialog', {
			name: 'Stop syncing with Dropbox?',
		});
		await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

		expect(await screen.findByText('Disconnected. Your passages are still here.')).toBeTruthy();
		expect(signOut).toHaveBeenCalledOnce();
		expect(await boundConnection(database)).toBeUndefined();
		expect(await database.notes.count()).toBe(1);
		expect(await screen.findByRole('button', { name: 'Connect Dropbox' })).toBeTruthy();
	});

	it('offers to stop syncing here alone when the server cannot be reached', async () => {
		await bound();
		const { client, signOut } = fakes();
		signOut.mockRejectedValue(new TypeError('Failed to fetch'));
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
		const dialog = await screen.findByRole('alertdialog');
		await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

		expect(await screen.findByRole('alert')).toHaveProperty(
			'textContent',
			expect.stringContaining('The server could not be reached.')
		);
		expect(await boundConnection(database)).toBeDefined();
		await user.click(screen.getByRole('button', { name: 'Stop syncing on this device' }));
		await waitFor(async () => {
			expect(await boundConnection(database)).toBeUndefined();
		});
	});
});

describe('keeping the binding in step', () => {
	it('takes up the connection a flow just consented to', async () => {
		await beginConnect(database, 'dropbox');
		const { client } = fakes();
		render(<SyncKeeper database={database} client={client} scheduler={schedulerShowing()} />);

		await waitFor(async () => {
			expect((await boundConnection(database))?.connectionId).toBe('c1');
		});
		expect(await pendingCredential(database)).toBeUndefined();
	});

	it('lets the library go when its credential reaches nothing, keeping every passage', async () => {
		await bound();
		await createPassage(database, {
			title: 'Psalm 23',
			reference: '',
			collection: ROOT,
			text: 'The Lord is my shepherd.\n',
		});
		const { client } = fakes({ ok: false, refusal: 'credential_revoked' });
		render(
			<SyncKeeper
				database={database}
				client={client}
				scheduler={schedulerShowing({ phase: 'attention', refusal: 'credential_revoked' })}
			/>
		);

		await waitFor(async () => {
			expect(await boundConnection(database)).toBeUndefined();
		});
		expect(await database.notes.count()).toBe(1);
	});

	it('keeps the binding when the server cannot be reached', async () => {
		await bound();
		const { client } = fakes();
		const unreachable = {
			...client,
			withCredential: () => ({ ...client, connection: unused }),
		};
		render(
			<SyncKeeper database={database} client={unreachable} scheduler={schedulerShowing()} />
		);

		await new Promise((settle) => setTimeout(settle, 20));
		expect(await boundConnection(database)).toBeDefined();
	});
});

describe('the conflicts screen', () => {
	const open = (path: string) => {
		const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
		render(<RouterProvider router={router} />);
		return router;
	};

	beforeEach(async () => {
		await db.notes.clear();
		await db.folders.clear();
		await db.opQueue.clear();
	});

	const conflict = async (): Promise<{ original: NoteRecord; copy: NoteRecord }> => {
		const original = await createPassage(db, {
			title: 'Psalm 23',
			reference: '',
			collection: ROOT,
			text: 'The Lord is my shepherd;\nI shall not want.\n',
		});
		const id = crypto.randomUUID();
		const copy = rowFor({
			id,
			connectionId: 'local',
			path: conflictPath(original.path, new Date('2026-10-13T14:32:00Z')),
			source: conflictContent(
				original.source.replace('I shall not want.', 'I lack nothing.'),
				id
			),
			createdAt: original.createdAt,
			updatedAt: original.updatedAt,
		});
		await db.notes.add(copy);
		return { original, copy };
	};

	it('is announced in the Library', async () => {
		await conflict();
		const user = userEvent.setup();
		const router = open('/library');

		expect(
			await screen.findByText(
				'A passage was changed in two places at once, and both versions are kept.'
			)
		).toBeTruthy();
		await user.click(screen.getByRole('link', { name: 'Choose which to keep' }));
		expect(router.state.location.pathname).toBe('/conflicts');
	});

	it('shows both versions with the lines that differ marked', async () => {
		await conflict();
		open('/conflicts');

		const section = await screen.findByRole('region', { name: 'Psalm 23' });
		const marked = [...section.querySelectorAll('mark')].map((mark) => mark.textContent.trim());
		expect(marked).toEqual(['I shall not want.', 'I lack nothing.']);
	});

	it('keeps the copy’s version in the original’s place, and takes it back', async () => {
		const { original, copy } = await conflict();
		const user = userEvent.setup();
		open('/conflicts');

		const section = await screen.findByRole('region', { name: 'Psalm 23' });
		const [, keepCopy] = within(section).getAllByRole('button', { name: 'Keep this version' });
		await user.click(keepCopy as HTMLElement);

		expect(
			await screen.findByText('Nothing to choose between: every passage has one version.')
		).toBeTruthy();
		const kept = await db.notes.get(['local', original.id]);
		expect(passageText(kept?.source ?? '')).toContain('I lack nothing.');
		expect(await db.notes.get(['local', copy.id])).toBeUndefined();

		await user.click(await screen.findByRole('button', { name: 'Undo' }));
		await waitFor(async () => {
			expect((await db.notes.get(['local', original.id]))?.source).toBe(original.source);
		});
		expect(await db.notes.get(['local', copy.id])).toBeDefined();
	});

	it('keeps both, as two passages', async () => {
		const { copy } = await conflict();
		const user = userEvent.setup();
		open('/conflicts');

		await user.click(await screen.findByRole('button', { name: 'Keep both, as two passages' }));

		await waitFor(async () => {
			expect((await db.notes.get(['local', copy.id]))?.title).toBe(
				'Psalm 23 (other version)'
			);
		});
		expect(
			await screen.findByText('Nothing to choose between: every passage has one version.')
		).toBeTruthy();
	});
});
