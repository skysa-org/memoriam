import { conflictContent, conflictPath } from '@memoriam/core';
import {
	type ApiClient,
	ApiError,
	beginConnect,
	type Connection,
	dropConnectCode,
	heldConnectCode,
	holdConnectCode,
	pendingCredential,
	type Result,
	type SchedulerStatus,
} from '@skysa/client';
import type { ConnectGate, EntitlementCode } from '@skysa/protocol';
import { ROOT } from '@skysa/storage';
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncKeeper } from '../src/components/SyncKeeper.js';
import { SyncSettings } from '../src/components/SyncSettings.js';
import { createAppRouter } from '../src/router.js';
import { bindLibrary, boundConnection } from '../src/store/connection.js';
import { db, type MemoriamDatabase, type NoteRecord } from '../src/store/db.js';
import { createPassage, passageText, rowFor } from '../src/store/passages.js';
import type { ConnectOutcome, Returned } from '../src/sync/connectReturn.js';
import { holdCredential } from './support/connection.js';
import { over } from './support/database.js';
import { freshDatabase } from './support/db.js';

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
	readonly checkConnectCode: ReturnType<typeof vi.fn<ApiClient['checkConnectCode']>>;
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
	const checkConnectCode = vi.fn<ApiClient['checkConnectCode']>(unused);
	const client: ApiClient = {
		config,
		connection: () => Promise.resolve(answer),
		grants: unused,
		revokeGrant: unused,
		signOut,
		token: unused,
		startConnect,
		relayTicket: unused,
		checkConnectCode,
		withCredential: () => client,
	};
	return { config, startConnect, signOut, checkConnectCode, client };
};

/** An operator's gate, and the server's fakes with it in `/config`. */
const gated = (gate: Partial<ConnectGate> = {}): Fakes => {
	const made = fakes();
	made.config.mockResolvedValue({
		providers: ['dropbox', 'gdrive'],
		connectGate: {
			message: 'Sync is for members of the reading group.',
			action: { label: 'Join the group', url: 'https://operator.example/join' },
			...gate,
		},
	});
	return made;
};

/** A scheduler that says one thing. The same object each time, as a store's snapshot must be. */
const schedulerShowing = (status: Partial<SchedulerStatus> = {}) => {
	const said: SchedulerStatus = { phase: 'idle', conflicts: [], ...status };
	return {
		status: () => said,
		subscribe: () => () => undefined,
		syncNow: vi.fn(() => Promise.resolve()),
		pause: vi.fn(),
	};
};

const IDLE: SchedulerStatus = { phase: 'idle', conflicts: [] };

/** A scheduler whose status changes when told, telling its subscribers, as the kit's does. */
const schedulerSaying = (first: Partial<SchedulerStatus>) => {
	const said = new Map<'status', SchedulerStatus>([['status', { ...IDLE, ...first }]]);
	const listeners = new Set<(status: SchedulerStatus) => void>();
	return {
		status: () => said.get('status') ?? IDLE,
		subscribe: (listener: (status: SchedulerStatus) => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		syncNow: vi.fn(() => Promise.resolve()),
		pause: vi.fn(),
		say: (status: Partial<SchedulerStatus>) => {
			const now = { ...IDLE, ...status };
			said.set('status', now);
			listeners.forEach((listener) => {
				listener(now);
			});
		},
	};
};

const holding = (outcome?: ConnectOutcome, code?: EntitlementCode) => {
	const held = new Map<'outcome', Returned>(
		outcome === undefined
			? []
			: [['outcome', code === undefined ? { outcome } : { outcome, code }]]
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
	database = freshDatabase();
});

afterEach(() => {
	vi.restoreAllMocks();
	dropConnectCode();
});

const showSettings = (props: Parameters<typeof SyncSettings>[0]) => {
	const rootRoute = createRootRoute({
		component: () => <SyncSettings {...props} />,
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ['/'] }),
	});
	render(<RouterProvider router={router} />, over(database));
};

const bound = async () => {
	await holdCredential(database, 'c1', {
		credential: `sk1_${crypto.randomUUID()}`,
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
		expect(startConnect).toHaveBeenCalledWith('dropbox', expect.any(String), '/', undefined);
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

	it('says why the server’s policy refused a connect, by the kind of no it gave', async () => {
		const { client } = fakes();
		const said: [EntitlementCode | undefined, string][] = [
			[
				'not_allowed',
				'Nothing was connected: this account is not allowed to sync on this server.',
			],
			[
				'lapsed',
				'Nothing was connected: this account’s access to sync on this server has lapsed.',
			],
			[
				'limit_reached',
				'Nothing was connected: this server is at its limit for syncing accounts.',
			],
			[undefined, 'Nothing was connected: this account cannot sync on this server.'],
		];
		await said.reduce(async (prior, [code, words]) => {
			await prior;
			showSettings({
				client,
				scheduler: schedulerShowing(),
				connectReturn: holding('refused', code),
			});
			expect(await screen.findByText(words)).toBeTruthy();
			cleanup();
		}, Promise.resolve());
	});
});

describe('the operator’s gate', () => {
	it('shows its message and link where the buttons were, and the buttons when asked', async () => {
		const { client } = gated();
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		expect(await screen.findByText('Sync is for members of the reading group.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Join the group' })).toHaveProperty(
			'href',
			'https://operator.example/join'
		);
		expect(screen.queryByRole('button', { name: 'Connect Dropbox' })).toBeNull();
		expect(screen.queryByRole('textbox')).toBeNull();

		await user.click(screen.getByRole('button', { name: 'Already have access?' }));
		// Where the press was: the button pressed is gone.
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Connect Dropbox' })
		);
	});

	it('takes the code it requires, says why one is turned down, and sends one it took', async () => {
		const { client, checkConnectCode, startConnect } = gated({
			connectCode: { label: 'Invite code', required: true },
		});
		checkConnectCode
			.mockResolvedValueOnce({
				ok: true,
				value: { accepted: false, reason: 'That invite has been used.' },
			})
			.mockResolvedValueOnce({ ok: true, value: { accepted: false } })
			.mockResolvedValueOnce({ ok: true, value: { accepted: true, expiresIn: 600 } });
		const leave = vi.fn();
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding(), leave });

		const field = await screen.findByRole('textbox', { name: 'Invite code' });
		// Required: no way to the buttons but a code.
		expect(screen.queryByRole('button', { name: 'Already have access?' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Connect Dropbox' })).toBeNull();

		await user.type(field, 'USED-1');
		await user.click(screen.getByRole('button', { name: 'Use code' }));
		// The policy's own words where it gave some, and the app's where not.
		expect(await screen.findByText('That invite has been used.')).toBeTruthy();
		await user.clear(field);
		// What was said was about the code before this one.
		expect(screen.queryByText('That invite has been used.')).toBeNull();
		expect(field.getAttribute('aria-invalid')).toBeNull();
		await user.type(field, 'WRONG-2');
		await user.click(screen.getByRole('button', { name: 'Use code' }));
		expect(await screen.findByText('That code was not accepted.')).toBeTruthy();
		await user.clear(field);
		await user.type(field, 'INVITE-7');
		await user.click(screen.getByRole('button', { name: 'Use code' }));

		expect(await screen.findByText(/^Invite code accepted on this device until /)).toBeTruthy();
		expect(checkConnectCode).toHaveBeenLastCalledWith('INVITE-7');
		expect(heldConnectCode()).toBe('INVITE-7');
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Connect Dropbox' })
		);
		await user.click(screen.getByRole('button', { name: 'Connect Dropbox' }));
		await waitFor(() => {
			expect(leave).toHaveBeenCalled();
		});
		expect(startConnect).toHaveBeenCalledWith('dropbox', expect.any(String), '/', 'INVITE-7');
	});

	it('asks for another code when told to, hiding the buttons until one is taken or it is let be', async () => {
		holdConnectCode('INVITE-7', 600);
		const { client } = gated({ connectCode: { label: 'Invite code', required: true } });
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		expect(await screen.findByRole('button', { name: 'Connect Dropbox' })).toBeTruthy();
		await user.click(screen.getByRole('button', { name: 'Use another Invite code' }));

		expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Invite code' }));
		expect(screen.queryByRole('button', { name: 'Connect Dropbox' })).toBeNull();
		// Back to the code held, which is still good.
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.getByRole('button', { name: 'Connect Dropbox' })).toBeTruthy();
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Use another Invite code' })
		);
	});

	it('never has the field and the buttons open together, where a code is not required', async () => {
		const { client, checkConnectCode } = gated({ connectCode: { label: 'Invite code' } });
		checkConnectCode.mockResolvedValue({ ok: true, value: { accepted: true, expiresIn: 600 } });
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		// A connect sends the code held, never what is in the field.
		expect(await screen.findByRole('textbox', { name: 'Invite code' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Connect Dropbox' })).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Already have access?' }));
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Connect Dropbox' })
		);

		await user.click(screen.getByRole('button', { name: 'Have a code? Enter it' }));
		expect(screen.queryByRole('button', { name: 'Connect Dropbox' })).toBeNull();
		const field = screen.getByRole('textbox', { name: 'Invite code' });
		expect(document.activeElement).toBe(field);
		await user.type(field, 'INVITE-7');
		await user.click(screen.getByRole('button', { name: 'Use code' }));
		await user.click(await screen.findByRole('button', { name: 'Use another Invite code' }));

		// Another code, or Cancel back to the one held: not the buttons beside it.
		expect(screen.getByRole('textbox', { name: 'Invite code' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Connect Dropbox' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Already have access?' })).toBeNull();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
	});

	it('leaves the focus on the buttons’ place where there is nothing in it to press', async () => {
		const { client, config } = gated();
		config.mockResolvedValue({
			providers: [],
			connectGate: {
				message: 'Sync is for members of the reading group.',
				action: { label: 'Join the group', url: 'https://operator.example/join' },
			},
		});
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		await user.click(await screen.findByRole('button', { name: 'Already have access?' }));

		expect(document.activeElement).not.toBe(document.body);
		expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
	});

	it('takes neither an edit nor Cancel while the policy is asked about a code', async () => {
		holdConnectCode('INVITE-7', 600);
		const { client, checkConnectCode } = gated({
			connectCode: { label: 'Invite code', required: true },
		});
		const answer = Promise.withResolvers<Awaited<ReturnType<ApiClient['checkConnectCode']>>>();
		checkConnectCode.mockReturnValue(answer.promise);
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		await user.click(await screen.findByRole('button', { name: 'Use another Invite code' }));
		const field = screen.getByRole('textbox', { name: 'Invite code' });
		await user.type(field, 'INVITE-8');
		await user.click(screen.getByRole('button', { name: 'Use code' }));

		expect(await screen.findByRole('button', { name: 'Checking…' })).toBeTruthy();
		expect(field.hasAttribute('readonly')).toBe(true);
		expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
		answer.resolve({ ok: true, value: { accepted: true, expiresIn: 600 } });
		expect(await screen.findByRole('button', { name: 'Connect Dropbox' })).toBeTruthy();
		expect(heldConnectCode()).toBe('INVITE-8');
	});

	it('says what went wrong asking about a code', async () => {
		const { client, checkConnectCode } = gated({ connectCode: { label: 'Invite code' } });
		checkConnectCode
			.mockResolvedValueOnce({ ok: false, refusal: 'forbidden_origin' })
			.mockRejectedValueOnce(new ApiError('too many', 429))
			.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		const user = userEvent.setup();
		showSettings({ client, scheduler: schedulerShowing(), connectReturn: holding() });

		const field = await screen.findByRole('textbox', { name: 'Invite code' });
		await user.type(field, 'INVITE-7');
		await user.click(screen.getByRole('button', { name: 'Use code' }));
		const notChecked =
			'The code could not be checked. Check that you are online, and try again.';
		expect(await screen.findByText(notChecked)).toBeTruthy();
		expect(field.getAttribute('aria-invalid')).toBe('true');
		await user.click(screen.getByRole('button', { name: 'Use code' }));
		expect(
			await screen.findByText(
				'Too many codes have been tried from here. Wait a while, and try again.'
			)
		).toBeTruthy();
		await user.click(screen.getByRole('button', { name: 'Use code' }));
		expect(await screen.findByText(notChecked)).toBeTruthy();
		expect(checkConnectCode).toHaveBeenCalledTimes(3);
		// Not required: the buttons are still a press away.
		expect(screen.getByRole('button', { name: 'Already have access?' })).toBeTruthy();
		expect(heldConnectCode()).toBeUndefined();
	});

	it('says a refused connect made with a typed code was about the code, and lets it go', async () => {
		holdConnectCode('INVITE-7', 600);
		const { client } = gated({ connectCode: { label: 'Invite code', required: true } });
		showSettings({
			client,
			scheduler: schedulerShowing(),
			connectReturn: holding('refused', 'not_allowed'),
		});

		expect(
			await screen.findByText('Nothing was connected: the code you entered was not accepted.')
		).toBeTruthy();
		expect(await screen.findByRole('textbox', { name: 'Invite code' })).toBeTruthy();
		expect(heldConnectCode()).toBeUndefined();
	});

	it('keeps a typed code through a refusal that is not about it', async () => {
		holdConnectCode('INVITE-7', 600);
		const { client } = gated({ connectCode: { label: 'Invite code', required: true } });
		showSettings({
			client,
			scheduler: schedulerShowing(),
			connectReturn: holding('refused', 'limit_reached'),
		});

		expect(
			await screen.findByText(
				'Nothing was connected: this server is at its limit for syncing accounts.'
			)
		).toBeTruthy();
		expect(heldConnectCode()).toBe('INVITE-7');
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

		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'syncing', waiting: true }),
			connectReturn: holding(),
		});
		expect(
			await screen.findByText(
				'Waiting for another tab or window of Memoriam to finish syncing. This one syncs after it.'
			)
		).toBeTruthy();
		cleanup();

		const offline = schedulerShowing({ phase: 'offline' });
		showSettings({ client, scheduler: offline, connectReturn: holding() });
		await user.click(await screen.findByRole('button', { name: 'Sync now' }));
		expect(offline.syncNow).toHaveBeenCalledOnce();
		expect(screen.getByText(/^Offline\./)).toBeTruthy();
	});

	it('says what a sync is reading, and how far a long one has got', async () => {
		// Reported in skysa-notes, on a phone: another device's folders moved
		// was minutes of plain "Syncing…" while the round's pages were read.
		await bound();
		const { client } = fakes();
		const showing = async (progress: SchedulerStatus['progress'], said: string) => {
			showSettings({
				client,
				scheduler: schedulerShowing({ phase: 'syncing', progress }),
				connectReturn: holding(),
			});
			expect(await screen.findByText(said)).toBeTruthy();
			cleanup();
		};

		await showing(
			{ stage: 'receiving', done: 0, total: 0, listing: true },
			'Checking Dropbox for changes…'
		);
		// A few is not worth counting: an edit's sync would flash a number.
		await showing(
			{ stage: 'receiving', done: 0, total: 3, listing: true },
			'Checking Dropbox for changes…'
		);
		await showing(
			{ stage: 'receiving', done: 0, total: 40, listing: true },
			'Checking Dropbox for changes: 40 changed passages found so far.'
		);
		await showing(
			{ stage: 'receiving', done: 12, total: 40, listing: false, path: 'a.md' },
			'Receiving passages from Dropbox: 12 of 40.'
		);
		await showing({ stage: 'receiving', done: 1, total: 3, listing: false }, 'Syncing…');
		await showing(
			{ stage: 'scanning', found: 0, done: 0, listing: true },
			'Looking for passages in Dropbox…'
		);
		await showing(
			{ stage: 'scanning', found: 25, done: 0, listing: true },
			'Looking for passages in Dropbox: 25 found so far.'
		);
		await showing(
			{ stage: 'scanning', found: 25, done: 5, listing: false },
			'Receiving passages from Dropbox: 5 of 25.'
		);
		await showing(
			{ stage: 'uploading', done: 2, total: 30 },
			'Sending changes to Dropbox: 2 of 30.'
		);
	});

	it('pauses a sync under way, and resumes it when asked', async () => {
		await bound();
		const { client } = fakes();
		const user = userEvent.setup();
		const syncing = schedulerShowing({
			phase: 'syncing',
			progress: {
				stage: 'receiving',
				done: 12,
				total: 40,
				listing: false,
				path: 'Psalms/23.md',
			},
		});
		showSettings({ client, scheduler: syncing, connectReturn: holding() });

		// A long run's bar, and the file it is on.
		const bar = await screen.findByRole('progressbar', { name: 'Sync progress' });
		expect(bar.getAttribute('value')).toBe('12');
		expect(bar.getAttribute('max')).toBe('40');
		expect(screen.getByText('Psalms/23.md', { exact: false })).toBeTruthy();
		await user.click(screen.getByRole('button', { name: 'Pause syncing' }));
		expect(syncing.pause).toHaveBeenCalledOnce();
		cleanup();

		const paused = schedulerShowing({ phase: 'paused' });
		showSettings({ client, scheduler: paused, connectReturn: holding() });
		expect(
			await screen.findByText(
				'Syncing with Dropbox is paused on this device. Your changes are kept here, and sent when you resume it.'
			)
		).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Pause syncing' })).toBeNull();
		expect(screen.queryByRole('progressbar')).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Resume syncing' }));
		expect(paused.syncNow).toHaveBeenCalledOnce();
	});

	it('draws no bar for a sync of a few passages', async () => {
		await bound();
		const { client } = fakes();
		showSettings({
			client,
			scheduler: schedulerShowing({
				phase: 'syncing',
				progress: { stage: 'uploading', done: 1, total: 3, path: 'a.md' },
			}),
			connectReturn: holding(),
		});

		expect(await screen.findByText('Syncing…')).toBeTruthy();
		expect(screen.queryByRole('progressbar')).toBeNull();
		expect(screen.getByRole('button', { name: 'Pause syncing' })).toBeTruthy();
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

		const said = await screen.findByText(
			'Dropbox needs to be connected again before your library can sync.'
		);
		// In the colour of an error: sync has stopped until it is.
		expect(said.classList.contains('sync-problem')).toBe(true);
		await user.click(screen.getByRole('button', { name: 'Connect again' }));
		await waitFor(() => {
			expect(leave).toHaveBeenCalled();
		});
		expect(startConnect).toHaveBeenCalledWith('dropbox', expect.any(String), '/', undefined);
	});

	it('asks for the provider again for every problem connecting again answers, and for none other', async () => {
		await bound();
		const { client } = fakes();
		const reconnecting: Partial<SchedulerStatus>[] = [
			{ phase: 'attention', refusal: 'credential_required' },
			{ phase: 'attention', refusal: 'credential_revoked' },
			// The provider refused a fresh token too (the engine's `paused`).
			{ phase: 'attention', error: 'authorization required' },
		];
		await reconnecting.reduce(async (prior, status) => {
			await prior;
			showSettings({ client, scheduler: schedulerShowing(status), connectReturn: holding() });
			expect(await screen.findByRole('button', { name: 'Connect again' })).toBeTruthy();
			cleanup();
		}, Promise.resolve());

		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'attention', error: 'quota' }),
			connectReturn: holding(),
		});
		const said = await screen.findByText('Sync needs attention: quota');
		expect(said.classList.contains('sync-problem')).toBe(false);
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
	});

	it('offers the operator’s code beside Connect again, never in front of it, and connects with one it took', async () => {
		await bound();
		// Required where a library is connected first; beside Connect again, only offered.
		const { client, checkConnectCode, startConnect } = gated({
			connectCode: { label: 'Invite code', required: true },
		});
		checkConnectCode.mockResolvedValue({ ok: true, value: { accepted: true, expiresIn: 600 } });
		const leave = vi.fn();
		const user = userEvent.setup();
		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'attention', refusal: 'reauthorize_required' }),
			connectReturn: holding(),
			leave,
		});

		await user.click(await screen.findByRole('button', { name: 'Have a code? Enter it' }));
		// The account was let in once: no message and no link.
		expect(screen.queryByText('Sync is for members of the reading group.')).toBeNull();
		expect(screen.queryByRole('link')).toBeNull();
		// A connect sends the code held, never what is in the field.
		expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Invite code' }));
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Have a code? Enter it' })
		);

		await user.click(screen.getByRole('button', { name: 'Have a code? Enter it' }));
		await user.type(screen.getByRole('textbox', { name: 'Invite code' }), 'INVITE-7');
		await user.click(screen.getByRole('button', { name: 'Use code' }));
		expect(await screen.findByText(/^Invite code accepted on this device until /)).toBeTruthy();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Connect again' }));

		// Another, or Cancel back to the one held.
		await user.click(screen.getByRole('button', { name: 'Use another Invite code' }));
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		expect(document.activeElement).toBe(
			screen.getByRole('button', { name: 'Use another Invite code' })
		);
		await user.click(screen.getByRole('button', { name: 'Connect again' }));
		await waitFor(() => {
			expect(leave).toHaveBeenCalled();
		});
		expect(startConnect).toHaveBeenCalledWith('dropbox', expect.any(String), '/', 'INVITE-7');
	});

	it('offers Connect again alone where the operator’s gate asks for no code', async () => {
		await bound();
		const { client, config } = gated();
		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'attention', refusal: 'credential_revoked' }),
			connectReturn: holding(),
		});

		expect(await screen.findByRole('button', { name: 'Connect again' })).toBeTruthy();
		// Once /config has answered.
		await act(async () => {
			await config.mock.results[0]?.value;
		});
		expect(screen.queryByRole('button', { name: 'Have a code? Enter it' })).toBeNull();
		expect(screen.queryByText('Sync is for members of the reading group.')).toBeNull();
	});

	it('keeps a code half typed beside Connect again through the runs that go on meanwhile', async () => {
		await bound();
		const { client } = gated({ connectCode: { label: 'Invite code' } });
		const reauthorize: Partial<SchedulerStatus> = {
			phase: 'attention',
			refusal: 'reauthorize_required',
		};
		const scheduler = schedulerSaying(reauthorize);
		const user = userEvent.setup();
		showSettings({ client, scheduler, connectReturn: holding() });

		await user.click(await screen.findByRole('button', { name: 'Have a code? Enter it' }));
		await user.type(screen.getByRole('textbox', { name: 'Invite code' }), 'INVITE');
		// The window's focus starts a run, which the provider refuses again.
		act(() => {
			scheduler.say({ phase: 'syncing' });
		});
		// Said as it is, and not in the colour of an error.
		expect(screen.getByText('Syncing…').classList.contains('sync-problem')).toBe(false);
		expect(screen.getByRole('textbox', { name: 'Invite code' })).toHaveProperty(
			'value',
			'INVITE'
		);
		act(() => {
			scheduler.say(reauthorize);
		});
		expect(screen.getByRole('textbox', { name: 'Invite code' })).toHaveProperty(
			'value',
			'INVITE'
		);
		// Connect again stays through a run as well.
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		act(() => {
			scheduler.say({ phase: 'syncing' });
		});
		expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();

		// A run that ended any other way: nothing to connect again.
		act(() => {
			scheduler.say({ phase: 'idle' });
		});
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Have a code? Enter it' })).toBeNull();
		act(() => {
			scheduler.say({ phase: 'syncing' });
		});
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
	});

	it('leaves the focus on the button beside Connect again as a hold ends', async () => {
		await bound();
		holdConnectCode('INVITE-7', 600);
		const { client } = gated({ connectCode: { label: 'Invite code' } });
		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'attention', refusal: 'reauthorize_required' }),
			connectReturn: holding(),
		});

		const another = await screen.findByRole('button', { name: 'Use another Invite code' });
		another.focus();
		// Let go of in another tab, or by the clock.
		act(() => {
			dropConnectCode();
		});
		expect(screen.getByRole('button', { name: 'Have a code? Enter it' })).toBe(another);
		expect(document.activeElement).toBe(another);
	});

	it('keeps Connect again through a run without a gate, and lets it go for another connection', async () => {
		await bound();
		const scheduler = schedulerSaying({ phase: 'attention', refusal: 'credential_revoked' });
		showSettings({ client: fakes().client, scheduler, connectReturn: holding() });

		expect(await screen.findByRole('button', { name: 'Connect again' })).toBeTruthy();
		act(() => {
			scheduler.say({ phase: 'syncing' });
		});
		expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();

		// Another tab connected again and took up a new connection, whose first
		// run starts at once: nothing kept is about it.
		await database.transaction('rw', database.syncState, async () => {
			const state = await database.syncState.get('c1');
			if (state === undefined) throw new Error('Not bound');
			await database.syncState.delete('c1');
			await database.syncState.add({ ...state, connectionId: 'c2' });
		});
		await waitFor(() => {
			expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
		});
		expect(screen.getByText('Syncing…')).toBeTruthy();
	});

	it('keeps Connect again where it is as the server says it has a gate', async () => {
		await bound();
		const { client, config } = fakes();
		const answers = new Map<'answer', () => void>();
		config.mockReturnValue(
			new Promise((resolve) => {
				answers.set('answer', () => {
					resolve({
						providers: ['dropbox'],
						connectGate: {
							message: 'Sync is for members of the reading group.',
							action: {
								label: 'Join the group',
								url: 'https://operator.example/join',
							},
							connectCode: { label: 'Invite code' },
						},
					});
				});
			})
		);
		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'attention', refusal: 'reauthorize_required' }),
			connectReturn: holding(),
		});

		const again = await screen.findByRole('button', { name: 'Connect again' });
		again.focus();
		await act(async () => {
			answers.get('answer')?.();
			await config.mock.results[0]?.value;
		});
		expect(screen.getByRole('button', { name: 'Have a code? Enter it' })).toBeTruthy();
		// The same button, not one drawn again under the focus.
		expect(screen.getByRole('button', { name: 'Connect again' })).toBe(again);
		expect(document.activeElement).toBe(again);
	});

	it('says why a library bound to a provider this app cannot sync with does not', async () => {
		// The kit's scheduler has no adapter to make for it, and asks for
		// attention without a reason of its own.
		await holdCredential(database, 'c1', { provider: 'webdav' });
		await bindLibrary(database, { connectionId: 'c1', provider: 'webdav' });
		const { client } = fakes();
		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'attention' }),
			connectReturn: holding(),
		});

		expect(
			await screen.findByText('This app cannot sync with this storage provider yet.')
		).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
	});

	it('says why the server’s policy stopped syncing, and offers to connect again behind its gate', async () => {
		await bound();
		const { client, startConnect } = gated();
		const leave = vi.fn();
		const user = userEvent.setup();
		showSettings({
			client,
			scheduler: schedulerShowing({
				phase: 'attention',
				refusal: 'not_entitled',
				denial: { code: 'lapsed', reason: 'Your membership ended on 1 May.' },
			}),
			connectReturn: holding(),
			leave,
		});

		expect(
			await screen.findByText('This account’s access to sync on this server has lapsed.')
		).toBeTruthy();
		expect(screen.getByText('Your membership ended on 1 May.')).toBeTruthy();
		expect(await screen.findByText('Sync is for members of the reading group.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Join the group' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Already have access?' }));
		await user.click(screen.getByRole('button', { name: 'Connect again' }));
		await waitFor(() => {
			expect(leave).toHaveBeenCalled();
		});
		expect(startConnect).toHaveBeenCalledWith('dropbox', expect.any(String), '/', undefined);
		cleanup();

		// The policy's reason without a gate: no link, and Connect again as it is.
		showSettings({
			client: fakes().client,
			scheduler: schedulerShowing({
				phase: 'attention',
				refusal: 'not_entitled',
				denial: { code: 'not_allowed', reason: 'Sync is for the reading group.' },
			}),
			connectReturn: holding(),
		});
		expect(await screen.findByText('Sync is for the reading group.')).toBeTruthy();
		expect(
			screen.getByText('This account is not allowed to sync on this server.')
		).toBeTruthy();
		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.getByRole('button', { name: 'Connect again' })).toBeTruthy();
		cleanup();

		// No code, no reason and no gate: the app's words alone.
		showSettings({
			client: fakes().client,
			scheduler: schedulerShowing({ phase: 'attention', refusal: 'not_entitled' }),
			connectReturn: holding(),
		});
		expect(await screen.findByText('This account cannot sync on this server.')).toBeTruthy();
		expect(screen.queryByRole('link')).toBeNull();
	});

	it('offers to connect again only once the server has said whether it has a gate', async () => {
		await bound();
		const { client, config } = fakes();
		config.mockReturnValue(new Promise<never>(() => undefined));
		showSettings({
			client,
			scheduler: schedulerShowing({ phase: 'attention', refusal: 'not_entitled' }),
			connectReturn: holding(),
		});

		expect(await screen.findByText('This account cannot sync on this server.')).toBeTruthy();
		// A gate that requires a code is not stepped round while /config is asked.
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
	});

	it('keeps a code half typed under a refusal through the runs that go on while refused', async () => {
		await bound();
		const { client } = gated({ connectCode: { label: 'Invite code', required: true } });
		const refusal: Partial<SchedulerStatus> = {
			phase: 'attention',
			refusal: 'not_entitled',
			denial: { code: 'lapsed' },
		};
		const scheduler = schedulerSaying(refusal);
		const user = userEvent.setup();
		showSettings({ client, scheduler, connectReturn: holding() });

		await user.type(await screen.findByRole('textbox', { name: 'Invite code' }), 'INVITE');
		// The window's focus starts a run, which the policy refuses again.
		act(() => {
			scheduler.say({ phase: 'syncing' });
		});
		expect(screen.getByText('Syncing…')).toBeTruthy();
		expect(screen.getByRole('textbox', { name: 'Invite code' })).toHaveProperty(
			'value',
			'INVITE'
		);
		act(() => {
			scheduler.say(refusal);
		});
		expect(screen.getByRole('textbox', { name: 'Invite code' })).toHaveProperty(
			'value',
			'INVITE'
		);

		// A refusal for another reason is the one kept through the next run.
		act(() => {
			scheduler.say({
				...refusal,
				denial: { code: 'lapsed', reason: 'Your membership ended on 1 May.' },
			});
		});
		act(() => {
			scheduler.say({ phase: 'syncing' });
		});
		expect(screen.getByText('Your membership ended on 1 May.')).toBeTruthy();

		// A run the policy let through: nothing refused is left to say.
		act(() => {
			scheduler.say({ phase: 'idle' });
		});
		expect(screen.queryByRole('textbox')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
	});

	it('keeps what stands now, not what stood before, through the next run', async () => {
		await bound();
		const { client } = gated({ connectCode: { label: 'Invite code' } });
		const scheduler = schedulerSaying({ phase: 'attention', refusal: 'not_entitled' });
		showSettings({ client, scheduler, connectReturn: holding() });

		expect(await screen.findByText('Sync is for members of the reading group.')).toBeTruthy();
		// The provider wants the account asked again now, which no gate stands in front of.
		act(() => {
			scheduler.say({ phase: 'attention', refusal: 'reauthorize_required' });
		});
		act(() => {
			scheduler.say({ phase: 'syncing' });
		});
		expect(screen.getByRole('button', { name: 'Have a code? Enter it' })).toBeTruthy();
		expect(screen.queryByText('Sync is for members of the reading group.')).toBeNull();
	});

	it('says nothing of a policy’s refusal under a provider this app cannot sync with', async () => {
		await holdCredential(database, 'c1', { provider: 'webdav' });
		await bindLibrary(database, { connectionId: 'c1', provider: 'webdav' });
		const { client } = gated();
		showSettings({
			client,
			scheduler: schedulerShowing({
				phase: 'attention',
				refusal: 'not_entitled',
				denial: { code: 'lapsed', reason: 'Your membership ended on 1 May.' },
			}),
			connectReturn: holding(),
		});

		expect(
			await screen.findByText('This app cannot sync with this storage provider yet.')
		).toBeTruthy();
		expect(screen.queryByText('Your membership ended on 1 May.')).toBeNull();
		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Connect again' })).toBeNull();
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
		render(<SyncKeeper client={client} scheduler={schedulerShowing()} />, over(database));

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
				client={client}
				scheduler={schedulerShowing({ phase: 'attention', refusal: 'credential_revoked' })}
			/>,
			over(database)
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
		render(<SyncKeeper client={unreachable} scheduler={schedulerShowing()} />, over(database));

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
