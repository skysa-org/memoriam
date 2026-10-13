import { type ProviderKind } from '@memoriam/core';

import { type ApiClient, type Connection, type Refusal, type Result } from '../api/client.js';
import {
	bindingCount,
	bindLibrary,
	boundConnection,
	rememberAccount,
	unbindLibrary,
} from '../store/connection.js';
import {
	beginConnect,
	credentialFor,
	forgetCredential,
	keepCredential,
	pendingCredential,
} from '../store/credentials.js';
import { type CredentialRecord, type MemoriamDatabase } from '../store/db.js';

/**
 * The storage account, as the server knows it, reconciled with the library
 * (docs/ARCHITECTURE.md §10, "The sync client").
 *
 * The server is the authority on *whether* the connection this device's
 * credential reaches still exists; the device decides nothing but follows it.
 * A credential either reaches a connection or has stopped reaching anything,
 * for ever. So the library is let go on a definite answer *about its own
 * connection* — `credential_revoked`: revoked from another device, or the
 * account disconnected; `not_found`: the connection is gone — and on nothing
 * else. Offline, a 5xx or a body it cannot read throws, and the device keeps
 * what it has.
 *
 * Letting go is `unbindLibrary` on every path, the server's and the user's
 * alike, and it keeps every passage: nobody is there to ask when the server is
 * the one that said so, which is why nothing may be discarded on the way.
 *
 * Ported from skysa-notes' `sync/account.ts`, for one library rather than a
 * source per account: nothing is detached, moved, or imported.
 */

/** Providers the app can sync with. */
export const CONNECTABLE: readonly ProviderKind[] = ['dropbox', 'onedrive', 'gdrive'];

export type AccountState =
	/** The connection the library is bound to, as the server answers for it. */
	| { kind: 'connected'; connection: Connection }
	/** Nothing the server answers for: the library is bound to no connection. */
	| { kind: 'none' };

type Client = Pick<ApiClient, 'withCredential'>;

/**
 * Start connecting `provider`: a credential written down, and the address of
 * the provider's consent screen to send the browser to. The credential **must**
 * be written before the browser leaves (`beginConnect`), which is why this is
 * the one way to ask.
 */
export const startConnecting = async (
	db: MemoriamDatabase,
	client: Pick<ApiClient, 'startConnect'>,
	provider: ProviderKind,
	returnTo: string
): Promise<Result<string>> => {
	const { credentialHash } = await beginConnect(db, provider);
	return client.startConnect(provider, credentialHash, returnTo);
};

/**
 * Confirm the connection the library is bound to, with the credential this
 * device holds for it. The only outcomes are "still there", "gone for good",
 * and "could not ask" — which throws: offline is not an answer.
 */
export const reconcileAccount = (db: MemoriamDatabase, client: Client): Promise<AccountState> =>
	reconcileOnce(db, client, true);

const reconcileOnce = async (
	db: MemoriamDatabase,
	client: Client,
	again: boolean
): Promise<AccountState> => {
	const since = await bindingCount(db);
	const bound = await boundConnection(db);
	if (bound === undefined) return { kind: 'none' };
	const { connectionId } = bound;

	const held = await credentialFor(db, connectionId);
	// Bound with no credential to ask with. Nothing here can reach the
	// connection again — a credential cannot be re-derived, and the server will
	// never issue a second one for a connection already made — so the honest
	// thing is to stop claiming the library syncs.
	if (held === undefined) return letGo(db, client, connectionId, since, again);

	const result = await client.withCredential(held.credential).connection();
	if (!result.ok) {
		if (result.refusal !== 'credential_revoked' && result.refusal !== 'not_found') {
			throw new Error(`the server refused to answer for this connection: ${result.refusal}`);
		}
		await forgetCredential(db, connectionId);
		return letGo(db, client, connectionId, since, again);
	}

	const connection = result.value;
	// A provider this build has no adapter for: a newer Worker in front of an
	// older cached app. Not a reason to let go — the connection is real and the
	// next build will sync it.
	if (!CONNECTABLE.includes(connection.provider)) return { kind: 'none' };

	const applied = await rememberAccount(db, {
		connectionId,
		accountId: connection.accountId,
		displayName: connection.displayName,
		since,
	});
	if (!applied) return retry(db, client, again);
	return { kind: 'connected', connection };
};

/** Let the library go of `connectionId`, unless it was bound or let go since. */
const letGo = async (
	db: MemoriamDatabase,
	client: Client,
	connectionId: string,
	since: number,
	again: boolean
): Promise<AccountState> =>
	(await unbindLibrary(db, { connectionId, since }))
		? { kind: 'none' }
		: retry(db, client, again);

/**
 * The library was bound or let go while the server was being asked — a
 * disconnect in another tab, or a connect finishing. What came back is about a
 * binding that no longer exists, so it is asked again, once.
 */
const retry = (db: MemoriamDatabase, client: Client, again: boolean): Promise<AccountState> => {
	if (!again) throw new Error('The library changed connection while the server was being asked');
	return reconcileOnce(db, client, false);
};

/**
 * Take up the connection a flow just consented to, and bind the library to it.
 *
 * The credential was written down before the browser left for the provider
 * (`beginConnect`), so this is where it finds out what it reaches. Until the
 * server answers there is no id to file it under, which is why it is not
 * promoted in place.
 *
 * A library bound to another connection is let go of first: there is one
 * library, and connecting is choosing where it syncs. Every passage stays
 * (`unbindLibrary`), and the binding queues them all for the new remote. The
 * credential that reached the old one is retired, as is one this device held
 * for the same connection before: nothing here will present either again.
 */
export const claimConnection = async (
	db: MemoriamDatabase,
	client: Pick<ApiClient, 'withCredential'>
): Promise<AccountState> => {
	const pending = await pendingCredential(db);
	if (pending === undefined) return reconcileAccount(db, client);

	const result = await client.withCredential(pending.credential).connection();
	if (!result.ok) {
		// Not an answer about the flow. A credential the server has never seen
		// and one whose flow is still out — consent page open in another tab —
		// are the same refusal, and throwing it away on the second is the worst
		// outcome the design has: the user consents, the server commits the
		// connection and spends the hash for ever, and this device holds no
		// plaintext for it. A flow the user really did abandon is swept by
		// `PENDING_TTL_MS` instead, which cannot be wrong about it.
		return reconcileAccount(db, client);
	}

	const connection = result.value;
	const previous = await credentialFor(db, connection.id);
	await keepCredential(db, connection.id, pending);
	const replaced = await replaceBinding(db, connection.id);
	await bindLibrary(db, {
		connectionId: connection.id,
		provider: connection.provider,
		...(connection.accountId === null ? {} : { accountId: connection.accountId }),
		...(connection.displayName === null ? {} : { displayName: connection.displayName }),
	});
	// Last, and awaited: two calls to a server are not something to put between
	// a credential kept and a library bound, where a closed tab leaves the one
	// without the other.
	if (previous !== undefined && previous.credential !== pending.credential) {
		await retire(client, previous.credential, connection.id);
	}
	if (replaced !== undefined) await retire(client, replaced.credential, replaced.id);
	return { kind: 'connected', connection };
};

/** Let go of a binding to anything but `connectionId`; answers its credential, now forgotten. */
const replaceBinding = async (
	db: MemoriamDatabase,
	connectionId: string
): Promise<CredentialRecord | undefined> => {
	const bound = await boundConnection(db);
	if (bound === undefined || bound.connectionId === connectionId) return undefined;
	const held = await credentialFor(db, bound.connectionId);
	await forgetCredential(db, bound.connectionId);
	await unbindLibrary(db, { connectionId: bound.connectionId });
	return held;
};

/**
 * Sign out a credential this device will not present again, so its grant
 * does not sit in the device list as a device that is not one, and as one more
 * live key to the account, until it idles out.
 *
 * Best effort, and silent. Most often the old credential is why the user is
 * connecting again — revoked, or expired — and the server refuses it: there is
 * nothing to retire. Offline, the grant idles out as it would have.
 */
const retire = async (client: Client, credential: string, connectionId: string): Promise<void> => {
	const old = client.withCredential(credential);
	await old
		.connection()
		.then(async (seen) => {
			// Asked, not assumed: the grant's id is the server's, and a credential
			// filed under the wrong connection must not sign out somebody else's.
			if (seen.ok && seen.value.id === connectionId)
				await old.revokeGrant(seen.value.grantId);
		})
		.catch(() => undefined);
};

export type DisconnectOutcome = { ok: true } | { ok: false; refusal: Refusal };

/**
 * Disconnect on the server, then here. Only in that order, and only once the
 * server has let go: letting go here first and failing to reach the server
 * would leave the account connected there — with a live refresh token — and
 * nothing on this device able to name it.
 *
 * On the server, this device is signed out and no other (`signOut`). The last
 * device out takes the account with it, and the app's access at the provider
 * is withdrawn then.
 *
 * Here, the library is let go of and every passage kept (`unbindLibrary`), by
 * name: the answer can arrive after the library was bound elsewhere, which is
 * then left as it is. Nothing on the remote is touched.
 */
export const disconnectAccount = async (
	db: MemoriamDatabase,
	client: Client,
	connectionId: string
): Promise<DisconnectOutcome> => {
	const held = await credentialFor(db, connectionId);
	// No credential is the same position a disconnect leaves the device in, so
	// finish the job here rather than refuse: the server cannot be asked, and
	// the alternative is a binding the user cannot get rid of.
	if (held !== undefined) {
		const result = await client.withCredential(held.credential).signOut();
		// Already gone on the server is what was asked for. So is a credential it
		// no longer honours: whatever removed it did the disconnecting.
		const done =
			result.ok || result.refusal === 'not_found' || result.refusal === 'credential_revoked';
		if (!done) return result;
	}
	await forgetCredential(db, connectionId);
	await unbindLibrary(db, { connectionId });
	return { ok: true };
};

/**
 * Stop syncing on this device without the server's say: the way out when it
 * will not, or cannot, disconnect. Nothing is asked of the server and nothing
 * on it is touched, so the connection may well live on there. The credential
 * is kept, so a later connect of the same account can retire its grant.
 */
export const stopSyncingHere = async (
	db: MemoriamDatabase,
	connectionId: string
): Promise<void> => {
	await unbindLibrary(db, { connectionId });
};
