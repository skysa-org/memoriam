import { mergeFile, PASSAGE_FORMAT, syncsHidden } from '@memoriam/core';
import { createSyncScheduler, type SyncScheduler, type SyncSchedulerOptions } from '@skysa/client';

import type { MemoriamDatabase } from '../store/db.js';
import { clientStoreOf } from './dexiePorts.js';
import { SYNC_LOCK } from './lock.js';

/** What the app's scheduler is made with that is not this app's own. */
type LibrarySchedulerOptions = Omit<
	SyncSchedulerOptions,
	'store' | 'lockName' | 'document' | 'syncsHidden' | 'watch'
>;

/**
 * The kit's scheduler (`@skysa/client`) over the library in `db`, handed what
 * is this app's: the ports over its database, its lock, its documents, the
 * hidden paths it syncs, and the merge that keeps practice made on two
 * devices (docs/ARCHITECTURE.md §10, "Merge before a conflict copy"). The app
 * makes one (`runtime.ts`), with its timings; the tests make theirs the same
 * way, with their own.
 */
export const createLibraryScheduler = (
	db: MemoriamDatabase,
	options: LibrarySchedulerOptions
): SyncScheduler =>
	createSyncScheduler({
		merge: mergeFile,
		...options,
		store: clientStoreOf(db),
		lockName: SYNC_LOCK,
		document: PASSAGE_FORMAT,
		syncsHidden,
	});
