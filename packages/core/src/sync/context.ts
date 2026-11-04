import type { EntryRef, RemoteEntry, StorageProvider } from '../providers/types.js';
import type { Meter } from './progress.js';
import type { ConflictResolution, PullChange, SyncNote, SyncStore } from './store.js';

/**
 * What every part of the engine is handed by `createSyncEngine`: the provider
 * and the store it syncs between, the clock and ids injected for tests, its
 * bounds, the meter that tells `onProgress` how far a run has got, and the
 * two sides of a file made one where they can be (`mergedOf`). Built
 * once per engine, so the parts moved out of `engine.ts` (#446) share one
 * rather than each closing over its own.
 */
export interface EngineContext {
	readonly provider: StorageProvider;
	readonly store: SyncStore;
	readonly now: () => Date;
	readonly newId: () => string;
	/** Times an op may fail before the engine stops asking and surfaces it. */
	readonly maxAttempts: number;
	/** Writes the provider takes at once, at least one. */
	readonly writesAtOnce: number;
	readonly meter: Meter;
	/**
	 * The two sides made one, or none: none without the engine's `merge`, and
	 * none where it throws, since a merge that cannot be made is a conflict
	 * copy, which keeps both, and never a sync that stops
	 * (docs/ARCHITECTURE.md §10, "Merge before a conflict copy").
	 */
	readonly mergedOf: (path: string, local: string, remote: string) => string | undefined;
}

/**
 * What the push asks of the engine's pull side, which asks the same: whether
 * a file is there (`fileState`), and how a note and a newer remote version are
 * reconciled (`resolutionFor`). Handed to the push's parts by name.
 */
export interface FromPull {
	fileState: (ref: EntryRef) => Promise<'there' | 'gone' | 'unreadable'>;
	resolutionFor: (
		local: SyncNote,
		remoteContent: string,
		remote: RemoteEntry,
		claimed: ReadonlySet<string>,
		decided: readonly PullChange[]
	) => Promise<ConflictResolution>;
}
