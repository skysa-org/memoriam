/**
 * Names that must stay put once anything has been written under them: the
 * library's folder on a storage provider, its marker file, and the hidden
 * folder the app keeps its own files in (docs/ARCHITECTURE.md §3).
 *
 * `APP_FOLDER_NAME` governs the folder Google Drive creates. OneDrive and
 * Dropbox derive their app-folder name from the provider registration, so
 * those registrations must be named to match (§10).
 */
export const APP_FOLDER_NAME = 'memoriam';

/** Name the app reports as its own in the marker file. */
export const APP_NAME = 'memoriam';

/** Marker file written at the root of the library on first connect. */
export const MARKER_FILE = '.memoriam-app.json';

/** Extension of every passage, and of every file the app keeps. */
export const PASSAGE_EXTENSION = '.md';

/** Anything at a path segment starting with this is invisible to the library. */
export const HIDDEN_PREFIX = '.';

/**
 * The app's own files, at the root of the library: a year's activity in each
 * (`activity-2026.md`). Hidden from the library's lists, but kept, exported and
 * synced like any passage.
 */
export const APP_DATA_FOLDER = '.memoriam';
