import { randoms } from './random.js';

/**
 * Which of a chunk's words are hidden on a pass, by its level on the fade
 * ladder (docs/ARCHITECTURE.md §4, `docs/research.md` §2.1):
 *
 * | Level | Shown                                                    |
 * |-------|----------------------------------------------------------|
 * | 0     | every word                                               |
 * | 1     | about a quarter hidden, as placeholders of their length  |
 * | 2     | about half hidden                                        |
 * | 3     | about three quarters hidden                              |
 * | 4     | every word hidden, as placeholders                       |
 * | 5     | bare: nothing until it is typed                          |
 *
 * Within a session, words take turns: those hidden least so far are hidden
 * first, so a second pass at level 2 hides mostly the half the first showed,
 * and every word is hidden within a few passes. Among words hidden as often, one missed less
 * over time (`progress.misses`) is likelier to be hidden: what is known loses
 * its cue first. A word missed on a pass is shown on the next and hidden again
 * on the one after. At levels 1 and 2 no more than two, then three, hidden
 * words come in a row, so there is always a word to go on from.
 */

/** How a word is shown on a pass. */
export type Shown = 'word' | 'placeholder' | 'bare';

/** The share of a chunk's words hidden at each level. */
export const HIDDEN_SHARE: readonly number[] = [0, 0.25, 0.5, 0.75, 1, 1];

/** The most hidden words in a row, at the levels that keep some shown. */
const MAX_RUN: Readonly<Record<number, number>> = { 1: 2, 2: 3 };

/** A pass this session, as hiding needs it. */
export interface PastPass {
	/** The words that were not shown. */
	readonly hidden: readonly boolean[];
	readonly missed: readonly boolean[];
}

export interface HideInput {
	readonly level: number;
	/** The same seed, with the same history and misses, hides the same words. */
	readonly seed: number;
	/** This session's earlier passes over the chunk, oldest first. */
	readonly history: readonly PastPass[];
	/** Each word's misses over all time, as `progress` keeps them. */
	readonly misses?: readonly number[];
}

/** How long the run of hidden words through `at` would be, were it hidden. */
const runThrough = (hidden: readonly boolean[], at: number): number => {
	const before = hidden
		.slice(0, at)
		.reverse()
		.findIndex((each) => !each);
	const after = hidden.slice(at + 1).findIndex((each) => !each);
	return (before === -1 ? at : before) + 1 + (after === -1 ? hidden.length - at - 1 : after);
};

/**
 * Words hidden at a level that keeps some shown: what is owed first, then the
 * rest in turn, as far as the share goes and the runs allow.
 */
const someHidden = (
	count: number,
	{ level, seed, history, misses = [] }: HideInput,
	shownOnce: readonly boolean[]
): boolean[] => {
	const last = history.at(-1);
	const before = history.at(-2);
	const owed = Array.from(
		{ length: count },
		(_, at) => before?.missed[at] === true && last?.missed[at] !== true
	);
	const times = Array.from(
		{ length: count },
		(_, at) => history.filter((pass) => pass.hidden[at] === true).length
	);
	const draws = randoms(seed, count);
	// Weighted at random within a turn (Efraimidis–Spirakis): a key of
	// `u^(1/w)`, with a word's weight falling as its misses rise.
	const order = Array.from({ length: count }, (_, at) => at)
		.filter((at) => !owed[at] && !shownOnce[at])
		.map((at) => ({
			at,
			turn: times[at] ?? 0,
			key: (draws[at] ?? 0) ** (1 + (misses[at] ?? 0)),
		}))
		.sort((a, b) => a.turn - b.turn || b.key - a.key);
	const target = Math.min(count, Math.max(1, Math.round((HIDDEN_SHARE[level] ?? 1) * count)));
	const run = MAX_RUN[level] ?? count;
	return order.reduce<boolean[]>(
		(hidden, { at }) => {
			if (hidden.filter(Boolean).length >= target || runThrough(hidden, at) > run) {
				return hidden;
			}
			return hidden.map((each, n) => each || n === at);
		},
		// Owed words are hidden whatever the share: none was missed last pass,
		// so none is among those shown once.
		owed
	);
};

/** How each of a chunk's `count` words is shown on a pass. */
export const hideWords = (count: number, input: HideInput): Shown[] => {
	const { level, history } = input;
	if (level <= 0) return Array.from({ length: count }, () => 'word');
	if (level >= HIDDEN_SHARE.length - 1) return Array.from({ length: count }, () => 'bare');
	const shownOnce = Array.from({ length: count }, (_, at) => history.at(-1)?.missed[at] === true);
	const hidden =
		HIDDEN_SHARE[level] === 1
			? shownOnce.map((each) => !each)
			: someHidden(count, input, shownOnce);
	return hidden.map((each) => (each ? 'placeholder' : 'word'));
};
