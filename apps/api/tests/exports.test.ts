import { describe, expect, it } from 'vitest';

import {
	createApp,
	envWarnings,
	misconfigured,
	neverLimited,
	parseEnv,
	type RateLimiter,
} from '../src/index.js';

/**
 * `@memoriam/api` resolves to `src/index.ts`, so what a second Worker entry
 * can reach is exactly what this module exports. An operator composes their
 * own entry from `createApp` (docs/self-hosting.md); that is only true if they
 * can also build a config the way `src/worker.ts` does, and pass a rate limiter
 * of their own.
 */
describe('the package entry', () => {
	it('exports what the stock entry builds with, beside createApp', () => {
		expect(typeof createApp).toBe('function');
		expect(typeof parseEnv).toBe('function');
		expect(typeof envWarnings).toBe('function');
		expect(typeof misconfigured).toBe('function');
	});

	it('exports the rate limiter seam, as it did before the kit', async () => {
		// The type comes with it: an operator's limiter is written against it.
		const limiter: RateLimiter = neverLimited;
		await expect(limiter.check('connect:203.0.113.7')).resolves.toEqual({ allowed: true });
	});
});
