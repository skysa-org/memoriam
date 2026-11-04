import type { Bearer } from './credentials.js';
import type { SecretKey } from './crypto.js';
import type { Database } from './db/client.js';
import type { AppConfig } from './env.js';
import type { RateLimiter } from './limits.js';

export type Bindings = {
	DB: D1Database;
};

export type Variables = {
	db: Database;
	config: AppConfig;
	rateLimiter: RateLimiter;
	/**
	 * The connection the caller's credential reaches, on the routes that require
	 * one. `requireBearer` is the only writer, and it answers 401 rather than
	 * calling `next()` when there is nothing to put here — so a handler behind it
	 * always finds one.
	 */
	bearer: Bearer;
	/** AES-256-GCM key for the `connections` secret columns. */
	secretKey: SecretKey;
	/** HMAC key for the short-lived OAuth flow cookie. Derived, not the same key. */
	signingKey: CryptoKey;
};

/** What a request is handed, as Hono types it: its bindings and what middleware has set. */
export type AppEnv = { Bindings: Bindings; Variables: Variables };
