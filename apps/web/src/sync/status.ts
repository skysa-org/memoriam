import type { SchedulerStatus } from './scheduler.js';

/**
 * A problem that connecting the account again is the answer to: said in
 * Settings as what to do, in the colour of an error, with Connect again
 * (`SyncSettings`). As skysa-notes' `needsReconnect`, and here for the same
 * reason: `runtime.ts` builds the scheduler as it loads, and this imports only
 * the scheduler's types, so a test can ask it without one.
 */
export const needsReconnect = (status: SchedulerStatus): boolean =>
	status.phase === 'attention' &&
	(status.refusal === 'credential_required' ||
		status.refusal === 'credential_revoked' ||
		status.refusal === 'reauthorize_required' ||
		(status.refusal === undefined && status.error === 'authorization required'));
