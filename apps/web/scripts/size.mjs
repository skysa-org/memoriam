// The web build's size budget: `node apps/web/scripts/size.mjs`, after
// `vite build`, from anywhere. Every figure is gzipped bytes, which is what a
// phone downloads; the shared kit's `@skysa/pwa/budget` measures the build
// against them and fails when it is over any line, so growth is a choice
// someone made in a pull request rather than something found later.
//
// Raising one is fine when the growth is wanted; say so in the pull request.
// Plain Node.

import { fileURLToPath, URL } from 'node:url';

import { checkBudget } from '@skysa/pwa/budget';

const KB = 1000;

checkBudget({
	dist: fileURLToPath(new URL('../dist/', import.meta.url)),
	budget: {
		largestChunk: 135 * KB,
		allScripts: 298 * KB,
		pages: { 'index.html': 266 * KB },
		allStyles: 5.2 * KB,
	},
	setIn: 'apps/web/scripts/size.mjs',
});
