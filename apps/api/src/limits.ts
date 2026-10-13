/**
 * The seam through which an operator throttles the endpoints that cost money.
 *
 * Not a Cloudflare binding, because a binding would be deployment-specific code
 * in a repo that forbids it, and because the two endpoints worth throttling —
 * starting a connect flow and its callback — each spend an *outbound* provider
 * call per attempt. That is the one thing an attacker can make a deployment pay
 * for without holding a credential. This repo ships only `neverLimited`.
 *
 * In `packages/core/src/entitlements.ts` in skysa-notes, beside its entitlement
 * policy. Memoriam has no entitlement policy, so the limiter lives here, with
 * the only code that asks it.
 */
export interface RateLimitDecision {
	allowed: boolean;
	/** Seconds until the caller may retry, for a `Retry-After` header. */
	retryAfter?: number;
}

export interface RateLimiter {
	/**
	 * `key` names what is being limited — an operator decides whether that is an
	 * IP, a provider, or both. It never contains a secret.
	 */
	readonly check: (key: string) => Promise<RateLimitDecision>;
}

export const neverLimited: RateLimiter = {
	check: () => Promise.resolve({ allowed: true }),
};
