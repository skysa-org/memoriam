import { api as appApi, type ApiClient, type SyncScheduler } from '@skysa/client';
import { useEffect, useRef } from 'react';

import { useDb } from '../store/database.js';
import { claimConnection, reconcileAccount } from '../sync/account.js';
import { syncScheduler, useSyncStatus } from '../sync/runtime.js';

/**
 * Keeps the library's binding in step with the server (docs/ARCHITECTURE.md
 * §10, "Connecting"). Shows nothing.
 *
 * Once a page load it takes up a connection a flow has just consented to, or,
 * with none waiting, asks after the one the library is bound to
 * (`claimConnection`). And when the scheduler is told the credential reaches
 * nothing, it asks again, which lets the library go if the server says so
 * (`reconcileAccount`). Offline, either throws, and nothing changes: the next
 * page load asks again.
 */
export const SyncKeeper = ({
	client = appApi,
	scheduler = syncScheduler,
}: Readonly<{
	client?: Pick<ApiClient, 'withCredential'>;
	scheduler?: Pick<SyncScheduler, 'status' | 'subscribe'>;
}>) => {
	const db = useDb();
	const claimed = useRef(false);
	useEffect(() => {
		// Once: React runs an effect twice in development, and a second claim
		// while the first is out would ask the server twice about one credential.
		if (claimed.current) return;
		claimed.current = true;
		void claimConnection(db, client).catch(() => undefined);
	}, [db, client]);

	const { refusal } = useSyncStatus(scheduler);
	useEffect(() => {
		if (refusal !== 'credential_revoked' && refusal !== 'credential_required') return;
		void reconcileAccount(db, client).catch(() => undefined);
	}, [refusal, db, client]);

	return null;
};
