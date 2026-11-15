import { describeClientStore } from '@skysa/client/testing';
import { describe, expect, it } from 'vitest';

import { dexieDevice } from './support/dexieDevice.js';
import {
	NEVER_DETACHED,
	NO_FIRST_IMPORT,
	NO_HOLD_UP,
	notHere,
	ONE_LIBRARY,
} from './support/notHere.js';

// The scheduler's ports over this app's database (`sync/dexiePorts.ts`): the
// suite the kit runs over the ports in memory (`clientStore.test.ts`).
notHere({
	'follows the source the app is shown': ONE_LIBRARY,
	"keeps each source's queue to itself": ONE_LIBRARY,
	'shows a source let go with work unsent as detached': NEVER_DETACHED,
	'keeps no root or pull for a source let go, and none on one kept detached': NEVER_DETACHED,
	'rescans nothing of a source let go, and leaves one kept detached as it is': NEVER_DETACHED,
	'writes nothing for a source let go, or kept detached, its cursor included': NEVER_DETACHED,
	'ends a first import once it is finished': NO_FIRST_IMPORT,
	'says what it waits on while another tab holds the device, until it lets go': NO_HOLD_UP,
});
describeClientStore('over the app’s database', dexieDevice);

// What those the library cannot run say of a source let go, said of the
// library let go: a write that was on its way when it was, a token among
// them, brings none of its row back.
describe('the library let go', () => {
	it('keeps no root, pull or token for it', async () => {
		const device = dexieDevice();
		await device.bind('c1');
		await device.letGo('c1');

		await device.store.keepRoot('c1', 'root-1');
		await device.store.pulled('c1', 1234);
		await device.store.tokens.keep('c1', { accessToken: 't1', expiresAt: 5678 });

		expect(await device.connection('c1')).toBeUndefined();
		expect(await device.keptToken('c1')).toBeUndefined();
	});

	it('rescans nothing of it', async () => {
		const device = dexieDevice();
		await device.bind('c1');
		await device.letGo('c1');

		await device.store.rescan('c1');

		expect(await device.connection('c1')).toBeUndefined();
	});

	it('writes nothing for it, its cursor included', async () => {
		const device = dexieDevice();
		await device.bind('c1');
		await device.letGo('c1');
		const documents = device.store.syncStore('c1');

		await expect(documents.applyChanges({ changes: [], cursor: 'k1' })).rejects.toThrow();

		expect(await documents.cursor()).toBeUndefined();
		expect(await device.connection('c1')).toBeUndefined();
	});
});
