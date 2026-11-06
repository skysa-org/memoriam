import { cell } from '@memoriam/core';
import { Hono } from 'hono';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';

import type { AppEnv, Keys, RouteDeps } from './context.js';
import { importSecretKey, signingKey } from './crypto.js';
import { createDb } from './db/client.js';
import type { AppConfig } from './env.js';
import { fail } from './http.js';
import { neverLimited, type RateLimiter } from './limits.js';

/**
 * Re-exported so a second Worker entry can build its config through the same
 * validation `src/worker.ts` uses, rather than reading env by hand. Together
 * with `createApp` this is the whole of what another deployment needs.
 */
export { type AppConfig, parseEnv } from './env.js';
export { neverLimited, type RateLimitDecision, type RateLimiter } from './limits.js';
import type { FetchLike } from './oauth/types.js';
import { connectRoutes } from './routes/connect.js';
import { connectionRoutes } from './routes/connections.js';
import { tokenRoutes } from './routes/token.js';

/** The request context's types, in `context.ts`; kept on the package entry. */
export type { AppEnv, AuthedEnv, Bindings, Variables } from './context.js';

export interface CreateAppOptions {
	config: AppConfig;
	/**
	 * How the endpoints that spend an outbound provider call are throttled.
	 * Defaults to `neverLimited`. A seam rather than a Cloudflare binding,
	 * because a binding would be deployment-specific code in a repo that forbids
	 * it (CLAUDE.md).
	 */
	rateLimiter?: RateLimiter;
	/**
	 * How the app reaches the provider's OAuth endpoints. Injected so tests can
	 * drive the whole flow without a network, and so an operator could route
	 * through their own egress.
	 */
	fetch?: FetchLike;
	/**
	 * How long a provider gets to answer. Every call here is one a user is
	 * waiting on, and `DELETE /api/connection` promises the row goes either
	 * way — which only holds if the revoke can give up.
	 */
	providerTimeoutMs?: number;
}

/**
 * The composition root. Nothing under `apps/api` reads the environment — every
 * deployment-specific value arrives here. `src/worker.ts` is the default caller.
 *
 * Every connected device may mint tokens: unlike skysa-notes' server, there is
 * no entitlement policy to ask, no gate in front of the connect buttons and no
 * change relay (docs/ARCHITECTURE.md §10, "The sync client").
 */
export const createApp = (options: CreateAppOptions) => {
	const { config, rateLimiter = neverLimited, providerTimeoutMs = 10_000 } = options;

	/** Every provider call gets a deadline, so no call site has to remember one. */
	const doFetch: FetchLike = (url, init) =>
		(options.fetch ?? globalThis.fetch)(url, {
			...init,
			// Combined, not replaced: a caller that brings its own signal keeps it
			// *and* gets the deadline.
			signal: AbortSignal.any([
				...(init.signal === null || init.signal === undefined ? [] : [init.signal]),
				AbortSignal.timeout(providerTimeoutMs),
			]),
		});

	/**
	 * Key import is async and `createApp` is not, so the promise is built once
	 * and awaited per request — every request after the first resolves an already
	 * settled promise. A cell, as the isolate cache in `src/worker.ts` is.
	 */
	const keyCache = cell<Promise<Keys> | undefined>(undefined);
	const keys = (): Promise<Keys> => {
		const cached = keyCache.current;
		if (cached !== undefined) return cached;

		const built = Promise.all([
			importSecretKey(config.secretsKey, config.secretsKeyId),
			signingKey(config.secretsKey),
		]).then(([secretKey, hmacKey]) => ({ secretKey, signingKey: hmacKey }));
		keyCache.current = built;
		return built;
	};

	const deps: RouteDeps = { config, rateLimiter, fetch: doFetch, keys };

	const app = new Hono<AppEnv>().basePath('/api');

	// Before anything answers, as the per-request middleware that set every
	// variable was: a deployment whose `SECRETS_KEY` cannot be imported fails
	// every request, not only the ones that reach a key.
	app.use('*', async (c, next) => {
		await keys();
		c.set('db', createDb(c.env.DB));
		await next();
	});

	/**
	 * Nothing here may be stored by anything between the Worker and the tab.
	 *
	 * `POST /api/token` answers with a provider access token, and `GET
	 * /api/connection` is the answer the device binds and *unbinds* itself on:
	 * a reply kept and replayed after the world moved would hand out a token the
	 * user has revoked, or unbind a connection that is alive. Neither response
	 * carried any freshness information before this, which leaves them to
	 * heuristic freshness — and `no-store` is the only header that also forbids
	 * writing the response down in the first place. `no-cache` would not: it
	 * means "store it, but ask first".
	 *
	 * It goes *above* `csrf` because a refusal is a response too. `csrf` rejects
	 * by throwing, which Hono turns into a response at the level above whoever
	 * threw — so a middleware registered after it never gets its `next()` back
	 * for that request, and the 403 would go out bare.
	 *
	 * Set after `next()`, so it is the last word: a route cannot opt out by
	 * setting its own, and none should want to.
	 *
	 * The client asks with `cache: 'no-store'` from its side
	 * (`apps/web/src/api/client.ts`); this is the same rule for the caches it
	 * does not control.
	 * https://www.rfc-editor.org/rfc/rfc9111#name-no-store
	 */
	app.use('*', async (c, next) => {
		await next();
		c.header('Cache-Control', 'no-store');
	});

	/**
	 * Defence in depth, not the defence. Nothing is authorized by a cookie — a
	 * bearer is never sent ambiently, so cross-origin requests arrive
	 * unauthenticated (skysa-notes' `docs/ARCHITECTURE.md` §6). What is left to
	 * protect is `POST /api/auth/connect/…/start`, which writes a
	 * caller-supplied value into a cookie; it checks `Origin` and
	 * `Sec-Fetch-Site` itself, because `csrf()` inspects only form and text
	 * content types and leans on CORS preflight for JSON.
	 *
	 * It applies only to state-changing methods, so the OAuth callback (a GET
	 * navigation from the provider) is unaffected.
	 */
	app.use('*', csrf({ origin: config.appOrigin }));

	app.get('/health', (c) => c.json({ ok: true }));

	/**
	 * What this instance offers. The client uses it to decide which connect
	 * buttons to show. Contains no secrets.
	 */
	app.get('/config', (c) => c.json({ providers: config.enabledProviders }));

	app.route('/', connectRoutes(deps));
	app.route('/', tokenRoutes(deps));
	app.route('/', connectionRoutes(deps));

	app.notFound((c) => fail(c, 'not_found', 404));

	app.onError((err, c) => {
		// A middleware that already decided on an answer — the CSRF check, say —
		// raises it as an `HTTPException`. Turning that into a 500 would hide a
		// deliberate 403 behind a fault.
		if (err instanceof HTTPException) return err.getResponse();

		console.error(summarize(err));
		return fail(c, 'internal_error', 500);
	});

	return app;
};

export type App = ReturnType<typeof createApp>;

/**
 * What is safe to put in the Worker log.
 *
 * Logging the error object itself is not: drizzle's `DrizzleQueryError` builds
 * its message from the failing SQL *and its bound parameters*, and keeps them on
 * an own property besides. Those parameters are credential hashes, secret
 * ciphertext and IVs. A transient D1 error would be enough to write them all to
 * the log, which skysa-notes' `docs/ARCHITECTURE.md` §6 forbids.
 */
const summarize = (err: unknown): string => {
	if (!(err instanceof Error)) return 'non-error thrown';
	// `err.query` is drizzle's SQL with `?` placeholders — useful, and free of
	// values. The parameters that sit beside it are deliberately not read.
	const query = (err as { query?: unknown }).query;
	const where = typeof query === 'string' ? ` while running: ${query}` : '';
	return `${err.name}: ${err.message.split('\n')[0] ?? ''}${where}`;
};
