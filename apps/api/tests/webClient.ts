import { PROVIDER_KINDS, type ProviderKind } from '@memoriam/core';
import { z } from 'zod';

/**
 * What the web app's API client (`apps/web/src/api/client.ts`) parses this
 * Worker's answers with, copied as it is written there.
 *
 * Copied, not imported: the client is browser code, and its `fetch` options
 * (`credentials`) are not in the Workers runtime's `RequestInit`, so it does
 * not typecheck in this package. `contract.test.ts` checks that every schema
 * here still appears in the client, character for character but for comments
 * and whitespace, so the copy cannot drift from what the app runs.
 */

export const configSchema = z.object({
	providers: z
		.array(z.string())
		.transform((kinds) =>
			kinds.filter((kind): kind is ProviderKind =>
				(PROVIDER_KINDS as readonly string[]).includes(kind)
			)
		),
});

export const connectionSchema = z.object({
	id: z.string().min(1),
	provider: z.enum(PROVIDER_KINDS),
	displayName: z.string().nullable(),
	accountId: z.string().nullable().default(null),
	createdAt: z.number(),
	lastUsedAt: z.number().nullable(),
	grantId: z.string().min(1),
});

export const grantSchema = z.object({
	id: z.string().min(1),
	createdAt: z.number(),
	lastUsedAt: z.number(),
	expired: z.boolean().default(false),
	current: z.boolean(),
	device: z.string().optional(),
});

export const grantsSchema = z.object({ grants: z.array(grantSchema) });

/** `revokeGrant`'s, written inline in the client. */
export const revokeSchema = z.object({ ok: z.boolean() });

/** `signOut`'s, written inline in the client. */
export const signOutSchema = z.object({ disconnected: z.boolean().default(false) });

export const authorizeSchema = z.object({ authorizeUrl: z.url() });

export const tokenSchema = z.object({ accessToken: z.string().min(1), expiresAt: z.number() });

export const errorSchema = z.object({ error: z.string() });

/**
 * The errors the client answers in words rather than throwing for. Any other
 * error, or a body that is not one, it throws on as a failure to report.
 */
export const REFUSALS: readonly string[] = [
	'credential_required',
	'credential_revoked',
	'reauthorize_required',
	'not_entitled',
	'not_found',
	'forbidden_origin',
];
