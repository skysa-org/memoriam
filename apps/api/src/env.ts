import { PROVIDER_KINDS, type ProviderKind } from '@memoriam/core';
import { z } from 'zod';

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
				return atob(value.replace(/-/g, '+').replace(/_/g, '/')).length === 32;
			} catch {
				return false;
			}
		}, 'SECRETS_KEY must be base64 of exactly 32 bytes'),
	/** Names the current key so rows encrypted with an older one stay readable. */
	SECRETS_KEY_ID: z.string().min(1).default('k1'),

	GOOGLE_CLIENT_ID: z.string().optional(),
	GOOGLE_CLIENT_SECRET: z.string().optional(),
	MICROSOFT_CLIENT_ID: z.string().optional(),
	MICROSOFT_CLIENT_SECRET: z.string().optional(),
	/** Entra tenant; `common` covers personal and work accounts. */
	MICROSOFT_TENANT: z.string().min(1).default('common'),
	DROPBOX_CLIENT_ID: z.string().optional(),
	DROPBOX_CLIENT_SECRET: z.string().optional(),
});

export type AppConfig = {
	enabledProviders: ProviderKind[];
	appOrigin: string;
	/** False only for a plain-HTTP origin, which in practice means localhost. */
	cookiesSecure: boolean;
	secretsKey: string;
	secretsKeyId: string;
	oauth: {
		gdrive?: { clientId: string; clientSecret: string };
		onedrive?: { clientId: string; clientSecret: string; tenant: string };
		dropbox?: { clientId: string; clientSecret: string };
	};
};

/** Which env vars a given storage provider needs before it can be enabled. */
const OAUTH_ENV_KEYS = {
	gdrive: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
	onedrive: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET'],
	dropbox: ['DROPBOX_CLIENT_ID', 'DROPBOX_CLIENT_SECRET'],
} as const satisfies Record<ProviderKind, readonly string[]>;

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

	return providers.data.flatMap((provider) =>
		OAUTH_ENV_KEYS[provider]
			.filter((key) => !raw[key])
			.map((key) => `${key}: required because ENABLED_PROVIDERS includes "${provider}"`)
	);
};

export const parseEnv = (raw: unknown): AppConfig => {
	const record = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
	const result = rawEnvSchema.safeParse(record);

	const issues = [
		...(result.success
			? []
			: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)),
		...missingCredentialIssues(record),
	];
	if (!result.success || issues.length > 0) {
		throw new Error(`Invalid environment:\n${issues.map((i) => `  ${i}`).join('\n')}`);
	}

	const env = result.data;

	const oauth: AppConfig['oauth'] = {
		...(env.ENABLED_PROVIDERS.includes('gdrive') && {
			gdrive: oauthCredentials.parse({
				clientId: env.GOOGLE_CLIENT_ID,
				clientSecret: env.GOOGLE_CLIENT_SECRET,
			}),
		}),
		...(env.ENABLED_PROVIDERS.includes('onedrive') && {
			onedrive: {
				...oauthCredentials.parse({
					clientId: env.MICROSOFT_CLIENT_ID,
					clientSecret: env.MICROSOFT_CLIENT_SECRET,
				}),
				tenant: env.MICROSOFT_TENANT,
			},
		}),
		...(env.ENABLED_PROVIDERS.includes('dropbox') && {
			dropbox: oauthCredentials.parse({
				clientId: env.DROPBOX_CLIENT_ID,
				clientSecret: env.DROPBOX_CLIENT_SECRET,
			}),
		}),
	};

	return {
		enabledProviders: env.ENABLED_PROVIDERS,
		appOrigin: env.APP_ORIGIN.replace(/\/$/, ''),
		cookiesSecure: env.APP_ORIGIN.startsWith('https://'),
		secretsKey: env.SECRETS_KEY,
		secretsKeyId: env.SECRETS_KEY_ID,
		oauth,
	};
};
