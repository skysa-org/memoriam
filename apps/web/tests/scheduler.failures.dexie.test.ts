import { describeFailures } from '@skysa/client/testing';

import { dexieDevice } from './support/dexieDevice.js';

// Failures and blocked ops over this app's database and with its own
// scheduler: the suite the kit runs over the ports in memory
// (`scheduler.failures.test.ts`).
describeFailures('over the app’s database', dexieDevice);
