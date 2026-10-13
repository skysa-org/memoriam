import { isHidden } from '@memoriam/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';

import { Icon } from '../components/Icon.js';
import { useMediaQuery } from '../components/layout.js';
import { t } from '../i18n/t.js';
import { db as appDatabase, type MemoriamDatabase } from '../store/db.js';
import { dismissInstall, getInstallDismissed } from '../store/prefs.js';
import { type Device, type ManualInstall, manualInstall, thisDevice } from './installHow.js';
import { type InstallPrompt, installPrompt } from './installPrompt.js';

/**
 * An offer to install the app, across the top of it while it runs in a
 * browser tab (docs/ARCHITECTURE.md §8, "Installing from the browser"). Where
 * the browser can install it from the page (Chromium), it has an Install
 * button; where installing is a menu item of the browser's own (Safari, on an
 * iPhone, an iPad or a Mac), it says which. Nowhere else, since anything it
 * said there would be advice the browser cannot follow.
 *
 * Not shown until there is a passage to keep: installing is what keeps it, in
 * Safari above all (§8, "Keeping data"). Gone once the app is installed, or
 * opened as an installed app, and for good once dismissed: the dismissal is
 * kept on this device (`dismissInstall`).
 */

export interface InstallBannerProps {
	database?: MemoriamDatabase;
	/** What the browser has said about installing. Injected for tests. */
	prompt?: InstallPrompt;
	/** Which browser this is, for one that has no install event. Injected for tests. */
	device?: Device;
	/** What the app is called. */
	name?: string;
}

const MANUAL: Readonly<Record<ManualInstall, (name: string) => string>> = {
	'home-screen': (name) => t('install.homeScreen', { app: name }),
	dock: (name) => t('install.dock', { app: name }),
};

export const InstallBanner = ({
	database = appDatabase,
	prompt = installPrompt,
	device = thisDevice(),
	name = import.meta.env.VITE_APP_NAME ?? t('install.thisApp'),
}: InstallBannerProps) => {
	const wanted = useLiveQuery(
		async () =>
			!(await getInstallDismissed(database)) &&
			(await database.notes.filter((row) => !isHidden(row.path)).count()) > 0,
		[database]
	);
	// An installed app opens in a window of its own (`display: standalone` in
	// the manifest), and Chromium moves a tab into one as it installs.
	const inBrowser = useMediaQuery('(display-mode: browser)');
	const state = useSyncExternalStore(prompt.subscribe, prompt.state);

	if (wanted !== true || !inBrowser || state.kind === 'installed') return null;
	const manual = state.kind === 'ready' ? undefined : manualInstall(device);
	if (state.kind !== 'ready' && manual === undefined) return null;

	return (
		<aside className="banner install-banner" aria-label={t('install.label', { app: name })}>
			<span className="install-banner-text">
				{manual === undefined ? t('install.offer', { app: name }) : MANUAL[manual](name)}
			</span>
			{state.kind === 'ready' && (
				<button
					type="button"
					className="install-banner-install"
					onClick={() => {
						// Declined, the event is spent and the banner goes until the
						// browser offers the install again, but nothing is kept:
						// only the banner's own dismissal is for good.
						void state.install();
					}}
				>
					{t('install.install')}
				</button>
			)}
			<button
				type="button"
				className="icon icon-quiet"
				aria-label={t('common.dismiss')}
				title={t('install.dontShowAgain')}
				onClick={() => {
					void dismissInstall(database);
				}}
			>
				<Icon name="close" />
			</button>
		</aside>
	);
};
