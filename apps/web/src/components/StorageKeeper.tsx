import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef } from 'react';

import { useDb } from '../store/database.js';
import { browserStorage, keepIfDue, type StorageApi } from '../store/persistence.js';
import { isLive } from '../store/rowStates.js';

/**
 * Asks the browser to keep the library once there is a passage in it
 * (`store/persistence.ts`). Shows nothing: Firefox asks the user itself, and
 * the other browsers answer without asking. Settings says how it stands.
 */
export const StorageKeeper = ({
	storage = browserStorage(),
}: Readonly<{ storage?: StorageApi | undefined }>) => {
	const db = useDb();
	// Any passage at all: the count changes as the first is added.
	const passages = useLiveQuery(() => db.notes.filter(isLive).count(), [db]);
	// Once a page load: the answer is noted, and a second ask while the first
	// is out would be a second prompt in Firefox.
	const asking = useRef(false);
	useEffect(() => {
		if (passages === undefined || passages === 0 || asking.current) return;
		asking.current = true;
		void keepIfDue(db, storage, Date.now()).then((answer) => {
			// Not asked yet (no passage, only the app's own files): ask on a later change.
			if (answer === undefined) asking.current = false;
		});
	}, [passages, db, storage]);
	return null;
};
