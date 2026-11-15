import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/worker.js';

const env = {
	APP_ORIGIN: 'https://memoriam.example.com',
	SECRETS_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
	ENABLED_PROVIDERS: 'webdav',
	RELAY: 'false',
} as unknown as Parameters<typeof worker.fetch>[1];

const ctx = {} as ExecutionContext;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the Worker entry', () => {
	/**
	 * The kit's rule (skysa-notes #450): a setting that does nothing still
	 * boots, and the operator is told so once. Webdav, which no server of this
	 * app has offered, is not built, so it is not offered either; nor is the
	 * relay while it is off (`worker.relay.test.ts` has it on). One test,
	 * because the entry builds its app once per isolate and keeps it.
	 */
	it('warns of settings that do nothing once, and offers neither webdav nor a relay that is off', async () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const config = () =>
			worker.fetch(new Request('https://memoriam.example.com/api/config'), env, ctx);

		const first = await config();
		await config();

		expect(first.status).toBe(200);
		const answer = await first.json<{ providers: unknown; relay?: unknown }>();
		expect(answer.providers).toEqual([]);
		expect(answer.relay).toBeFalsy();
		expect(warned.mock.calls.map(([line]) => String(line))).toEqual([
			expect.stringMatching(/^Environment: ENABLED_PROVIDERS: webdav is not built/),
		]);
	});
});
