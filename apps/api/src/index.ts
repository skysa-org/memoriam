/**
 * What a Worker entry builds on (docs/self-hosting.md), the stock one in
 * `worker.ts` included: the server is the shared kit's (`@skysa/server`), and
 * these are the names this package offers for it, so a deployment's own entry
 * builds the app from what it imports here. `neverLimited` and the rate
 * limiter's types are the names it offered before the kit; `envWarnings` and
 * `misconfigured`, the answer while the config is wrong, are new with it, as
 * is the entitlement seam, a policy of the operator's own with its gate
 * ("Restricting who can sync"). The change relay's Durable Object is
 * `./relay.js`, a module of its own, since it is the Workers runtime's.
 */

export {
	type ConnectCodeCheck,
	type ConnectGate,
	type EntitlementCode,
	type EntitlementContext,
	type EntitlementDecision,
	type EntitlementProvider,
	type EntitlementSubject,
	neverLimited,
	type RateLimitDecision,
	type RateLimiter,
} from '@skysa/protocol';
export {
	type App,
	type AppConfig,
	type AppEnv,
	type AuthedEnv,
	type Bindings,
	createApp,
	type CreateAppOptions,
	envWarnings,
	misconfigured,
	parseEnv,
	type Variables,
} from '@skysa/server';
