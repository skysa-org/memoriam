// First: before any module that builds a zod schema (see the module).
import './jitless.js';
import './styles.css';
// Listening for Chromium's install offer from the start, which can come before
// the banner that shows it has mounted (see the module).
import './install/installPrompt.js';

import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { StaleTabGate } from './components/StaleTabGate.js';
import { createAppRouter } from './router.js';
import { connectReturn } from './sync/connectReturn.js';
import { syncScheduler } from './sync/runtime.js';

// Before the router reads the address: the way back from connecting storage
// carries its outcome in the query, which is taken out here (see the module).
connectReturn.take(window.location, window.history);

const router = createAppRouter();

// Before the first render, and never stopped: it follows the library's
// binding on its own, and syncs nothing while there is none.
syncScheduler.start();

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
