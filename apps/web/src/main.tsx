// First: before any module that builds a zod schema (see the module).
import './jitless.js';
import './styles.css';
// Listening for Chromium's install offer from the start, which can come before
// the banner that shows it has mounted (see the module).
import './install/installPrompt.js';

import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StaleTabGate } from './components/StaleTabGate.js';
import { routeTree } from './routeTree.gen';

const router = createRouter({
	routeTree,
	// The app renders from local state before any network call, so there is
	// nothing to wait on at boot.
	defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('#root is missing from index.html');

createRoot(rootElement).render(
	<StrictMode>
		{/* Outside the router, so no route's error screen can take its place: once
		    the database has closed, every query under here fails. */}
		<StaleTabGate>
			<RouterProvider router={router} />
		</StaleTabGate>
	</StrictMode>
);
