/**
 * The API's answers that are not the thing asked for, as the Worker gives them
 * and the app reads them, and the app's `Refusal` is a part of this list. The
 * Worker is the shared kit's server, which answers from the kit's list
 * (`API_ERROR_CODES` in `@skysa/protocol`), and every code here is one of its,
 * which `apps/api/tests/errorCodes.test.ts` holds.
 *
 * Each is `{ error: code }`, with its HTTP status. The kit's list also has its
 * change relay's codes and `not_entitled`, its operator's policy saying no; this
 * app's entry runs neither (docs/ARCHITECTURE.md §10, "The server").
 */
export const API_ERROR_CODES = [
	/** 401: no credential was presented. */
	'credential_required',
	/** 401: the credential reaches nothing: revoked, or its account disconnected. */
	'credential_revoked',
	/** 404: no such route, connection or provider flow. */
	'not_found',
	/** 500: the Worker failed in a way it has logged. */
	'internal_error',
	/** 500: the deployment's environment does not parse; the Worker has logged why. */
	'server_misconfigured',
	/** 429: the deployment's rate limiter said no, with `Retry-After` where it gave one. */
	'rate_limited',
	/**
	 * 404: a provider this deployment has no flow for, or does not offer. The
	 * OAuth callback sends the browser back to the app instead, as it does for
	 * every failure.
	 */
	'unsupported_provider',
	/** 501: a provider offered without the credentials to reach it; the callback, as above. */
	'provider_not_configured',
	/** 403: a request that did not come from a page on this deployment's origin. */
	'forbidden_origin',
	/** 400: a body or query that does not parse. */
	'invalid_request',
	/** 401: the provider will not renew the grant: connect the account again. */
	'reauthorize_required',
	/** 502: the provider did not answer the renewal. */
	'provider_unavailable',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
