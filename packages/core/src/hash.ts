/**
 * Hashing, for two different jobs.
 *
 * `contentHash` tells "the same bytes" from "edited" without keeping a second
 * copy of every passage: SHA-256 through Web Crypto, so it runs unchanged in the
 * browser, in Node and in Workers, and is asynchronous as Web Crypto is.
 *
 * `shortKey` names a chunk of a passage in its frontmatter (docs/ARCHITECTURE.md
 * §3, "Chunk keys"). It has to be synchronous, since keys are computed while a
 * passage is read, and short, since a person reads them in the file. It is not
 * a cryptographic hash and nothing relies on it being one: two chunks of one
 * passage that share a key are told apart by an occurrence suffix, as a refrain
 * is.
 */

const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** SHA-256 of the UTF-8 encoding of `text`, lowercase hex. */
export const contentHash = async (text: string): Promise<string> => {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return toHex(new Uint8Array(digest));
};

const mixUnit = ([a, b]: readonly [number, number], unit: number): readonly [number, number] => [
	Math.imul(a ^ unit, 2654435761),
	Math.imul(b ^ unit, 1597334677),
];

/**
 * cyrb53, a 53-bit string hash by bryc (public domain):
 * https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
 *
 * Over UTF-16 code units, as the original is. That is stable for a given
 * string, which is all a key needs: the text is normalized before it is hashed.
 */
export const cyrb53 = (text: string, seed = 0): number => {
	const [h1, h2] = Array.from({ length: text.length }, (_, at) => text.charCodeAt(at)).reduce(
		mixUnit,
		[0xdeadbeef ^ seed, 0x41c6ce57 ^ seed] as const
	);
	const f1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	const f2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(f1 ^ (f1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & f2) + (f1 >>> 0);
};

/**
 * Crockford's base 32, lowercased: no `i`, `l`, `o` or `u`, so a key read aloud
 * or copied by hand has no letter that passes for another.
 */
const BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';

/** The letters of `BASE32`, for a key's first character. */
const LETTERS = BASE32.slice(10);

/** How many characters a key has. */
export const SHORT_KEY_LENGTH = 7;

/**
 * Seven characters from `text`'s cyrb53: a letter, then six of base 32, about
 * 34 bits in all.
 *
 * The letter first, so YAML never reads a key as a number (`1e5`, `0x1f`, and
 * `12345` all would be) and no tool that sorts keys sorts them numerically.
 * None of the seven-character words YAML 1.1 or 1.2 reads as anything but a
 * string can come out of this: those are all shorter.
 */
export const shortKey = (text: string): string => {
	const hash = cyrb53(text);
	const first = LETTERS.charAt(hash % LETTERS.length);
	const rest = Math.floor(hash / LETTERS.length);
	return (
		first +
		Array.from({ length: SHORT_KEY_LENGTH - 1 }, (_, at) =>
			BASE32.charAt(Math.floor(rest / 32 ** at) % 32)
		).join('')
	);
};
