import { useSyncExternalStore } from 'react';

import { api } from '../api/client.js';
import { db } from '../store/db.js';
import { createProviderFactory } from './providers.js';
import { createSyncScheduler, type SchedulerStatus, type SyncScheduler } from './scheduler.js';

/**
 * The app's one sync scheduler, over the app's one database. Started by
 * `main.tsx` before the first render, not by a component, so a remount — or
 * React running an effect twice in development — never stops and starts it.
 * As skysa-notes' `sync/runtime.ts`.
 */

/** Written into the marker file on first connect. */
export const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0-dev';

export const syncScheduler: SyncScheduler = createSyncScheduler({
	db,
	client: api,
	createProvider: createProviderFactory({ appVersion: APP_VERSION }),
});

/** What the scheduler says now, re-rendering whenever that changes. */
export const useSyncStatus = (
	scheduler: Pick<SyncScheduler, 'status' | 'subscribe'> = syncScheduler
): SchedulerStatus => useSyncExternalStore(scheduler.subscribe, scheduler.status);

/**
 * A problem that connecting the account again is the answer to: said in
 * Settings as what to do, in the colour of an error, with Connect again
 * (`SyncSettings`). As skysa-notes' `needsReconnect`.
 */
export const needsReconnect = (status: SchedulerStatus): boolean =>
	status.phase === 'attention' &&
	(status.refusal === 'credential_required' ||
		status.refusal === 'credential_revoked' ||
		status.refusal === 'reauthorize_required' ||
		(status.refusal === undefined && status.error === 'authorization required'));
