import { afterEach, describe, expect, it, vi } from 'vitest';

import type * as entry from '../src/index.js';
import worker from '../src/worker.js';

/**
 * The Worker entry over a parse that throws something other than an `Error`.
 * The kit's `parseEnv` throws only errors, but the entry answers whatever is
 * thrown as a refused environment rather than letting it escape. A file of its
 * own, since the entry builds its app once per isolate and keeps it.
 */

vi.mock('../src/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof entry>()),
	parseEnv: () => {
		// eslint-disable-next-line @typescript-eslint/only-throw-error -- what this file tests
		throw 'not an Error';
	},
}));

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the Worker entry, over a parse that throws a non-Error', () => {
	it('answers server_misconfigured, and logs what was thrown', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const answer = await worker.fetch(
			new Request('https://memoriam.example.com/api/config'),
			{} as Parameters<typeof worker.fetch>[1],
			{} as ExecutionContext
		);

		expect(answer.status).toBe(500);
		expect(await answer.json()).toEqual({ error: 'server_misconfigured' });
		expect(logged.mock.calls.map(([line]) => String(line)).join('\n')).toContain(
			'not an Error'
		);
	});
});
