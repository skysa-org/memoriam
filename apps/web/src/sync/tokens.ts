import { AuthError } from '@memoriam/core';

import { type AccessToken, type ApiClient, type Refusal } from '../api/client.js';
import { updateBinding } from '../store/connection.js';
import { credentialFor } from '../store/credentials.js';
import { type MemoriamDatabase } from '../store/db.js';

/**
 * Provider access tokens for one connection, minted by `apps/api` and held in
 * memory with a copy in the connection's `syncState` row, so a reload does not
 * need a round trip (docs/ARCHITECTURE.md §10, "The sync client"). Never
 * localStorage (CLAUDE.md).
 *
 * The provider adapter asks `get` before every request. A token about to expire
 * is replaced before it is used rather than after the provider refuses it,
 * and `refresh` is what the engine calls when the provider refuses one anyway.
 *
 * Ported from skysa-notes' `sync/tokens.ts`, less its detached sources and the
 * operator's word beside a refusal.
 */

/** A token this close to its expiry is treated as expired. */
const EXPIRY_MARGIN_MS = 60_000;

export interface TokenSourceOptions {
	db: MemoriamDatabase;
	client: Pick<ApiClient, 'withCredential'>;
	connectionId: string;
	now?: () => number;
}

export interface TokenSource {
	readonly get: () => Promise<string>;
	/** Mint a new token, whatever the one held says about itself. */
	readonly refresh: () => Promise<void>;
	/**
	 * Why the server last refused a token, until a token is had again from
	 * anywhere, or the server fails to answer at all. The engine cannot tell a
	 * refusal from any other failed request, so this is how the scheduler says
	 * "reconnect" rather than "retrying".
	 */
	readonly refusal: () => Refusal | undefined;
}

export const createTokenSource = (options: TokenSourceOptions): TokenSource => {
	const { db, client, connectionId } = options;
	const now = options.now ?? Date.now;
	const cached = new Map<'token', AccessToken>();
	const refused = new Map<'refusal', Refusal>();

	const usable = (token: AccessToken | undefined): token is AccessToken =>
		token !== undefined && token.expiresAt - EXPIRY_MARGIN_MS > now();

	/** A token in hand, from wherever: whatever the server said before is no longer so. */
	const using = (token: AccessToken): string => {
		refused.delete('refusal');
		cached.set('token', token);
		return token.accessToken;
	};

	const mint = async (): Promise<string> => {
		// Read fresh on every mint rather than held: a device revoked from
		// somewhere else, or a library let go of in another tab, must stop
		// minting rather than go on presenting a credential that is gone.
		const held = await credentialFor(db, connectionId);
		if (held === undefined) {
			refused.set('refusal', 'credential_required');
			cached.delete('token');
			throw new AuthError('This device holds no credential for that connection');
		}

		const result = await client
			.withCredential(held.credential)
			.token()
			.catch((error: unknown) => {
				// Not an answer: the server may since have changed its mind, and a
				// refusal kept past this would read as one it gave just now.
				refused.delete('refusal');
				throw error;
			});
		if (!result.ok) {
			refused.set('refusal', result.refusal);
			cached.delete('token');
			// An `AuthError`, so the provider call it was for fails as one.
			throw new AuthError(`The server would not mint a token: ${result.refusal}`);
		}
		using(result.value);
		// Only onto the binding's row: a library let go of while the token was
		// on its way has no row, and must not get one back.
		await updateBinding(db, connectionId, (state) => ({
			...state,
			accessToken: result.value.accessToken,
			accessTokenExpiresAt: result.value.expiresAt,
		}));
		return result.value.accessToken;
	};

	/**
	 * The mint under way, which every request that finds the token spent while
	 * it is out waits on. Passages are written several at once on Google Drive
	 * (`StorageProvider.writesAtOnce`), and each of them finding the token
	 * expired would otherwise ask the server for one of its own.
	 */
	const minting = new Map<'mint', Promise<string>>();
	const mintOnce = (): Promise<string> => {
		const under = minting.get('mint');
		if (under !== undefined) return under;
		const minted = mint().finally(() => {
			minting.delete('mint');
		});
		minting.set('mint', minted);
		return minted;
	};

	return {
		get: async () => {
			const inMemory = cached.get('token');
			if (usable(inMemory)) return using(inMemory);

			const state = await db.syncState.get(connectionId);
			const stored =
				state?.accessToken === undefined || state.accessTokenExpiresAt === undefined
					? undefined
					: { accessToken: state.accessToken, expiresAt: state.accessTokenExpiresAt };
			// Minted by another tab, perhaps after this one was refused.
			if (usable(stored)) return using(stored);
			return mintOnce();
		},

		refresh: async () => {
			// Forgotten before the new one is asked for, row included: if it
			// cannot be had, the refused one must not be handed out again.
			cached.delete('token');
			await updateBinding(
				db,
				connectionId,
				({ accessToken: _token, accessTokenExpiresAt: _expiry, ...rest }) => rest
			);
			await mint();
		},

		refusal: () => refused.get('refusal'),
	};
};
