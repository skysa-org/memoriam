import { describe, expect, it } from 'vitest';

import type { RemoteEntry } from '../../../src/providers/types.js';
import { decidedNotes, reestablished } from '../../../src/sync/pull/decided.js';
import type { PullChange } from '../../../src/sync/store.js';

/**
 * What a batch has spoken for, read off its decisions (`pull/decided.ts`).
 * The engine's tests (`engine/*.test.ts`) reach these through whole pulls;
 * this says what they answer for memoriam's own `merge-note`, which
 * skysa-notes' engine never makes.
 */

const entry = (remoteId: string, path: string): RemoteEntry => ({
	remoteId,
	path,
	kind: 'file',
	version: 'v1',
	modifiedAt: '',
});

const merged: PullChange = {
	kind: 'merge-note',
	id: 'n',
	path: 'a.md',
	base: '',
	content: 'merged',
	clean: false,
	remote: entry('r-n', 'a.md'),
	syncedHash: '',
};

describe('reestablished', () => {
	it('counts a merged note as written back, as an upsert is', () => {
		expect([...reestablished([merged]).notes]).toEqual(['n']);
	});

	it('does not count a deleted note', () => {
		expect([...reestablished([{ kind: 'delete-note', id: 'n' }]).notes]).toEqual([]);
	});
});

describe('decidedNotes', () => {
	it('counts a merged note as spoken for', () => {
		expect([...decidedNotes([merged])]).toEqual(['n']);
	});
});
