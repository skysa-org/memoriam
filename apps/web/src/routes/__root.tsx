import { createRootRoute, Outlet } from '@tanstack/react-router';

import { CommandsProvider, useShortcuts } from '../commands/context.js';
import { ErrorScreen } from '../components/ErrorScreen.js';
import { UpdatePrompt } from '../components/UpdatePrompt.js';
import { InstallBanner } from '../install/InstallBanner.js';

const Shortcuts = () => {
	useShortcuts();
	return null;
};

const RootLayout = () => (
	<CommandsProvider>
		<Shortcuts />
		<div className="app">
			<InstallBanner />
			<Outlet />
			<UpdatePrompt />
		</div>
	</CommandsProvider>
);

export const Route = createRootRoute({
	component: RootLayout,
	// The last boundary there is: a route without one of its own lands here, and
	// so does anything the layout itself throws.
	errorComponent: ErrorScreen,
});
