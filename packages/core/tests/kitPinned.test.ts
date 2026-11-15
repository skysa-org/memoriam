import { contentHash, withoutNul } from '@skysa/storage';
import { describe, expect, it } from 'vitest';

/**
 * Functions of the shared kit's (skysa-notes' record 0018) whose answers are
 * held in a library or on a device, so that a kit release which changed them
 * fails here rather than in someone's library. The kit does not test these
 * itself yet (skysa-org/skysa-kit#21); they are the tests they had here.
 */

describe('contentHash', () => {
	it('is the SHA-256 of the text, in hex', async () => {
		// Every passage's synced hash on every device is one of these: a change
		// would make each look edited here, and send it again.
		expect(await contentHash('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});
});

describe('withoutNul', () => {
	// What keeps U+0000 out of a passage's file, from the editor and from an
	// import (`store/passages.ts`, `archive/importLibrary.ts`).
	/** Two, three and four bytes a character in UTF-8. */
	const WIDE = 'é€𝄞\n';

	it('drops every U+0000 and nothing else', () => {
		expect(withoutNul('a\u0000b\u0000\u0000c\u0001')).toBe('abc\u0001');
		expect(withoutNul(WIDE)).toBe(WIDE);
	});
});
