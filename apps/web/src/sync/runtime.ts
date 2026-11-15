import { MEMORIAM_FOLDER, PASSAGE_FORMAT } from '@memoriam/core';
import {
	api,
	createProviderFactory,
	type SchedulerStatus,
	type SyncScheduler,
} from '@skysa/client';
import { useSyncExternalStore } from 'react';

import { t } from '../i18n/t.js';
import { db } from '../store/db.js';
import { createLibraryScheduler } from './libraryScheduler.js';

/**
 * The app's one sync scheduler, the kit's, over the app's one database
 * (`libraryScheduler.ts`). Started by `main.tsx` before the first render, not
 * by a component, so a remount — or React running an effect twice in
 * development — never stops and starts it.
 */

/** Written into the marker file on first connect. */
const APP_VERSION = import.meta.env.VITE_APP_VERSION ?? '0.0.0-dev';

export const syncScheduler: SyncScheduler = createLibraryScheduler(db, {
	client: api,
	createProvider: createProviderFactory({
		folder: MEMORIAM_FOLDER,
		document: PASSAGE_FORMAT,
		appVersion: APP_VERSION,
		timedOut: () => t('sync.timedOut'),
	}),
});

/** What the scheduler says now, re-rendering whenever that changes. */
export const useSyncStatus = (
	scheduler: Pick<SyncScheduler, 'status' | 'subscribe'> = syncScheduler
): SchedulerStatus => useSyncExternalStore(scheduler.subscribe, scheduler.status);
