import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import { hashCredential } from '../src/credentials.js';
import { allProvidersConfig, ANY_HASH, buildApp, newCredential } from './harness.js';
import {
	authorizeSchema,
	configSchema,
	connectionSchema,
	errorSchema,
	grantsSchema,
	REFUSALS,
	revokeSchema,
	signOutSchema,
	tokenSchema,
} from './webClient.js';

/**
 * The contract with the web app: what this Worker answers, parsed with the
 * schemas the app's API client parses it with (`apps/web/src/api/client.ts`,
 * mirrored in `webClient.ts`). The client throws on a body it cannot read, so
 * a field renamed or retyped on either side fails here, and not first on a
 * device.
 */

const CLIENT = new URL('../../web/src/api/client.ts', import.meta.url).pathname;
const MIRROR = new URL('./webClient.ts', import.meta.url).pathname;

/** Source with its comments and whitespace gone, so only the code is compared. */
const code = (path: string): string =>
	readFileSync(path, 'utf8')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/\/\/[^\n]*/g, '')
		.replace(/\s+/g, '');

/** What a body parses to with the client's schema, or a failure that says why. */
const parsed = async <T>(response: Response, schema: z.ZodType<T>): Promise<T> => {
	const result = schema.safeParse(await response.json());
	if (!result.success) throw new Error(`the client cannot read it: ${result.error.message}`);
	return result.data;
};

/** A refusal the client answers in words: an `error` it knows, and not a throw. */
const refusal = async (response: Response): Promise<string> => {
	expect(response.ok).toBe(false);
	const { error } = await parsed(response, errorSchema);
	expect(REFUSALS).toContain(error);
	return error;
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe('the mirror of the client', () => {
	it('is what the client runs: every schema, and the refusals it knows', () => {
		const client = code(CLIENT);
		const mirror = code(MIRROR);

		// Each schema's definition, `z.object(…)` up to its `;`, named or inline.
		const schemas = [...mirror.matchAll(/exportconst\w+Schema=(z\.[^;]*);/g)].map(
			([, definition]) => definition ?? ''
		);
		expect(schemas).toHaveLength(9);
		// The ones the client no longer has, as the mirror writes them.
		expect(schemas.filter((definition) => !client.includes(definition))).toEqual([]);

		const refusals = (source: string) =>
			/REFUSALS:readonly\w+\[\]=(\[[^\]]*\])/.exec(source)?.[1];
		expect(refusals(mirror)).toBeDefined();
		expect(refusals(client)).toBe(refusals(mirror));
	});
});

describe('what this Worker answers, read as the client reads it', () => {
	it('/config: the providers this instance offers, and nothing else', async () => {
		const app = buildApp({ config: allProvidersConfig() });
		const response = await app.request('/api/config');

		// skysa-notes' server also says `authMode`, a gate and the relay. This
		// one says none of them.
		expect(await response.clone().json()).toEqual({
			providers: ['dropbox', 'onedrive', 'gdrive'],
		});
		expect(await parsed(response, configSchema)).toEqual({
			providers: ['dropbox', 'onedrive', 'gdrive'],
		});
	});

	it('/auth/connect/:provider/start: a URL to send the browser to', async () => {
		const app = buildApp();
		const response = await app.startConnect('dropbox', {
			credentialHash: await hashCredential(newCredential()),
			returnTo: '/settings',
		});

		const { authorizeUrl } = await parsed(response, authorizeSchema);
		expect(new URL(authorizeUrl).origin).toBe('https://www.dropbox.com');
	});

	it('/connection: the connection this device holds', async () => {
		const app = buildApp();
		const { credential } = await app.connect();

		const connection = await parsed(
			await app.request('/api/connection', { credential }),
			connectionSchema
		);

		expect(connection).toEqual({
			id: expect.any(String) as unknown,
			provider: 'dropbox',
			displayName: 'user@example.com',
			accountId: 'dbid:1',
			createdAt: expect.any(Number) as unknown,
			lastUsedAt: expect.any(Number) as unknown,
			grantId: expect.any(String) as unknown,
		});
	});

	it('/connection/grants: the devices holding it, this one marked', async () => {
		const app = buildApp();
		const mine = await app.connect({
			userAgent:
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
		});
		await app.connect();

		const { grants } = await parsed(
			await app.request('/api/connection/grants', { credential: mine.credential }),
			grantsSchema
		);

		expect(grants).toHaveLength(2);
		expect(grants.filter((grant) => grant.current)).toEqual([
			{
				id: expect.any(String) as unknown,
				createdAt: expect.any(Number) as unknown,
				lastUsedAt: expect.any(Number) as unknown,
				expired: false,
				current: true,
				device: 'Chrome on Mac',
			},
		]);
	});

	it('DELETE /connection/grants/:id: another device revoked, and this one signed out', async () => {
		const app = buildApp();
		const mine = await app.connect();
		const other = await app.connect();
		const { grants } = await parsed(
			await app.request('/api/connection/grants', { credential: mine.credential }),
			grantsSchema
		);
		const revoke = (grantId: string) =>
			app.request(`/api/connection/grants/${encodeURIComponent(grantId)}`, {
				method: 'DELETE',
				credential: mine.credential,
			});

		// Another device (`revokeGrant`): the account stays.
		const theirs = grants.find((grant) => !grant.current)?.id ?? '';
		expect(await parsed(await revoke(theirs), revokeSchema)).toEqual({ ok: true });
		expect(
			await refusal(await app.request('/api/connection', { credential: other.credential }))
		).toBe('credential_revoked');

		// This one, the last (`signOut`): the account goes with it, and says so.
		const own = grants.find((grant) => grant.current)?.id ?? '';
		expect(await parsed(await revoke(own), signOutSchema)).toEqual({ disconnected: true });
	});

	it('DELETE /connection/grants/:id: a sign-out that leaves another device connected', async () => {
		const app = buildApp();
		const mine = await app.connect();
		await app.connect();
		const { grantId } = await parsed(
			await app.request('/api/connection', { credential: mine.credential }),
			connectionSchema
		);

		const response = await app.request(`/api/connection/grants/${grantId}`, {
			method: 'DELETE',
			credential: mine.credential,
		});
		expect(await parsed(response, signOutSchema)).toEqual({ disconnected: false });
	});

	it('/token: an access token, and when it expires', async () => {
		const app = buildApp();
		const { credential } = await app.connect();

		const token = await parsed(
			await app.request('/api/token', { method: 'POST', credential }),
			tokenSchema
		);

		expect(token).toEqual({
			accessToken: 'access-1',
			expiresAt: expect.any(Number) as unknown,
		});
		// Dropbox's four hours, as the absolute time the client compares with.
		expect(token.expiresAt).toBeGreaterThan(Date.now() + 3 * 60 * 60 * 1000);
	});
});

describe('the refusals the client answers in words', () => {
	it('credential_required, for a device with no credential', async () => {
		const app = buildApp();

		expect(await refusal(await app.request('/api/connection'))).toBe('credential_required');
		expect(await refusal(await app.request('/api/token', { method: 'POST' }))).toBe(
			'credential_required'
		);
	});

	it('credential_revoked, for a credential this server does not know', async () => {
		const app = buildApp();
		await app.connect();

		const response = await app.request('/api/token', {
			method: 'POST',
			credential: newCredential(),
		});
		expect(await refusal(response)).toBe('credential_revoked');
	});

	it('not_found, for a grant that is not on its connection', async () => {
		const app = buildApp();
		const { credential } = await app.connect();

		const response = await app.request('/api/connection/grants/nope', {
			method: 'DELETE',
			credential,
		});
		expect(await refusal(response)).toBe('not_found');
	});

	it('reauthorize_required, for a grant the provider has withdrawn', async () => {
		const app = buildApp({
			script: { refresh: () => new Response('{"error":"invalid_grant"}', { status: 400 }) },
		});
		const { credential } = await app.connect();

		const response = await app.request('/api/token', { method: 'POST', credential });
		expect(await refusal(response)).toBe('reauthorize_required');
	});

	it('forbidden_origin, for a start from another origin', async () => {
		const app = buildApp();
		const response = await app.request('/api/auth/connect/dropbox/start', {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: 'https://elsewhere.example' },
			body: JSON.stringify({ credentialHash: ANY_HASH, returnTo: '/' }),
		});

		expect(await refusal(response)).toBe('forbidden_origin');
	});

	it('never not_entitled, which this server has no policy to answer', async () => {
		// The client knows the word, from skysa-notes; this server never says
		// it. Every connected device mints.
		const app = buildApp();
		const devices = [await app.connect(), await app.connect()];

		const statuses = await Promise.all(
			devices.map(
				async ({ credential }) =>
					(await app.request('/api/token', { method: 'POST', credential })).status
			)
		);
		expect(statuses).toEqual([200, 200]);
	});

	it('and an outage as an error it does not know, which the client throws on', async () => {
		// Not a refusal the app words: the client throws, and the scheduler
		// backs off and tries again.
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const app = buildApp({
			script: { refresh: () => new Response('upstream down', { status: 503 }) },
		});
		const { credential } = await app.connect();

		const response = await app.request('/api/token', { method: 'POST', credential });
		expect(response.status).toBe(502);
		const { error } = await parsed(response, errorSchema);
		expect(REFUSALS).not.toContain(error);
	});
});
