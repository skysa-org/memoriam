import { describe, expect, it } from 'vitest';

import { createApp, neverLimited, parseEnv, type RateLimiter } from '../src/app.js';

/**
 * `@memoriam/api` resolves to `src/app.ts` and nothing else, so what a second
 * Worker entry can reach is exactly what this module exports. skysa-notes'
 * `docs/ARCHITECTURE.md` §6 says an operator composes their own entry from
 * `createApp`; that is only true if they can also build a config the way
 * `src/worker.ts` does, and a rate limiter of their own.
 */
describe('the package entry', () => {
	it('exports parseEnv beside createApp', () => {
		expect(typeof createApp).toBe('function');
		expect(typeof parseEnv).toBe('function');
	});

	it('exports the rate limiter seam, which skysa-notes keeps in its core', async () => {
		// The type comes with it: an operator's limiter is written against it.
		const limiter: RateLimiter = neverLimited;
		await expect(limiter.check('connect:203.0.113.7')).resolves.toEqual({ allowed: true });
	});
});
