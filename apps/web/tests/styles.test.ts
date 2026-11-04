import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadBrand } from '../brand.js';
import { allStyles, importedStyles, STYLES_FOLDER } from './support/styles.js';

/**
 * The stylesheet, `src/styles/` (docs/ARCHITECTURE.md §7, "The stylesheet").
 * Ported from skysa-notes' `tests/styles.test.ts`.
 */

const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

const tokensCss = (): string =>
	withoutComments(readFileSync(join(STYLES_FOLDER, 'tokens.css'), 'utf8'));

/** Written by the brand's stylesheet (`brand.ts`). */
const SET_ELSEWHERE: ReadonlySet<string> = new Set(['--font-mono', '--font-sans']);

describe('the stylesheet', () => {
	// A file left out draws nothing, and the tests that read the sheet would not
	// see its rules either.
	it('imports every file in its folder, once', () => {
		const files = readdirSync(STYLES_FOLDER).filter((file) => file !== 'index.css');

		expect([...importedStyles()].sort()).toEqual(files.sort());
	});

	// A name nobody declares is no error to a browser: the rule just goes away,
	// and the corner goes square or the colour goes without a word.
	it('uses only variables that are declared', () => {
		const declaredIn = (css: string): Set<string | undefined> =>
			new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
		const css = withoutComments(allStyles());
		const declared = declaredIn(css);
		const used = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? '');

		expect(used.length).toBeGreaterThan(0);
		expect(used.filter((name) => !declared.has(name) && !SET_ELSEWHERE.has(name))).toEqual([]);

		const tokens = declaredIn(tokensCss());
		const STEP = /^--(?:radius|shadow|text|z)-|^--(?:on-)?brand$/;
		expect(used.filter((name) => STEP.test(name) && !tokens.has(name))).toEqual([]);
	});

	// The defaults stand in for the brand's stylesheet, so they are the default
	// brand's own colours, and change with it.
	it("defaults the brand's colours to the default brand's", () => {
		const brand = loadBrand();
		const defaults = [...tokensCss().matchAll(/--(on-)?brand:\s*(#[0-9a-f]{6})/gi)].map(
			(match) =>
				`${match[1] === undefined ? 'brand' : 'onBrand'} ${(match[2] ?? '').toLowerCase()}`
		);
		const { light, dark } = brand.colors;

		expect(defaults).toEqual([
			`brand ${light.brand.toLowerCase()}`,
			`onBrand ${light.onBrand.toLowerCase()}`,
			`brand ${dark.brand.toLowerCase()}`,
			`onBrand ${dark.onBrand.toLowerCase()}`,
		]);
	});
});
