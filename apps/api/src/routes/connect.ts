import { type ApiErrorCode, PROVIDER_KINDS } from '@memoriam/core';
import { type Context, Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv, RouteDeps } from '../context.js';
import { isCredentialHash } from '../credentials.js';
import { sealOAuthSecret } from '../crypto.js';
import { commitConnection } from '../db/connections.js';
import { deviceLabel } from '../device.js';
import {
	clearFlowState,
	flowExpiry,
	readFlowAnswer,
	readFlowState,
	setFlowAnswer,
	setFlowState,
} from '../flowCookies.js';
import { fail, jsonBody, requireSameOrigin, tooMany } from '../http.js';
import { logFailure } from '../log.js';
import { createPkcePair, createState } from '../oauth/pkce.js';
import { oauthFor } from '../oauth/providers.js';
import { ScopeNotGrantedError } from '../oauth/types.js';

/**
 * Connecting a storage account. Two routes: one the device asks for an
 * authorize URL, one the provider sends the browser back to.
 *
 * There is no user and no session. A connection is the account, and the right
 * to act on it is the credential the device generated before it started —
 * committed here as a grant, in the same transaction as the connection itself,
 * so there is no window where consent has been given and nothing can use it.
 * See skysa-notes' `docs/ARCHITECTURE.md` §6.
 */

const redirectUri = (origin: string, provider: string): string =>
	`${origin}/api/auth/connect/${provider}/callback`;

/**
 * Only ever send the browser back inside this app. Checked on the path as
 * resolved, not as given: `/.//evil.example` and `/\evil.example` both start
 * with one slash and resolve to `//evil.example`, which a `Location` header
 * reads as another host.
 */
const safeReturnTo = (value: string | undefined, origin: string): string => {
	if (value === undefined || !value.startsWith('/')) return '/';
	const url = new URL(value, origin);
	const path = url.pathname + url.search;
	return url.origin !== new URL(origin).origin || path.startsWith('//') ? '/' : path;
};

/**
 * `returnTo` may already carry a query of its own, so the separator varies.
 * `expired` is a callback with no flow of this browser's behind it, which the
 * callback cannot tell from a forged one and so says nothing more about.
 *
 * skysa-notes also answers `refused`, from its entitlement policy. There is no
 * policy here, so every account that connects may sync.
 */
type Outcome = 'ok' | 'denied' | 'failed' | 'partial' | 'expired';

const back = (returnTo: string, outcome: Outcome): string =>
	`${returnTo}${returnTo.includes('?') ? '&' : '?'}connect=${outcome}`;

/**
 * A provider with no flow here, or one this deployment does not offer, is a
 * 404; one it offers without credentials is the operator's to fix, and a 501.
 * Said to `/start`; the callback sends the browser back instead.
 */
const refusal = (
	c: Context<AppEnv>,
	error: Extract<ApiErrorCode, 'unsupported_provider' | 'provider_not_configured'>
): Response => fail(c, error, error === 'unsupported_provider' ? 404 : 501);

/**
 * A provider as the log may name it: one this code knows, or none. The path is
 * the caller's to write, and a log line is the operator's to read.
 */
const loggable = (param: string): string =>
	PROVIDER_KINDS.find((kind) => kind === param) ?? 'unknown provider';

const startBody = z.object({
	/** base64url SHA-256 of the credential the device has already written down. */
	credentialHash: z.string().refine(isCredentialHash, 'not a base64url SHA-256 digest'),
	// Bounded: it goes into a cookie, and a cookie a browser refuses to store is
	// a flow that cannot complete. Far longer than any route this app has.
	returnTo: z.string().max(512).optional(),
});

/** Who to throttle. The address, never anything derived from the credential. */
const callerKey = (c: Context<AppEnv>, what: string): string =>
	`${what}:${c.req.header('cf-connecting-ip') ?? 'unknown'}`;

export const connectRoutes = (deps: RouteDeps) => {
	const { config, rateLimiter, fetch: doFetch, keys } = deps;
	const app = new Hono<AppEnv>();
	/** Refuses a request from any page but this deployment's own. */
	const ownOrigin = requireSameOrigin(config.appOrigin);

	app.post('/auth/connect/:provider/start', ownOrigin, async (c) => {
		const cookies = { secure: config.cookiesSecure };

		const resolved = oauthFor(config, c.req.param('provider'));
		if (!resolved.ok) return refusal(c, resolved.error);
		const { provider, client, credentials } = resolved;

		// Before anything is minted or written: an attacker who can start flows
		// freely makes this deployment pay for a provider round trip per attempt
		// at the callback, and fills the cookie jar in the meantime.
		const limit = await rateLimiter.check(callerKey(c, 'connect'));
		if (!limit.allowed) return tooMany(c, limit.retryAfter);

		const body = await jsonBody(c, startBody);
		if (body === undefined) return fail(c, 'invalid_request', 400);

		const { verifier, challenge } = await createPkcePair();
		const state = createState();
		const device = deviceLabel(c.req.header('user-agent'));
		await setFlowState(
			c,
			(await keys()).signingKey,
			{
				state,
				verifier,
				returnTo: safeReturnTo(body.returnTo, config.appOrigin),
				expiresAt: flowExpiry(),
				credentialHash: body.credentialHash,
				...(device === undefined ? {} : { device }),
			},
			cookies
		);

		// JSON, not a redirect: the caller is `fetch`, because a navigation cannot
		// carry a body, and the body is what keeps the hash out of the URL.
		return c.json({
			authorizeUrl: client.authorizeUrl(credentials, {
				redirectUri: redirectUri(config.appOrigin, provider),
				state,
				challenge,
			}),
		});
	});

	app.get('/auth/connect/:provider/callback', async (c) => {
		const db = c.get('db');
		const cookies = { secure: config.cookiesSecure };
		const key = (await keys()).signingKey;
		const state = c.req.query('state');

		// The same callback asked for again, after this browser was answered: sent
		// where it was sent the first time, and nothing else is touched — not the
		// answer, which a second asking may need as well, nor a flow started since
		// (`FlowAnswer`).
		const answered = await readFlowAnswer(c, key, state, cookies);
		if (answered !== undefined) return c.redirect(answered);

		// Whatever happens below, this flow is over: clearing here rather than on
		// the success path means even the refusals drop the cookie carrying the
		// verifier, and a cookie that cannot be parsed does not survive to poison
		// the next attempt.
		const flow = await readFlowState(c, key, cookies);
		clearFlowState(c);

		// A callback with no flow, or one whose state does not match, did not come
		// from a flow this browser started — or came from one that took too long,
		// or was answered too long ago to remember. It is still a page a browser
		// is on, so it goes back to the app, which says to connect again if
		// nothing is connected, rather than being left looking at raw JSON.
		if (flow === undefined || state !== flow.state) return c.redirect(back('/', 'expired'));

		// Every answer from here on is kept, so the browser that asks again is
		// told the same.
		const answer = async (outcome: Outcome): Promise<Response> => {
			const location = back(flow.returnTo, outcome);
			await setFlowAnswer(c, key, { state: flow.state, location }, cookies);
			return c.redirect(location);
		};

		// Like every answer here, a page a browser is on: it goes back to the
		// app rather than showing raw JSON. A provider turned off between start
		// and callback looks like any failure to the user, so it is logged.
		const resolved = oauthFor(config, c.req.param('provider'));
		if (!resolved.ok) {
			logFailure(`${loggable(c.req.param('provider'))} callback`, new Error(resolved.error));
			return answer('failed');
		}
		const { provider, client, credentials } = resolved;

		const denied = c.req.query('error');
		if (denied !== undefined) return answer('denied');

		// Neither a code nor a refusal: not something a provider sends, so logged.
		const code = c.req.query('code');
		if (code === undefined) {
			logFailure(`${provider} callback`, new Error('missing_code'));
			return answer('failed');
		}

		// The flow cookie got past the signature check, so this is a browser that
		// started a flow here — but a code exchange is still an outbound call the
		// deployment pays for, and a replayed callback is the cheapest way to ask
		// for one.
		// Throttled is a failed connect to the person waiting, and only the log
		// tells the operator why.
		const limit = await rateLimiter.check(callerKey(c, 'callback'));
		if (!limit.allowed) {
			logFailure(`${provider} callback`, new Error('rate_limited'));
			return answer('failed');
		}

		// A replayed or expired authorization code is an ordinary event, not a
		// server fault: send the user back to the app to try again. Logged all the
		// same, because an expired client secret looks exactly like this to the
		// user, and nothing else would tell the operator.
		//
		// A consent screen whose storage box the user unticked (Google lets them)
		// is neither: the user did it, and can put it right by connecting again.
		const exchanged = await client
			.exchangeCode(doFetch, credentials, {
				redirectUri: redirectUri(config.appOrigin, provider),
				code,
				verifier: flow.verifier,
			})
			.then((tokens) => ({ tokens }))
			.catch((error: unknown) => {
				if (error instanceof ScopeNotGrantedError) {
					return { outcome: 'partial' as const };
				}
				logFailure(`${provider} code exchange failed`, error);
				return { outcome: 'failed' as const };
			});
		if (!('tokens' in exchanged)) return answer(exchanged.outcome);
		const { tokens } = exchanged;

		// Without a refresh token the connection would stop working in a few
		// hours with no way to recover, so this is a failure, not a warning.
		if (tokens.refreshToken === undefined) return answer('failed');

		// The account id *is* the connection's identity: it is the upsert target,
		// and it is what tells a reconnect to the same account from a reconnect to
		// a different one. Dropbox always sends it; a response without one is a
		// failure, not something to paper over.
		if (tokens.accountId === undefined) return answer('failed');

		const displayName = await client.accountName(doFetch, tokens);

		const committed = await commitConnection(db, {
			provider,
			accountId: tokens.accountId,
			displayName,
			sealed: await sealOAuthSecret((await keys()).secretKey, {
				refreshToken: tokens.refreshToken,
			}),
			credentialHash: flow.credentialHash,
			// What the device said it was when it started the flow, which is the
			// app asking, rather than what arrives here, which is whatever the
			// provider's pages were told (`FlowState.device`).
			device: flow.device,
			now: Date.now(),
		});

		return answer(committed ? 'ok' : 'failed');
	});

	return app;
};
