import type { CredentialRecord, MemoriamDatabase } from '../../src/store/db.js';

/**
 * The credential a bound device holds for its connection (docs/ARCHITECTURE.md
 * §10, "The sync client"): without one nothing can mint a token. The secret is
 * `sk1_` and the connection's id unless the test needs another.
 */
export const holdCredential = (
	db: MemoriamDatabase,
	connectionId: string,
	{
		credential = `sk1_${connectionId}`,
		provider = 'dropbox',
		createdAt = 0,
	}: Partial<Omit<CredentialRecord, 'id'>> = {}
) => db.credentials.put({ id: connectionId, credential, provider, createdAt });
