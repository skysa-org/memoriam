import { buildMarker, parseMarker, serializeMarker } from '@skysa/storage';
import { describe, expect, it } from 'vitest';

import { MEMORIAM_FOLDER } from '../src/config.js';

describe('MEMORIAM_FOLDER', () => {
	it('names what every library connected since 0.1.0 already holds', () => {
		// The folder's name, Drive's tag on it and the marker in it are in the
		// user's storage, not in this repo: a library is found by them, so a
		// change here is a library the app no longer finds, or one it takes for
		// another app's. Drive's mark on a folder the app has left is the tag
		// and `Left` (the kit's `gdrive/wire.ts`): `memoriamLeft`, as 0.1.0
		// wrote it. Written out rather than built from the constants, so that an
		// edit to those shows up here as a failure.
		expect(MEMORIAM_FOLDER).toEqual({
			name: 'memoriam',
			driveTag: 'memoriam',
			marker: { file: '.memoriam-app.json', app: 'memoriam', version: 1 },
		});
	});

	it('reads the marker 0.1.0 wrote, and writes the same', () => {
		// The marker's reading and writing are the shared kit's (skysa-notes'
		// record 0018), and every library connected since 0.1.0 holds one at
		// its root, which every device since reads. As 0.1.0 wrote it, byte for
		// byte, so that a change there that stops this app reading its own
		// folders, or a 0.1.0 device reading a new one's, fails here.
		const written = [
			'{',
			'  "schemaVersion": 1,',
			'  "app": "memoriam",',
			'  "createdAt": "2026-10-13T09:14:03.512Z",',
			'  "createdBy": {',
			'    "appVersion": "0.1.0",',
			'    "provider": "dropbox",',
			'    "clientId": "018f3c4e-0000-7000-8000-000000000000",',
			'    "userAgent": "Mozilla/5.0 (test)"',
			'  }',
			'}',
			'',
		].join('\n');

		expect(parseMarker(written, MEMORIAM_FOLDER.marker).status).toBe('ok');
		expect(
			serializeMarker(
				buildMarker({
					marker: MEMORIAM_FOLDER.marker,
					appVersion: '0.1.0',
					provider: 'dropbox',
					clientId: '018f3c4e-0000-7000-8000-000000000000',
					userAgent: 'Mozilla/5.0 (test)',
					now: new Date('2026-10-13T09:14:03.512Z'),
				})
			)
		).toBe(written);
	});
});
