/**
 * Which keys sit next to which on a touch keyboard, so a tap that lands on a
 * neighbour of the right letter is a slip, not a miss (docs/ARCHITECTURE.md
 * §4, "Typing"; `docs/research.md` §3.7).
 *
 * Worked out from where the keys are: each row's letters a key's width apart,
 * the second row half a key in, the third a key and a half in, behind the
 * shift key, as phone keyboards lay them out. Keys whose centres are within
 * 1.2 key widths of each other are neighbours: side by side, and above or
 * below on either side.
 */

/** Each key, and the keys around it. */
export type Neighbours = ReadonlyMap<string, ReadonlySet<string>>;

const REACH = 1.2;

const layout = (rows: readonly string[], offsets: readonly number[]): Neighbours => {
	const keys = rows.flatMap((row, y) =>
		Array.from(row, (key, x) => ({ key, x: x + (offsets[y] ?? 0), y }))
	);
	return new Map(
		keys.map((one) => [
			one.key,
			new Set(
				keys
					.filter(
						(other) =>
							other !== one && Math.hypot(other.x - one.x, other.y - one.y) <= REACH
					)
					.map((other) => other.key)
			),
		])
	);
};

/** QWERTY, as iOS and Android lay it out. */
export const QWERTY: Neighbours = layout(['qwertyuiop', 'asdfghjkl', 'zxcvbnm'], [0, 0.5, 1.5]);

/** Whether `typed` is next to `wanted` on this keyboard. */
export const isNeighbour = (keyboard: Neighbours, wanted: string, typed: string): boolean =>
	keyboard.get(wanted)?.has(typed) === true;
