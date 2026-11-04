import { PROVIDER_KINDS, type ProviderKind } from '@memoriam/core';
import { z } from 'zod';

import { fromBase64Url } from './crypto.js';
import { formatIssues } from './json.js';
import { isOAuthProvider, type OAuthProviderKind } from './oauth/providers.js';
import type { OAuthCredentials } from './oauth/types.js';

/**
 * Validation for the operator's environment. This module never reads the
 * environment itself — `src/worker.ts` is the only place that touches it and
 * passes the result into `createApp`. See skysa-notes' `docs/ARCHITECTURE.md`
 * §6.
 */

const providerList = z
	.string()
	.transform((v) =>
		v
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
	)
	.pipe(
		z
			.array(z.enum(PROVIDER_KINDS))
			.nonempty('ENABLED_PROVIDERS must name at least one provider')
	);

/**
 * Each OAuth provider's settings, by name: the one place they are spelled out.
 * Keyed by the flows in `oauth/providers.ts`, so a provider with a flow and no
 * settings here, or settings and no flow, does not compile; the schema, the
 * check that an enabled provider has its settings, and the credentials
 * `createApp` is handed all read it.
 */
const OAUTH_ENV = {
	gdrive: { id: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_CLIENT_SECRET' },
	onedrive: { id: 'MICROSOFT_CLIENT_ID', secret: 'MICROSOFT_CLIENT_SECRET' },
	dropbox: { id: 'DROPBOX_CLIENT_ID', secret: 'DROPBOX_CLIENT_SECRET' },
} as const satisfies Record<OAuthProviderKind, { id: string; secret: string }>;

type CredentialVar = (typeof OAUTH_ENV)[OAuthProviderKind]['id' | 'secret'];

/** Every provider's two settings, optional here: whether one is required is `missingCredentialIssues`'s to say. */
const credentialVars = Object.fromEntries(
	Object.values(OAUTH_ENV)
		.flatMap(({ id, secret }) => [id, secret])
		.map((name) => [name, z.string().optional()])
) as Record<CredentialVar, z.ZodOptional<z.ZodString>>;

const oauthCredentials = z.object({
	clientId: z.string().min(1),
	clientSecret: z.string().min(1),
});

const rawEnvSchema = z.object({
	// `prefault` (not `default`): the fallback is the raw string, fed through the
	// same split-and-validate pipeline as an operator-supplied value.
	//
	// One provider, not all three. Defaulting to all of them would refuse to
	// boot until an operator had registered apps with Google *and* Microsoft as
	// well as Dropbox.
	ENABLED_PROVIDERS: providerList.prefault('dropbox'),

	/** Public origin of this deployment; OAuth redirect URIs are built from it. */
	APP_ORIGIN: z.url(),

	/**
	 * Base64 of 32 random bytes. `openssl rand -base64 32`.
	 *
	 * Checked here rather than at first use: a key of the wrong length is an
	 * operator mistake, and finding it at boot is the difference between a
	 * deployment that refuses to start and one that fails the first time
	 * somebody tries to connect an account.
	 */
	SECRETS_KEY: z
		.string()
		.min(1)
		.refine((value) => {
			try {
				// The decoder `importSecretKey` uses, so the two agree on every key.
				return fromBase64Url(value).length === 32;
			} catch {
				return false;
			}
		}, 'SECRETS_KEY must be base64 of exactly 32 bytes'),
	/** Names the current key so rows encrypted with an older one stay readable. */
	SECRETS_KEY_ID: z.string().min(1).default('k1'),

	...credentialVars,
	/** Entra tenant; `common` covers personal and work accounts. */
	MICROSOFT_TENANT: z.string().min(1).default('common'),
});

export type AppConfig = {
	enabledProviders: ProviderKind[];
	appOrigin: string;
	/** False only for a plain-HTTP origin, which in practice means localhost. */
	cookiesSecure: boolean;
	secretsKey: string;
	secretsKeyId: string;
	/** Each enabled OAuth provider's app; OneDrive's carries its tenant. */
	oauth: Partial<Record<OAuthProviderKind, OAuthCredentials>>;
};

/**
 * Cross-field rules, checked separately from the object schema.
 *
 * Zod skips refinements once the base object fails, which would make an
 * operator fix one missing variable per run. Running these independently means
 * a single run reports everything that is wrong.
 */
const missingCredentialIssues = (raw: Record<string, unknown>): string[] => {
	const providers = rawEnvSchema.shape.ENABLED_PROVIDERS.safeParse(raw.ENABLED_PROVIDERS);
	if (!providers.success) return [];

	return providers.data
		.filter(isOAuthProvider)
		.flatMap((provider) =>
			[OAUTH_ENV[provider].id, OAUTH_ENV[provider].secret]
				.filter((key) => !raw[key])
				.map((key) => `${key}: required because ENABLED_PROVIDERS includes "${provider}"`)
		);
};

export const parseEnv = (raw: unknown): AppConfig => {
	const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const result = rawEnvSchema.safeParse(record);

	const issues = [
		...(result.success ? [] : formatIssues(result.error.issues)),
		...missingCredentialIssues(record),
	];
	if (!result.success || issues.length > 0) {
		throw new Error(`Invalid environment:\n${issues.map((i) => `  ${i}`).join('\n')}`);
	}

	const env = result.data;

	const oauth = env.ENABLED_PROVIDERS.filter(isOAuthProvider).reduce<AppConfig['oauth']>(
		(built, provider) => ({
			...built,
			[provider]: {
				...oauthCredentials.parse({
					clientId: env[OAUTH_ENV[provider].id],
					clientSecret: env[OAUTH_ENV[provider].secret],
				}),
				// Microsoft's alone: which accounts may sign in.
				...(provider === 'onedrive' && { tenant: env.MICROSOFT_TENANT }),
			},
		}),
		{}
	);

	return {
		enabledProviders: env.ENABLED_PROVIDERS,
		appOrigin: env.APP_ORIGIN.replace(/\/$/, ''),
		cookiesSecure: env.APP_ORIGIN.startsWith('https://'),
		secretsKey: env.SECRETS_KEY,
		secretsKeyId: env.SECRETS_KEY_ID,
		oauth,
	};
};
