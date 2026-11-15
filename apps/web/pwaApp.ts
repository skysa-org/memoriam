import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PwaApp } from '@skysa/pwa';

/**
 * What this app hands the build of its own: its one route (`PwaApp`, the shared
 * kit's `@skysa/pwa`), and the brand it builds with when a deployment names
 * none (the kit's `loadBrand`).
 */

/**
 * The brand the app is built with when `MEMORIAM_BRAND` names none: `brand/`'s,
 * "Memoriam", in indigo, on the system fonts (docs/ARCHITECTURE.md §8, "Brand").
 */
// Not `new URL(…, import.meta.url)`, which Vite would read as an asset to serve.
export const DEFAULT_BRAND = join(dirname(fileURLToPath(import.meta.url)), 'brand/brand.json');

/**
 * This app's routes. It has one, `/`, and where in the app it opens is in the
 * hash, which no request carries; what another page leaves for the app is in
 * the query. A route added under `src/routes` is a fragment on `/` and needs
 * nothing here, which `tests/pwa.app.test.ts` checks. It is no share target.
 */
export const MEMORIAM_PWA: PwaApp = {
	routes: [/^\/(?:\?|$)/],
};
