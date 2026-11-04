import { isRateLimitError } from '../providers/types.js';

/**
 * What a run of the engine comes to (`SyncOutcome`), and the pieces every
 * outcome is built from: the plain one (`ok`), the one for a failure the
 * scheduler comes back from (`transient`), and the wait a provider asked
 * for (`waitFor`). skysa-notes' flags for what a pull met and decides nothing
 * about, its clipboard and its key file, have no counterpart here.
 */

export type SyncStatus =
	/** Everything queued reached the remote. */
	| 'ok'
	/** A token problem a refresh did not fix. The connection needs attention. */
	| 'paused'
	/** Something transient failed; the op is still queued and will be retried. */
	| 'retry'
	/** An op has failed too many times. It will not be retried without help. */
	| 'blocked';

export interface SyncOutcome {
	status: SyncStatus;
	/** Remote changes applied locally. */
	pulled: number;
	/** Queued operations that reached the remote. */
	pushed: number;
	/** Paths of conflict copies written, for the banner in §7. */
	conflicts: readonly string[];
	/** Why, when the status is not `ok`. */
	error?: string;
	/**
	 * How long the provider asked us to wait, when it was the one that said to
	 * stop. The scheduler waits at least this long instead of guessing.
	 */
	retryAfterMs?: number;
	/**
	 * Files added here that a push stepped over, failing or given up on, and
	 * which are still to go (skysa-notes' docs/ARCHITECTURE.md §7, "Pushing files"). Absent
	 * when there are none.
	 */
	waitingUploads?: number;
}

export const ok = (partial: Partial<SyncOutcome> = {}): SyncOutcome => ({
	status: 'ok',
	pulled: 0,
	pushed: 0,
	conflicts: [],
	...partial,
});

/**
 * The wait to pass on, as a piece of the outcome. Empty unless the provider
 * asked for one, so `retryAfterMs` is absent rather than `undefined` and the
 * scheduler's own backoff is what applies.
 */
export const waitFor = (error: unknown): { retryAfterMs?: number } =>
	isRateLimitError(error) && error.retryAfterMs !== undefined
		? { retryAfterMs: error.retryAfterMs }
		: {};

/**
 * Offline, a 500, a store that could not commit. The batch rolled back and
 * the cursor did not move, so the answer is the one push already gives: say
 * so, and let the scheduler come back. Throwing instead would make every
 * caller wrap `sync()` in a `try` to discover something `status` exists to
 * tell them — and a caller that forgot would take the app down on a flight.
 */
export const transient = (error: unknown): SyncOutcome => ({
	...ok(),
	status: 'retry',
	error: messageOf(error),
	...waitFor(error),
});

/** The message of an unknown throw, without letting a non-Error crash the log. */
export const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
