import { API_ERROR_CODES as APP_CODES } from '@memoriam/core';
import { API_ERROR_CODES as SERVER_CODES } from '@skysa/protocol';
import { describe, expect, it } from 'vitest';

/**
 * The server is the kit's, and answers every refusal with a code from the
 * kit's list. The app reads a part of that list, its own in core, and words
 * each code it knows (`Refusal` in `apps/web/src/api/client.ts`). A code on the
 * app's list that the kit's server never sends would be words for nothing; one
 * the kit renamed would leave the app reading the old name while the server
 * sends the new.
 */
describe("the app's error codes", () => {
	it('are every one a code the kit’s server answers with', () => {
		expect(
			APP_CODES.filter((code) => !(SERVER_CODES as readonly string[]).includes(code))
		).toEqual([]);
	});
});
