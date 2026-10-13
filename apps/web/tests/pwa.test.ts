import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { loadBrand } from '../brand.js';
import { PWA_WORKBOX, pwaManifest, pwaOptions } from '../pwa.js';
import { createAppRouter } from '../src/router.js';

/**
 * The installability checklist.
 *
 * A browser decides whether to offer "install" by applying rules it never
 * reports on: no name, no 192px icon, no `display`, an icon that 404s — and the
 * option simply never appears, with nothing in the build output to explain it.
 * These are those rules, plus the ones that make the app work with no network.
 * See docs/ARCHITECTURE.md §8.
 */

const brand = loadBrand();

/** Width and height out of a PNG's IHDR chunk, which is always the first one. */
const pngSize = (file: string): { width: number; height: number } => {
	const icon = brand.icons.find((given) => given.file === file);
	expect(icon, `the brand has no ${file}`).toBeDefined();
	const bytes = readFileSync(icon?.path ?? '');
	expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
};

const manifest = pwaManifest(brand);
const options = pwaOptions(brand);
const workbox = PWA_WORKBOX;

/**
 * Whether the worker answers a navigation to `pathAndSearch` with the shell,
 * decided as Workbox's `NavigationRoute` decides it: the denylist first, then
 * the allowlist.
 */
const shellAnswers = (pathAndSearch: string): boolean =>
	!(workbox.navigateFallbackDenylist ?? []).some((pattern) => pattern.test(pathAndSearch)) &&
	(workbox.navigateFallbackAllowlist ?? []).some((pattern) => pattern.test(pathAndSearch));

describe('the web app manifest', () => {
	it('names the app, for the install prompt and the home screen', () => {
		// The default brand's: a deployment names it in its own (brand.ts).
		expect(manifest.name).toBe('Memoriam');
		expect(options.manifest).toEqual(manifest);
		// Truncated under an icon, so it has to be short enough to survive.
		expect(manifest.short_name).toBeDefined();
		expect((manifest.short_name ?? '').length).toBeLessThanOrEqual(12);
	});

	it('opens standalone from a start URL inside its own scope', () => {
		expect(manifest.display).toBe('standalone');
		expect(manifest.start_url).toBe('/');
		expect(manifest.scope).toBe('/');
		expect(manifest.start_url?.startsWith(manifest.scope ?? '')).toBe(true);
	});

	it('has the icon sizes an install needs', () => {
		const sizes = (manifest.icons ?? []).map((icon) => icon.sizes);
		expect(sizes).toContain('192x192');
		expect(sizes).toContain('512x512');
	});

	it('has a maskable icon, so Android does not letterbox it', () => {
		const maskable = (manifest.icons ?? []).filter((icon) =>
			(icon.purpose ?? '').includes('maskable')
		);
		expect(maskable).not.toHaveLength(0);
		expect(maskable.map((icon) => icon.sizes)).toContain('512x512');
	});

	it('ships every icon it promises, at the size it promises', () => {
		// A manifest entry pointing at a missing file fails the install silently.
		(manifest.icons ?? []).forEach((icon) => {
			const [width, height] = (icon.sizes ?? '').split('x').map(Number);
			expect(pngSize(icon.src)).toEqual({ width, height });
		});
	});

	it("opens on the brand's background, so it does not start as a white window", () => {
		expect(manifest.background_color).toBeDefined();
	});

	// Chrome paints an installed app's navigation bar with `theme_color` where
	// it can, Android 14 and older; from Android 15 the bar is the
	// `background_color` under it, the brand's `background` (2026-10-11).
	it("colours the navigation bar with the brand's own colour, where Chrome can paint it", () => {
		expect(manifest.theme_color).toBe(brand.colors.light.brand);
	});
});

describe('the service worker', () => {
	it('precaches the app shell, so a cold start needs no network', () => {
		const patterns = workbox.globPatterns ?? [];
		expect(patterns.join(' ')).toContain('js');
		expect(patterns.join(' ')).toContain('css');
		expect(patterns.join(' ')).toContain('html');
	});

	it('serves every route from the shell, so a deep link opens offline', () => {
		expect(workbox.navigateFallback).toBe('index.html');
	});

	it('never answers an API call with the shell', () => {
		const denied = workbox.navigateFallbackDenylist ?? [];
		expect(denied.some((pattern) => pattern.test('/api/token'))).toBe(true);
		expect(denied.some((pattern) => pattern.test('/'))).toBe(false);
		expect(shellAnswers('/api/token')).toBe(false);
	});

	it('answers a deep link into the app with the shell', () => {
		// A link to a passage is `/#/passage/…`, and a fragment is never part
		// of the request; what another page leaves for the app is in the query.
		expect(shellAnswers('/')).toBe(true);
		expect(shellAnswers('/?from=install')).toBe(true);
	});

	it('leaves any other page on the origin to the network', () => {
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

	it('waits to be told before taking over a page', () => {
		// A worker that claimed the page mid-pass could swap the app out from
		// under a pass that has not been recorded yet.
		expect(options.registerType).toBe('prompt');
	});

	it('is registered by the app, not by a script written into the page', () => {
		// `'inline'` would be refused by the Content-Security-Policy.
		expect(options.injectRegister).toBe(false);
	});
});
