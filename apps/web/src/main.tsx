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

const router = createAppRouter();

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
