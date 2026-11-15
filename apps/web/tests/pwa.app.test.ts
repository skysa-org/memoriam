import { loadBrand, pwaManifest, pwaWorkbox } from '@skysa/pwa';
import { workerOf } from '@skysa/pwa/testing';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND, MEMORIAM_PWA } from '../pwaApp.js';
import { createAppRouter } from '../src/router.js';

/**
 * What this app hands the build of its own (`pwaApp.ts`): its one route. The
 * build's own checklist is the shared kit's (`@skysa/pwa`).
 */

const manifest = pwaManifest(loadBrand(DEFAULT_BRAND), MEMORIAM_PWA);
const workbox = pwaWorkbox(MEMORIAM_PWA);
const { shellAnswers } = workerOf(workbox);

describe('the web app manifest, in this app', () => {
	it('names the app as its default brand does', () => {
		expect(manifest.name).toBe('Memoriam');
	});

	it('is no share target', () => {
		expect(manifest.share_target).toBeUndefined();
	});
});

describe('the service worker, in this app', () => {
	it('answers a deep link into the app with the shell', () => {
		// A link to a passage is `/#/passage/…`, and a fragment is never part
		// of the request; what another page leaves for the app is in the query.
		expect(shellAnswers('/')).toBe(true);
		expect(shellAnswers('/?from=install')).toBe(true);
		expect(shellAnswers('/?connect=ok')).toBe(true);
	});

	it("leaves any other page on the origin to the network, such as an operator's", () => {
		// Answered with the shell, it would open as the app's "Not found".
		expect(shellAnswers('/subscribe')).toBe(false);
		expect(shellAnswers('/about?x=1')).toBe(false);
	});

	it('answers every route the router has with the shell', () => {
		// Each screen is a fragment on `/`, which is all the request carries,
		// so a route added under `src/routes` opens offline with nothing to add
		// to the allowlist.
		const router = createAppRouter();
		const paths = Object.keys(router.routesByPath);
		expect(paths).toContain('/library');
		paths.forEach((path) => {
			const requested = new URL(router.history.createHref(path), 'https://memoriam.test');
			expect(`${requested.pathname}${requested.search}`, path).toBe('/');
			expect(shellAnswers(requested.pathname), path).toBe(true);
		});
	});

	it('answers no POST itself', () => {
		// It is no share target, and nothing else posts to it.
		expect(workbox.runtimeCaching?.filter((rule) => (rule.method ?? 'GET') !== 'GET')).toEqual(
			[]
		);
	});
});
