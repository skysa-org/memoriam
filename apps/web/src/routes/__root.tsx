import { createRootRoute, Outlet } from '@tanstack/react-router';

import { CommandsProvider, useShortcuts } from '../commands/context.js';
import { AppCommands } from '../components/AppCommands.js';
import { BadgeKeeper } from '../components/BadgeKeeper.js';
import { NoticesProvider } from '../components/Notices.js';
import { ErrorScreen } from '../components/shell/ErrorScreen.js';
import { NavBar } from '../components/shell/NavBar.js';
import { UpdatePrompt } from '../components/shell/UpdatePrompt.js';
import { StorageKeeper } from '../components/StorageKeeper.js';
import { SyncKeeper } from '../components/SyncKeeper.js';
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
				<StorageKeeper />
				<SyncKeeper />
				<AppCommands />
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
