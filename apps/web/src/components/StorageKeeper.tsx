import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';

import { db as appDatabase, isLive, type MemoriamDatabase } from '../store/db.js';
import { browserStorage, keepIfDue, type StorageApi } from '../store/persistence.js';

/**
 * Asks the browser to keep the library once there is a passage in it
 * (`store/persistence.ts`). Shows nothing: Firefox asks the user itself, and
 * the other browsers answer without asking. Settings says how it stands.
 */
export const StorageKeeper = ({
	database = appDatabase,
	storage = browserStorage(),
}: Readonly<{ database?: MemoriamDatabase; storage?: StorageApi | undefined }>) => {
	// Any passage at all: the count changes as the first is added.
	const passages = useLiveQuery(() => database.notes.filter(isLive).count(), [database]);
	// Once a page load: the answer is noted, and a second ask while the first
	// is out would be a second prompt in Firefox.
	const asking = useRef(false);
	useEffect(() => {
		if (passages === undefined || passages === 0 || asking.current) return;
		asking.current = true;
		void keepIfDue(database, storage, Date.now()).then((answer) => {
			// Not asked yet (no passage, only the app's own files): ask on a later change.
			if (answer === undefined) asking.current = false;
		});
	}, [passages, database, storage]);
	return null;
};
