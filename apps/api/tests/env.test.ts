import { describe, expect, it } from 'vitest';

import { importSecretKey, signingKey } from '../src/crypto.js';
import { parseEnv } from '../src/env.js';

const base = {
	APP_ORIGIN: 'https://memoriam.example.com',
	// Exactly 32 bytes once decoded, which `parseEnv` insists on.
	SECRETS_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
};

/** The default provider's credentials, for a test about something else. */
const dropbox = { DROPBOX_CLIENT_ID: 'd', DROPBOX_CLIENT_SECRET: 'ds' };

describe('parseEnv', () => {
	/**
	 * One provider by default. Defaulting to all three would make a deployment
	 * that set no `ENABLED_PROVIDERS` refuse to boot until its operator had
	 * registered apps with Google *and* Microsoft as well as Dropbox.
	 */
	it('defaults to Dropbox alone', () => {
		const config = parseEnv({ ...base, ...dropbox });
		expect(config.enabledProviders).toEqual(['dropbox']);
		expect(config.secretsKeyId).toBe('k1');
	});

	it('parses ENABLED_PROVIDERS and ignores whitespace', () => {
		const config = parseEnv({
			...base,
			...dropbox,
			ENABLED_PROVIDERS: ' onedrive , dropbox ',
			MICROSOFT_CLIENT_ID: 'm',
			MICROSOFT_CLIENT_SECRET: 'ms',
		});
		expect(config.enabledProviders).toEqual(['onedrive', 'dropbox']);
		expect(config.oauth.onedrive).toEqual({
			clientId: 'm',
			clientSecret: 'ms',
			tenant: 'common',
		});
	});

	it('only builds OAuth credentials for enabled providers', () => {
		const config = parseEnv({
			...base,
			...dropbox,
			ENABLED_PROVIDERS: 'dropbox',
			// Present but unused: gdrive is not enabled.
			GOOGLE_CLIENT_ID: 'g',
			GOOGLE_CLIENT_SECRET: 'gs',
		});
		expect(config.oauth.dropbox).toEqual({ clientId: 'd', clientSecret: 'ds' });
		expect(config.oauth.gdrive).toBeUndefined();
	});

	it('requires credentials for each enabled OAuth provider', () => {
		expect(() => parseEnv({ ...base, ENABLED_PROVIDERS: 'gdrive' })).toThrow(
			/GOOGLE_CLIENT_ID: required because ENABLED_PROVIDERS includes "gdrive"/
		);
	});

	it('rejects an unknown provider', () => {
		expect(() => parseEnv({ ...base, ...dropbox, ENABLED_PROVIDERS: 'icloud' })).toThrow(
			/ENABLED_PROVIDERS/
		);
	});

	it('rejects WebDAV, which skysa-notes deferred and memoriam does not have', () => {
		expect(() => parseEnv({ ...base, ...dropbox, ENABLED_PROVIDERS: 'webdav' })).toThrow(
			/ENABLED_PROVIDERS/
		);
	});

	it('rejects an empty provider list', () => {
		expect(() => parseEnv({ ...base, ENABLED_PROVIDERS: '' })).toThrow(/at least one provider/);
	});

	it('takes nothing from what skysa-notes reads and memoriam has no use for', () => {
		// `AUTH_MODE`, `WEBDAV_ALLOW_PRIVATE` and `RELAY` mean nothing here: left
		// in an environment copied from skysa-notes, they change nothing rather
		// than stopping the boot.
		const config = parseEnv({
			...base,
			...dropbox,
			AUTH_MODE: 'storage-first',
			WEBDAV_ALLOW_PRIVATE: 'true',
			RELAY: 'true',
		});
		expect(Object.keys(config).sort()).toEqual([
			'appOrigin',
			'cookiesSecure',
			'enabledProviders',
			'oauth',
			'secretsKey',
			'secretsKeyId',
		]);
	});

	it('rejects a missing or malformed APP_ORIGIN', () => {
		expect(() => parseEnv({ SECRETS_KEY: 'x', ...dropbox })).toThrow(/APP_ORIGIN/);
		expect(() => parseEnv({ ...base, ...dropbox, APP_ORIGIN: 'notaurl' })).toThrow(
			/APP_ORIGIN/
		);
	});

	it('strips a trailing slash from APP_ORIGIN so redirect URIs concatenate cleanly', () => {
		const config = parseEnv({
			...base,
			...dropbox,
			APP_ORIGIN: 'https://memoriam.example.com/',
		});
		expect(config.appOrigin).toBe('https://memoriam.example.com');
	});

	it('lists every problem at once', () => {
		try {
			parseEnv({ ENABLED_PROVIDERS: 'gdrive' });
			expect.unreachable('should have thrown');
		} catch (err) {
			const message = (err as Error).message;
			expect(message).toContain('APP_ORIGIN');
			expect(message).toContain('SECRETS_KEY');
			expect(message).toContain('GOOGLE_CLIENT_ID');
		}
	});
});

describe('SECRETS_KEY', () => {
	it('insists on exactly 32 bytes, at boot rather than at first use', () => {
		// AES-256 needs a 256-bit key. A short one would otherwise be accepted
		// here and fail the first time somebody tried to connect an account.
		const short = btoa('0123456789abcdef');

		expect(() => parseEnv({ ...base, ...dropbox, SECRETS_KEY: short })).toThrow(/32 bytes/);
	});

	it('rejects a value that is not base64 at all', () => {
		expect(() => parseEnv({ ...base, ...dropbox, SECRETS_KEY: 'not base64!!' })).toThrow(
			/32 bytes/
		);
	});

	it('accepts a key generated the way the docs say to generate one', () => {
		// `openssl rand -base64 32` — standard alphabet, padded.
		const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

		expect(() => parseEnv({ ...base, ...dropbox, SECRETS_KEY: key })).not.toThrow();
	});
});

describe('cookiesSecure', () => {
	it('is on for an https origin', () => {
		expect(
			parseEnv({ ...base, ...dropbox, APP_ORIGIN: 'https://memoriam.example.com' })
				.cookiesSecure
		).toBe(true);
	});

	it('is off for plain-http local development, where a secure cookie is never sent', () => {
		expect(
			parseEnv({ ...base, ...dropbox, APP_ORIGIN: 'http://localhost:5173' }).cookiesSecure
		).toBe(false);
	});
});

describe('what the first draft got wrong', () => {
	it('accepts exactly the keys the crypto module can import', async () => {
		// The validator normalized `-`/`_` before measuring; the decoder did not.
		// A base64url key therefore passed the boot check and then failed on every
		// request, as a 500 from `/api/health` rather than as misconfiguration.
		const key = '-wIJEBceJSwzOkFIT1ZdZGtyeYCHjpWco6qxuL_GzdQ=';
		const config = parseEnv({ ...base, ...dropbox, SECRETS_KEY: key });

		await expect(importSecretKey(config.secretsKey, 'k1')).resolves.toBeDefined();
		await expect(signingKey(config.secretsKey)).resolves.toBeDefined();
	});
});
