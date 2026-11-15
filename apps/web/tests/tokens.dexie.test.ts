import { describeTokenSource } from '@skysa/client/testing';

import { dexieDevice } from './support/dexieDevice.js';
import { NEVER_DETACHED, notHere } from './support/notHere.js';

// Provider access tokens over this app's database: the suite the kit runs over
// the ports in memory (`tokens.test.ts`).
notHere({
	'does not hand a token to a source detached while minting, which is kept for its notes':
		NEVER_DETACHED,
	'is never asked of the server for a detached source': NEVER_DETACHED,
});
describeTokenSource('over the app’s database', dexieDevice);
