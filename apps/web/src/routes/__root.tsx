import { createRootRoute, Outlet } from '@tanstack/react-router';

import { CommandsProvider, useShortcuts } from '../commands/context.js';
import { BadgeKeeper } from '../components/BadgeKeeper.js';
import { ErrorScreen } from '../components/ErrorScreen.js';
import { NavBar } from '../components/NavBar.js';
import { NoticesProvider } from '../components/Notices.js';
import { UpdatePrompt } from '../components/UpdatePrompt.js';
import { InstallBanner } from '../install/InstallBanner.js';

const Shortcuts = () => {
	useShortcuts();
	return null;
};

const RootLayout = () => (
	<CommandsProvider>
		<Shortcuts />
		<NoticesProvider>
			<div className="app">
				<InstallBanner />
				<NavBar />
				<Outlet />
				<UpdatePrompt />
				<BadgeKeeper />
			</div>
		</NoticesProvider>
	</CommandsProvider>
);

export const Route = createRootRoute({
	component: RootLayout,
	// The last boundary there is: a route without one of its own lands here, and
	// so does anything the layout itself throws.
	errorComponent: ErrorScreen,
});
