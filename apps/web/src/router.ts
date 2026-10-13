import { createHashHistory, createRouter, type RouterHistory } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

/**
 * The app's router. Where the app is lives in the hash (docs/ARCHITECTURE.md
 * §7), so the server, and the service worker's one fallback, only ever see
 * `/`: every screen opens offline, and no passage's id is sent anywhere.
 */
export const createAppRouter = (history: RouterHistory = createHashHistory()) =>
	createRouter({
		routeTree,
		history,
		// The app renders from local state before any network call, so there
		// is nothing to wait on at boot.
		defaultPreload: 'intent',
	});

declare module '@tanstack/react-router' {
	interface Register {
		router: ReturnType<typeof createAppRouter>;
	}
}
