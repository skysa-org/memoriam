import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { BRAND_ICONS, brandCss, loadBrand } from '@skysa/pwa';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND } from '../pwaApp.js';

/**
 * This app's own brand, which it builds with when a deployment names none
 * (`DEFAULT_BRAND` in `pwaApp.ts`). How a brand file is read and checked is
 * the shared kit's (`@skysa/pwa`).
 */

// The schema is named apart: its path is the kit's package, which is no one's brand.
const { $schema: schema, ...defaults } = JSON.parse(readFileSync(DEFAULT_BRAND, 'utf8')) as Record<
	string,
	unknown
>;

describe('the default brand', () => {
	// Read in each test, so a brand the kit refuses fails the test that reads it
	// by name, rather than the file as its tests are collected.
	const defaultBrand = () => loadBrand(DEFAULT_BRAND);

	it('is "Memoriam", in indigo, carrying no one’s name', () => {
		const brand = defaultBrand();
		expect(brand.name).toBe('Memoriam');
		expect(brand.shortName).toBe('Memoriam');
		expect(brand.colors.light.brand).toBe('#4338CA');
		expect(brand.colors.dark.brand).toBe('#A5B4FC');
		expect(JSON.stringify(defaults).toLowerCase()).not.toContain('skysa');
	});

	it('keeps the system fonts', () => {
		const brand = defaultBrand();
		expect(brand.fonts).toEqual({});
		const css = brandCss(brand);
		expect(css).not.toContain('@font-face');
		expect(css).toContain('--font-sans: ui-sans-serif, system-ui');
		expect(css).toContain('--font-mono: ui-monospace, SFMono-Regular');
	});

	it('has all six icons, at their sizes', () => {
		// The kit's loader refuses a brand missing one, or with one at the wrong size.
		expect(defaultBrand().icons.map((icon) => icon.file)).toEqual(
			BRAND_ICONS.map((icon) => icon.file)
		);
	});

	it("points an editor at the kit's JSON Schema", () => {
		const kit = createRequire(import.meta.url).resolve('@skysa/pwa/brand.schema.json');
		expect(realpathSync(resolve(dirname(DEFAULT_BRAND), String(schema)))).toBe(
			realpathSync(kit)
		);
	});
});
