import { describeChangeRelay } from '@skysa/client/testing';

import { dexieDevice } from './support/dexieDevice.js';
import { notHere, ONE_LIBRARY } from './support/notHere.js';

// The change relay over this app's database and with its own scheduler: the
// suite the kit runs over the ports in memory (`scheduler.relay.test.ts`).
notHere({
	'lets the link go with its session, and gives the next session its own': ONE_LIBRARY,
});
describeChangeRelay('over the app’s database', dexieDevice);
