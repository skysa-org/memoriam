import { readFileSync } from 'node:fs';

import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { brandPlugin, loadBrand } from './brand.js';
import { pwaOptions } from './pwa.js';

// What the app is called and how it looks (docs/ARCHITECTURE.md §8, "Brand"): a
// deployment's own `brand.json` when `MEMORIAM_BRAND` names one, else `brand/`'s.
const brand = loadBrand(process.env.MEMORIAM_BRAND);

const { version } = JSON.parse(
	readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string };

export default defineConfig({
	define: {
		'import.meta.env.VITE_APP_VERSION': JSON.stringify(version),
		// What the install banner calls the app: the brand's name, as the
		// manifest and the page's title have it.
		'import.meta.env.VITE_APP_NAME': JSON.stringify(brand.name),
	},
	plugins: [
		tanstackRouter({ target: 'react', autoCodeSplitting: true }),
		react(),
		brandPlugin(brand),
		VitePWA(pwaOptions(brand)),
	],
	server: {
		port: 5173,
	},
	build: {
		outDir: 'dist',
		sourcemap: true,
	},
});
