/** What syncing with a storage provider says about itself. */
export const sync = {
	/** A sync that failed without a reason of its own. */
	failed: 'Sync failed.',
	unsupported: 'This app cannot sync with this storage provider yet.',
	/** A provider request given up on (`sync/providers.ts`). */
	timedOut: 'The storage provider took too long to answer.',
} as const;
