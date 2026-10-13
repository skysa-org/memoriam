/**
 * Seeded random numbers (mulberry32), so a pass that hides words at random
 * hides the same ones again from the same seed: a pass can be replayed
 * exactly, and a test can say what it expects (docs/ARCHITECTURE.md §4).
 */

/** One step: a number in [0, 1), and the state after it. */
const step = (state: number): readonly [number, number] => {
	const next = (state + 0x6d2b79f5) | 0;
	const a = Math.imul(next ^ (next >>> 15), 1 | next);
	const b = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a;
	return [((b ^ (b >>> 14)) >>> 0) / 4294967296, next];
};

/** `count` numbers in [0, 1) from `seed`: the same seed, the same numbers. */
export const randoms = (seed: number, count: number): number[] =>
	Array.from({ length: count }).reduce<{ out: number[]; state: number }>(
		({ out, state }) => {
			const [value, next] = step(state);
			return { out: [...out, value], state: next };
		},
		{ out: [], state: seed | 0 }
	).out;
