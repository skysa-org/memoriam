import { useEffect, useRef } from 'react';

import { api as appApi, type ApiClient } from '../api/client.js';
import { db as appDatabase, type MemoriamDatabase } from '../store/db.js';
import { claimConnection, reconcileAccount } from '../sync/account.js';
import { syncScheduler, useSyncStatus } from '../sync/runtime.js';
import { type SyncScheduler } from '../sync/scheduler.js';

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
	database = appDatabase,
	client = appApi,
	scheduler = syncScheduler,
}: Readonly<{
	database?: MemoriamDatabase;
	client?: Pick<ApiClient, 'withCredential'>;
	scheduler?: Pick<SyncScheduler, 'status' | 'subscribe'>;
}>) => {
	const claimed = useRef(false);
	useEffect(() => {
		// Once: React runs an effect twice in development, and a second claim
		// while the first is out would ask the server twice about one credential.
		if (claimed.current) return;
		claimed.current = true;
		void claimConnection(database, client).catch(() => undefined);
	}, [database, client]);

	const { refusal } = useSyncStatus(scheduler);
	useEffect(() => {
		if (refusal !== 'credential_revoked' && refusal !== 'credential_required') return;
		void reconcileAccount(database, client).catch(() => undefined);
	}, [refusal, database, client]);

	return null;
};
