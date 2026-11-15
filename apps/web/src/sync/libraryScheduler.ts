import { mergeFile, PASSAGE_FORMAT, syncsHidden } from '@memoriam/core';
import { createSyncScheduler, type SyncScheduler, type SyncSchedulerOptions } from '@skysa/client';

import type { MemoriamDatabase } from '../store/db.js';
import { clientStoreOf } from './dexiePorts.js';
import { SYNC_LOCK } from './lock.js';

/**
 * How long practice may wait to be sent, at most (docs/ARCHITECTURE.md §10,
 * "Push timing"): a pass goes with the next sync — the minute's poll while
 * the page is in sight, or as the page is hidden — and by then at the latest.
 * A session records a pass every few seconds, and each sent alone would be a
 * request and a new version of the file at the provider for every one.
 */
const PRACTICE_WAITS_MS = 60_000;

/** What the app's scheduler is made with that is not this app's own. */
type LibrarySchedulerOptions = Omit<
	SyncSchedulerOptions,
	'store' | 'lockName' | 'document' | 'syncsHidden' | 'watch'
>;

/**
 * The kit's scheduler (`@skysa/client`) over the library in `db`, handed what
 * is this app's: the ports over its database, its lock, its documents, the
 * hidden paths it syncs, the merge that keeps practice made on two devices
 * (docs/ARCHITECTURE.md §10, "Merge before a conflict copy"), and how long
 * practice waits to be sent. The app makes one (`runtime.ts`), with its
 * timings; the tests make theirs the same way, with their own.
 */
export const createLibraryScheduler = (
	db: MemoriamDatabase,
	options: LibrarySchedulerOptions
): SyncScheduler =>
	createSyncScheduler({
		merge: mergeFile,
		lazyMs: PRACTICE_WAITS_MS,
		...options,
		store: clientStoreOf(db),
		lockName: SYNC_LOCK,
		document: PASSAGE_FORMAT,
		syncsHidden,
	});
