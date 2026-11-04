import type { SyncProgress } from '@memoriam/core';

/**
 * From how many a run's count is said. A run of a few — a pass sent, a
 * collection made — is over before a count could be read, and saying one
 * would flash a number past the user every time they stopped typing; the runs
 * worth counting are an import's hundreds of passages, sent from one device
 * and received on another (docs/ARCHITECTURE.md §10, "Connecting").
 *
 * As skysa-notes' `sync/progress.ts`.
 */
export const PROGRESS_FROM = 20;

/**
 * A run long enough to count: what the status line in Settings gives a
 * count. A scan or a round still listing counts by what it has found so far.
 */
export const isLongRun = (progress: SyncProgress | undefined): progress is SyncProgress =>
	progress !== undefined &&
	(progress.stage === 'scanning' ? progress.found : progress.total) >= PROGRESS_FROM;
