import { cell } from '@skysa/storage';

import { createApp, envWarnings, misconfigured, parseEnv } from './index.js';

/**
 * The default Worker entry: the only module in `apps/api` that reads the
 * environment. An operator who needs different behavior writes their own entry
 * that imports `createApp` and passes its own seams, instead of forking.
 */

type AppOrError = ReturnType<typeof createApp> | Error;

/**
 * Built once per isolate. A cell so the cache is an explicit, single-purpose
 * piece of state rather than ambient module mutation.
 */
const cache = cell<AppOrError | undefined>(undefined);

const build = (env: Env): AppOrError => {
	try {
		// Once per isolate, as the app is built: settings that boot but do nothing.
		// Before the parse, so an environment refused for another reason says
		// these in the same deploy.
		envWarnings(env).forEach((warning) => {
			console.warn(`Environment: ${warning}`);
		});
		const config = parseEnv(env);
		// The kit's server reads `RELAY`, but this entry hands it no relay
		// (docs/ARCHITECTURE.md §10, "The server"), so the setting does nothing,
		// and the operator is told as the kit tells of its own.
		if (config.relay) {
			console.warn(
				'Environment: RELAY: this app runs no change relay, so the setting does nothing ' +
					'(docs/self-hosting.md)'
			);
		}
		return createApp({ config });
	} catch (err) {
		return err instanceof Error ? err : new Error(String(err));
	}
};

const appFor = (env: Env): AppOrError => {
	const cached = cache.current;
	if (cached !== undefined) return cached;

	const built = build(env);
	cache.current = built;
	return built;
};

export default {
	fetch: (request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> => {
		const app = appFor(env);

		if (app instanceof Error) return misconfigured(app);
		return app.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
