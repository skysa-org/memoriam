/** Syncing the library with a storage provider, and what it says about itself. */
export const sync = {
	/** A sync that failed without a reason of its own. */
	failed: 'Sync failed.',
	unsupported: 'This app cannot sync with this storage provider yet.',
	/** A provider request given up on (`sync/providers.ts`). */
	timedOut: 'The storage provider took too long to answer.',
	settings: {
		title: 'Sync',
		hint: 'Keep your library in your own Dropbox, Google Drive or OneDrive, and on every device you use. Your passages are kept on this device as well, and you can practise without a connection.',
		unavailable: 'Sync is not available here: the server could not be reached.',
		none: 'This server is not set up to sync with any storage provider.',
		connect: 'Connect {provider}',
		connecting: 'Opening {provider}…',
		startFailed: 'Connecting could not start. Check that you are online, and try again.',
		refused: 'The server would not start connecting {provider}.',
		syncsWith: 'Syncing with {provider}.',
		syncsWithAccount: 'Syncing with {provider} as {account}.',
		syncNow: 'Sync now',
		disconnect: 'Disconnect',
		connectAgain: 'Connect again',
	},
	status: {
		idle: 'Up to date.',
		idleSince: 'Up to date. Last synced {time}.',
		syncing: 'Syncing…',
		offline:
			'Offline. Your changes are kept on this device, and sent when you are back online.',
		retrying: 'Sync could not finish ({error}). It will try again shortly.',
		attention: 'Sync needs attention: {error}',
		reconnect: '{provider} needs to be connected again before your library can sync.',
		stuck: 'A change to {path} could not be sent ({error}).',
	},
	returned: {
		ok: 'Connected. Your library will now sync.',
		denied: 'Nothing was connected: the storage provider was not given access.',
		failed: 'Connecting failed, and nothing was changed. Try again.',
		partial:
			'Connected, but the storage provider could not be asked for everything. If syncing fails, connect again.',
		expired: 'That attempt to connect had expired. Try again.',
	},
	disconnect: {
		title: 'Stop syncing with {provider}?',
		body: 'Your passages stay on this device, and in {provider}. This device stops sending changes there, and other devices go on syncing.',
		confirm: 'Disconnect',
		done: 'Disconnected. Your passages are still here.',
		refused:
			'The server would not disconnect this device. You can stop syncing on this device only.',
		unreachable:
			'The server could not be reached. Try again, or stop syncing on this device only.',
		here: 'Stop syncing on this device',
	},
	conflicts: {
		one: 'A passage was changed in two places at once, and both versions are kept.',
		other: '{count} passages were changed in two places at once, and both versions of each are kept.',
	},
	resolve: 'Choose which to keep',
} as const;
