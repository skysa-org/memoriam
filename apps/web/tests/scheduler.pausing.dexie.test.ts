import { describePausing } from '@skysa/client/testing';

import { dexieDevice } from './support/dexieDevice.js';
import { NO_HOLD_UP, notHere, ONE_LIBRARY } from './support/notHere.js';

// Pausing and waiting over this app's database and with its own scheduler:
// the suite the kit runs over the ports in memory (`scheduler.pausing.test.ts`).
notHere({
	'is over once the source is shown again after another': ONE_LIBRARY,
	'says so once it has waited a while, and stops saying so when the other tab lets go':
		NO_HOLD_UP,
});
describePausing('over the app’s database', dexieDevice);
