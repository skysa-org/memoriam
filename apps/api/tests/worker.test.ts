import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/worker.js';

const env = {
	APP_ORIGIN: 'https://memoriam.example.com',
	SECRETS_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
	ENABLED_PROVIDERS: 'webdav',
} as unknown as Parameters<typeof worker.fetch>[1];

const ctx = {} as ExecutionContext;

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the Worker entry', () => {
	/**
	 * The kit's rule (skysa-notes #450): a setting that does nothing still
	 * boots, and the operator is told so once. Webdav, which no server of this
	 * app has offered, is not built, so it is not offered either. One test,
	 * because the entry builds its app once per isolate and keeps it.
	 */
	it('warns of a setting that does nothing once, and does not offer webdav', async () => {
		const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		const config = () =>
			worker.fetch(new Request('https://memoriam.example.com/api/config'), env, ctx);

		const first = await config();
		await config();

		expect(first.status).toBe(200);
		expect((await first.json<{ providers: unknown }>()).providers).toEqual([]);
		expect(warned.mock.calls.map(([line]) => String(line))).toEqual([
			expect.stringMatching(/^Environment: ENABLED_PROVIDERS: webdav is not built/),
		]);
	});
});
