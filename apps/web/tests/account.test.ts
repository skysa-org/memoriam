import { createHash } from 'node:crypto';

import { ROOT } from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ApiClient, type Connection, type Refusal, type Result } from '../src/api/client.js';
import {
	bindingCount,
	bindLibrary,
	boundConnection,
	rememberAccount,
	unbindLibrary,
	updateBinding,
} from '../src/store/connection.js';
import {
	beginConnect,
	credentialFor,
	forgetCredential,
	hashCredential,
	heldCredentials,
	keepCredential,
	newCredential,
	pendingCredential,
} from '../src/store/credentials.js';
import {
	createDatabase,
	isLive,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	PENDING_CREDENTIAL_ID,
} from '../src/store/db.js';
import { createPassage } from '../src/store/passages.js';
import {
	claimConnection,
	disconnectAccount,
	reconcileAccount,
	startConnecting,
	stopSyncingHere,
} from '../src/sync/account.js';

/**
 * Connecting, and the server's word on the connection the library is bound to
 * (docs/ARCHITECTURE.md §10, "The sync client"): the credential written down
 * before the browser leaves, the library bound when it comes back, and let go
 * on a definite answer and nothing else.
 */

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`account-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

const connectionNamed = (id: string, overrides: Partial<Connection> = {}): Connection => ({
	id,
	provider: 'dropbox',
	displayName: 'Ann',
	accountId: `account-${id}`,
	createdAt: 0,
	lastUsedAt: null,
	grantId: `grant-${id}`,
	...overrides,
});

/** What a fake server answers a credential, and everything it was asked. */
interface Server {
	/** Credential → what `/connection` answers it. */
	readonly answers: Map<string, Result<Connection> | Error>;
	readonly calls: string[];
	readonly signOutAnswer: Map<'answer', Result<{ disconnected: boolean }>>;
}

const newServer = (): Server => ({ answers: new Map(), calls: [], signOutAnswer: new Map() });

const refused = (refusal: Refusal): Result<never> => ({ ok: false, refusal });

const unused = (): Promise<never> => Promise.reject(new Error('not expected in this test'));

const clientFor = (server: Server, credential?: string): ApiClient => {
	const answer = (): Promise<Result<Connection>> => {
		const said = server.answers.get(credential ?? '') ?? refused('credential_required');
		return said instanceof Error ? Promise.reject(said) : Promise.resolve(said);
	};
	return {
		config: unused,
		connection: () => {
			server.calls.push(`connection ${credential ?? '-'}`);
			return answer();
		},
		grants: unused,
		revokeGrant: (grantId) => {
			server.calls.push(`revoke ${grantId} with ${credential ?? '-'}`);
			return Promise.resolve({ ok: true, value: { ok: true } });
		},
		signOut: async () => {
			server.calls.push(`sign out ${credential ?? '-'}`);
			const seen = await answer();
			if (!seen.ok) return seen;
			return (
				server.signOutAnswer.get('answer') ?? { ok: true, value: { disconnected: false } }
			);
		},
		token: unused,
		startConnect: (provider, credentialHash, returnTo) => {
			server.calls.push(`start ${provider} ${credentialHash} ${returnTo}`);
			return Promise.resolve({ ok: true, value: `https://provider.example/consent` });
		},
		withCredential: (held) => clientFor(server, held),
	};
};

const PSALM = { title: 'Psalm 23', reference: '', collection: ROOT, text: 'The Lord.\n' };

/** The library bound to `id`, with a credential for it that the server answers. */
const boundTo = async (server: Server, id: string): Promise<string> => {
	const credential = newCredential();
	await keepCredential(db, id, {
		id,
		credential,
		provider: 'dropbox',
		createdAt: 1,
	});
	await bindLibrary(db, { connectionId: id, provider: 'dropbox' });
	server.answers.set(credential, { ok: true, value: connectionNamed(id) });
	return credential;
};

const livePassages = async () =>
	(await db.notes.where('connectionId').equals(LOCAL_CONNECTION_ID).toArray()).filter(isLive);

describe('the credential', () => {
	it('is fresh each time, and hashed as the server checks it', async () => {
		const one = newCredential();
		expect(one).toMatch(/^sk1_[A-Za-z0-9_-]{43}$/);
		expect(newCredential()).not.toBe(one);
		expect(await hashCredential('sk1_test')).toBe(
			createHash('sha256').update('sk1_test').digest('base64url')
		);
	});

	it('is written down before the browser leaves, and filed once the server names it', async () => {
		const { credential, credentialHash } = await beginConnect(db, 'gdrive', 1000);
		expect(credentialHash).toBe(await hashCredential(credential));
		expect(await pendingCredential(db, 2000)).toMatchObject({
			id: PENDING_CREDENTIAL_ID,
			credential,
			provider: 'gdrive',
		});

		const pending = await pendingCredential(db, 2000);
		if (pending === undefined) throw new Error('pending credential missing');
		await keepCredential(db, 'c1', pending);
		expect(await pendingCredential(db, 2000)).toBeUndefined();
		expect((await credentialFor(db, 'c1'))?.credential).toBe(credential);
	});

	it('is swept when its flow was left for over an hour', async () => {
		await beginConnect(db, 'dropbox', 0);
		expect(await pendingCredential(db, 60 * 60 * 1000)).toBeDefined();
		expect(await pendingCredential(db, 60 * 60 * 1000 + 1)).toBeUndefined();
		expect(await db.credentials.count()).toBe(0);
	});

	it('lists the connections held, newest first, without the pending one', async () => {
		await keepCredential(db, 'old', {
			id: 'x',
			credential: 'a',
			provider: 'dropbox',
			createdAt: 1,
		});
		await keepCredential(db, 'new', {
			id: 'y',
			credential: 'b',
			provider: 'gdrive',
			createdAt: 2,
		});
		await beginConnect(db, 'onedrive', 3);
		expect((await heldCredentials(db)).map((held) => held.id)).toEqual(['new', 'old']);

		await forgetCredential(db, 'new');
		expect((await heldCredentials(db)).map((held) => held.id)).toEqual(['old']);
	});
});

describe('the binding’s bookkeeping', () => {
	it('counts every bind and every letting go, and nothing else', async () => {
		expect(await bindingCount(db)).toBe(0);
		await unbindLibrary(db);
		expect(await bindingCount(db)).toBe(0);
		await bindLibrary(db, { connectionId: 'c1', provider: 'dropbox' });
		await bindLibrary(db, { connectionId: 'c1', provider: 'dropbox' });
		expect(await bindingCount(db)).toBe(1);
		await unbindLibrary(db);
		expect(await bindingCount(db)).toBe(2);
	});

	it('lets go of one connection only while it is the one bound, and as it was', async () => {
		await bindLibrary(db, { connectionId: 'c1', provider: 'dropbox' });
		const since = await bindingCount(db);
		expect(await unbindLibrary(db, { connectionId: 'c2' })).toBe(false);
		expect(await unbindLibrary(db, { connectionId: 'c1', since: since - 1 })).toBe(false);
		expect((await boundConnection(db))?.connectionId).toBe('c1');

		expect(await unbindLibrary(db, { connectionId: 'c1', since })).toBe(true);
		expect(await boundConnection(db)).toBeUndefined();
	});

	it('writes onto the binding’s row only while it is there', async () => {
		await updateBinding(db, 'c1', (state) => ({ ...state, rootId: 'r' }));
		expect(await db.syncState.count()).toBe(0);

		await bindLibrary(db, { connectionId: 'c1', provider: 'dropbox' });
		await updateBinding(db, 'c1', (state) => ({ ...state, rootId: 'r' }));
		expect((await boundConnection(db))?.rootId).toBe('r');
	});

	it('remembers what the account is called only if the library is bound as it was', async () => {
		await bindLibrary(db, { connectionId: 'c1', provider: 'dropbox', displayName: 'Old' });
		const since = await bindingCount(db);
		const said = { connectionId: 'c1', accountId: 'a1', displayName: 'Ann' };

		expect(await rememberAccount(db, { ...said, since: since + 1 })).toBe(false);
		expect((await boundConnection(db))?.displayName).toBe('Old');

		expect(await rememberAccount(db, { ...said, displayName: null, since })).toBe(true);
		expect(await boundConnection(db)).toMatchObject({ accountId: 'a1', displayName: 'Old' });
		expect(await rememberAccount(db, { ...said, since })).toBe(true);
		expect((await boundConnection(db))?.displayName).toBe('Ann');
	});
});

describe('connecting', () => {
	it('writes the credential down before it asks where to send the browser', async () => {
		const server = newServer();
		const result = await startConnecting(db, clientFor(server), 'dropbox', '/settings');

		const pending = await pendingCredential(db);
		expect(result).toEqual({ ok: true, value: 'https://provider.example/consent' });
		expect(server.calls).toEqual([
			`start dropbox ${await hashCredential(pending?.credential ?? '')} /settings`,
		]);
	});

	it('binds the library to the connection consented to, and queues it all', async () => {
		const server = newServer();
		await createPassage(db, PSALM);
		const { credential } = await beginConnect(db, 'dropbox');
		server.answers.set(credential, { ok: true, value: connectionNamed('c1') });

		const state = await claimConnection(db, clientFor(server));

		expect(state).toEqual({ kind: 'connected', connection: connectionNamed('c1') });
		expect(await boundConnection(db)).toMatchObject({
			connectionId: 'c1',
			provider: 'dropbox',
			accountId: 'account-c1',
			displayName: 'Ann',
		});
		expect((await credentialFor(db, 'c1'))?.credential).toBe(credential);
		expect(await pendingCredential(db)).toBeUndefined();
		expect((await db.opQueue.toArray()).map((op) => `${op.op} ${op.path}`)).toEqual([
			'write psalm-23.md',
		]);
	});

	it('keeps a credential the server does not yet answer for: its flow may still be out', async () => {
		const server = newServer();
		const { credential } = await beginConnect(db, 'dropbox');
		server.answers.set(credential, refused('credential_revoked'));

		expect(await claimConnection(db, clientFor(server))).toEqual({ kind: 'none' });
		expect((await pendingCredential(db))?.credential).toBe(credential);
		expect(await boundConnection(db)).toBeUndefined();
	});

	it('only reconciles when no flow is out', async () => {
		const server = newServer();
		await boundTo(server, 'c1');
		expect(await claimConnection(db, clientFor(server))).toMatchObject({ kind: 'connected' });
		expect(server.calls).toHaveLength(1);
	});

	it('moves the library to the new connection, keeping every passage, and signs the old out', async () => {
		const server = newServer();
		const old = await boundTo(server, 'c1');
		await createPassage(db, PSALM);
		const { credential } = await beginConnect(db, 'gdrive');
		server.answers.set(credential, {
			ok: true,
			value: connectionNamed('c2', { provider: 'gdrive', displayName: null }),
		});

		await claimConnection(db, clientFor(server));

		expect(await boundConnection(db)).toMatchObject({ connectionId: 'c2', provider: 'gdrive' });
		expect((await boundConnection(db))?.displayName).toBeUndefined();
		expect(await credentialFor(db, 'c1')).toBeUndefined();
		expect(server.calls).toContain(`revoke grant-c1 with ${old}`);
		expect((await livePassages()).map((note) => note.title)).toEqual(['Psalm 23']);
		expect((await db.opQueue.toArray()).map((op) => op.path)).toEqual(['psalm-23.md']);
	});

	it('retires the credential it held before for the same connection', async () => {
		const server = newServer();
		const before = await boundTo(server, 'c1');
		const { credential } = await beginConnect(db, 'dropbox');
		server.answers.set(credential, { ok: true, value: connectionNamed('c1') });

		await claimConnection(db, clientFor(server));

		expect((await credentialFor(db, 'c1'))?.credential).toBe(credential);
		expect(server.calls).toContain(`revoke grant-c1 with ${before}`);
		expect(server.calls).not.toContain(`revoke grant-c1 with ${credential}`);
	});
});

describe('the server’s word on the binding', () => {
	it('has nothing to say while the library is bound to nothing', async () => {
		const server = newServer();
		expect(await reconcileAccount(db, clientFor(server))).toEqual({ kind: 'none' });
		expect(server.calls).toEqual([]);
	});

	it('keeps a connection the server answers for, and what it is called now', async () => {
		const server = newServer();
		const credential = await boundTo(server, 'c1');
		server.answers.set(credential, {
			ok: true,
			value: connectionNamed('c1', { displayName: 'Ann B.' }),
		});

		expect(await reconcileAccount(db, clientFor(server))).toMatchObject({ kind: 'connected' });
		expect(await boundConnection(db)).toMatchObject({
			connectionId: 'c1',
			accountId: 'account-c1',
			displayName: 'Ann B.',
		});
	});

	it.each(['credential_revoked', 'not_found'] as const)(
		'lets the library go on %s, keeping every passage',
		async (refusal) => {
			const server = newServer();
			const credential = await boundTo(server, 'c1');
			await createPassage(db, PSALM);
			server.answers.set(credential, refused(refusal));

			expect(await reconcileAccount(db, clientFor(server))).toEqual({ kind: 'none' });
			expect(await boundConnection(db)).toBeUndefined();
			expect(await credentialFor(db, 'c1')).toBeUndefined();
			expect((await livePassages()).map((note) => note.title)).toEqual(['Psalm 23']);
		}
	);

	it('lets go of a binding it holds no credential for', async () => {
		const server = newServer();
		await bindLibrary(db, { connectionId: 'c1', provider: 'dropbox' });
		expect(await reconcileAccount(db, clientFor(server))).toEqual({ kind: 'none' });
		expect(await boundConnection(db)).toBeUndefined();
	});

	it.each([
		['another refusal', refused('reauthorize_required')],
		['no answer at all', new Error('offline')],
	] as const)('keeps everything on %s, and throws', async (_, answer) => {
		const server = newServer();
		const credential = await boundTo(server, 'c1');
		server.answers.set(credential, answer);

		await expect(reconcileAccount(db, clientFor(server))).rejects.toThrow();
		expect((await boundConnection(db))?.connectionId).toBe('c1');
		expect(await credentialFor(db, 'c1')).toBeDefined();
	});

	it('asks again about a binding made while it was asking about the last one', async () => {
		const server = newServer();
		const first = await boundTo(server, 'c1');
		const second = newCredential();
		await keepCredential(db, 'c2', {
			id: 'c2',
			credential: second,
			provider: 'dropbox',
			createdAt: 2,
		});
		server.answers.set(second, { ok: true, value: connectionNamed('c2') });
		const client = clientFor(server);
		const racing: ApiClient = {
			...client,
			withCredential: (held) => {
				const asked = client.withCredential(held);
				return {
					...asked,
					connection: async () => {
						const answer = await asked.connection();
						// The user moved the library to another account meanwhile.
						if (held === first) {
							await unbindLibrary(db);
							await bindLibrary(db, { connectionId: 'c2', provider: 'dropbox' });
						}
						return answer;
					},
				};
			},
		};
		server.answers.set(first, refused('credential_revoked'));

		expect(await reconcileAccount(db, racing)).toMatchObject({
			kind: 'connected',
			connection: { id: 'c2' },
		});
		expect((await boundConnection(db))?.connectionId).toBe('c2');
	});
});

describe('disconnecting', () => {
	it('signs this device out on the server, then lets the library go here', async () => {
		const server = newServer();
		const credential = await boundTo(server, 'c1');
		await createPassage(db, PSALM);

		expect(await disconnectAccount(db, clientFor(server), 'c1')).toEqual({ ok: true });
		expect(server.calls).toEqual([`sign out ${credential}`]);
		expect(await boundConnection(db)).toBeUndefined();
		expect(await credentialFor(db, 'c1')).toBeUndefined();
		expect(await livePassages()).toHaveLength(1);
	});

	it('takes a credential the server no longer honours as disconnected already', async () => {
		const server = newServer();
		const credential = await boundTo(server, 'c1');
		server.answers.set(credential, refused('credential_revoked'));

		expect(await disconnectAccount(db, clientFor(server), 'c1')).toEqual({ ok: true });
		expect(await boundConnection(db)).toBeUndefined();
	});

	it('changes nothing here when the server refuses', async () => {
		const server = newServer();
		const credential = await boundTo(server, 'c1');
		server.answers.set(credential, refused('reauthorize_required'));

		expect(await disconnectAccount(db, clientFor(server), 'c1')).toEqual({
			ok: false,
			refusal: 'reauthorize_required',
		});
		expect((await boundConnection(db))?.connectionId).toBe('c1');
		expect(await credentialFor(db, 'c1')).toBeDefined();
	});

	it('leaves a library bound elsewhere by the time the server answered', async () => {
		const server = newServer();
		await boundTo(server, 'c1');
		await unbindLibrary(db);
		await bindLibrary(db, { connectionId: 'c2', provider: 'dropbox' });

		expect(await disconnectAccount(db, clientFor(server), 'c1')).toEqual({ ok: true });
		expect((await boundConnection(db))?.connectionId).toBe('c2');
	});

	it('stops syncing here without asking the server, and keeps the credential', async () => {
		const server = newServer();
		await boundTo(server, 'c1');

		await stopSyncingHere(db, 'c1');

		expect(server.calls).toEqual([]);
		expect(await boundConnection(db)).toBeUndefined();
		expect(await credentialFor(db, 'c1')).toBeDefined();
	});
});
