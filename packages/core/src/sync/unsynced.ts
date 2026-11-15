import { APP_DATA_FOLDER } from '../config.js';
import { isHidden, normalizePath } from '../paths.js';
import { isActivityPath } from '../rewards/activity.js';

/**
 * A path the engine passes over: hidden, as the marker and another tool's
 * dot-folders are, and not the app's own data. The app's folder and the
 * year's activity files in it are hidden from the library's lists but synced
 * like any passage (docs/ARCHITECTURE.md §10). Asked wherever skysa-notes'
 * engine asks `isHidden`: the pull's decisions, the batch's listings and the
 * scan's filter.
 */
export const unsynced = (path: string): boolean =>
	isHidden(path) && !(normalizePath(path) === APP_DATA_FOLDER || isActivityPath(path));
