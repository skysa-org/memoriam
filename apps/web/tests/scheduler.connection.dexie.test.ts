import { describeConnection } from '@skysa/client/testing';

import { dexieDevice } from './support/dexieDevice.js';
import {
	NEVER_DETACHED,
	NO_FIRST_IMPORT,
	NO_RESUME,
	notHere,
	ONE_LIBRARY,
} from './support/notHere.js';

// Following the connection over this app's database and with its own
// scheduler: the suite the kit runs over the ports in memory
// (`scheduler.connection.test.ts`). What the library does instead where it is
// one library, bound again or to another connection, is `librarySync.test.ts`'s.
notHere({
	'checks a resumed connection against the remote before syncing it': NO_RESUME,
	'retries a resume check the remote could not answer': NO_RESUME,
	'refreshes the token for a resume check that met an expired one': NO_RESUME,
	'is not held up by a resume check a re-bind interrupted': NO_RESUME,
	'syncs again, as a new sync, when re-bound to the same account mid-sync': NO_RESUME,
	'starts no session for a detached source, and asks the server for no token': NEVER_DETACHED,
	'ends the session of a source detached under it, and starts one when it is connected again':
		NEVER_DETACHED,
	'picks up a new connection with a provider of its own': ONE_LIBRARY,
	'is over once its first sync is through': NO_FIRST_IMPORT,
	'is not finished while what it owes will be tried again': NO_FIRST_IMPORT,
});
describeConnection('over the app’s database', dexieDevice);
