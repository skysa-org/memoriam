import { describe, expect, it } from 'vitest';

import { APP_DATA_FOLDER, HIDDEN_PREFIX, MARKER_FILE } from '../src/index.js';

describe('the names the library is kept under', () => {
	it('keeps the app’s own files out of sight of the library', () => {
		expect(APP_DATA_FOLDER.startsWith(HIDDEN_PREFIX)).toBe(true);
		expect(MARKER_FILE.startsWith(HIDDEN_PREFIX)).toBe(true);
	});
});
