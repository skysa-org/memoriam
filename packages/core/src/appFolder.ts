import { normalizePath } from '@skysa/storage';

import { APP_DATA_FOLDER } from './config.js';
import { isActivityPath } from './rewards/activity.js';

/**
 * The hidden paths this app syncs all the same, handed to the sync engine
 * (`SyncEngineOptions.syncsHidden`): the app's own folder and the year's
 * activity files in it, hidden from the library's lists but synced like any
 * passage (docs/ARCHITECTURE.md §10). Every other hidden path — the marker,
 * another tool's dot-folders — the engine passes over.
 */
export const syncsHidden = (path: string): boolean =>
	normalizePath(path) === APP_DATA_FOLDER || isActivityPath(path);
