import { firstKey } from '../passage/tokenize.js';
import { isNeighbour, type Neighbours } from './keyboard.js';

/**
 * Typing a chunk: a pure reducer from each key pressed, and each tick of the
 * clock, to where the pass has got (docs/ARCHITECTURE.md §4, "Typing").
 *
 * - The right first letter reveals the word, and the next is the one to type.
 * - A wrong one shows the word in red, and only its letter goes on: one miss,
 *   however many keys follow. On a touch keyboard, a neighbour of the right
 *   key is a slip instead, shown the same way and not counted.
 * - A key that is no letter or digit (a space, a full stop) is passed over.
 * - Idle on a word, a faint outline of it shows, then the word. Either is a
 *   hint, and counts as a miss; the word is still typed to go on.
 * - A wait before a word's first key longer than the hesitation threshold is
 *   a hesitation: not a miss, but a grade's business (`grade.ts`).
 */

/** How long idle on a word before its outline shows, and then the word. */
export const OUTLINE_AFTER_MS = 5000;
export const WORD_AFTER_MS = 8000;

/** The least wait that is a hesitation, however quick the typist. */
export const HESITATION_FLOOR_MS = 2000;
/** A hesitation is a wait this many times the typist's usual time per word. */
export const HESITATION_FACTOR = 2.5;

/**
 * The wait before a word's first key that counts as a hesitation: 2.5 times
 * the typist's median time per word on what they know, and never under two
 * seconds (`docs/research.md` §3.7).
 */
export const hesitationThreshold = (medianMsPerWord?: number): number =>
	Math.max(HESITATION_FLOOR_MS, HESITATION_FACTOR * (medianMsPerWord ?? 0));

/** How a typed word went. */
export interface WordResult {
	/** A wrong key that was not a slip, or a hint: it was not recalled. */
	readonly missed: boolean;
	/** A wrong key next to the right one, which does not count. */
	readonly slipped: boolean;
	/** Its outline or the word was shown before it was typed. */
	readonly hinted: boolean;
	/** Its first key came after longer than the hesitation threshold. */
	readonly hesitated: boolean;
	/** From when it was the word to type until it was typed. */
	readonly ms: number;
}

/** A hint the word to type is showing. */
export type Hint = 'none' | 'outline' | 'word';

/** What the last event did, for the screen to answer: a sound, a buzz. */
export type Effect = 'none' | 'right' | 'wrong' | 'slip' | 'hint';

export interface Typing {
	/** The key each word is typed by (`Word.key`). */
	readonly keys: readonly string[];
	/** How each word typed so far went; the next to type is the one after. */
	readonly results: readonly WordResult[];
	/** When the word to type became it. */
	readonly since: number;
	/** When its first key came, right or wrong. */
	readonly firstKeyAt?: number;
	/** A wrong key on it: shown in red until its letter is typed. */
	readonly wrong?: 'miss' | 'slip';
	readonly hint: Hint;
	readonly effect: Effect;
}

export type TypingEvent =
	| Readonly<{ type: 'key'; key: string; at: number }>
	/** The clock, to show a hint when one is due. */
	| Readonly<{ type: 'tick'; at: number }>
	/** A hint asked for: the next one, now. */
	| Readonly<{ type: 'hint'; at: number }>;

export interface TypingOptions {
	/** The wait that is a hesitation (`hesitationThreshold`). */
	readonly hesitationMs: number;
	/** The keyboard, for slips; none for a keyboard with keys, where there are none. */
	readonly neighbours?: Neighbours;
}

/** A pass over words typed by these keys, starting at `at`. */
export const startTyping = (keys: readonly string[], at: number): Typing => ({
	keys,
	results: [],
	since: at,
	hint: 'none',
	effect: 'none',
});

/** Whether every word has been typed. */
export const isTyped = (state: Typing): boolean => state.results.length >= state.keys.length;

const HINTS: readonly Hint[] = ['none', 'outline', 'word'];

const laterHint = (a: Hint, b: Hint): Hint => (HINTS.indexOf(a) >= HINTS.indexOf(b) ? a : b);

/** The hint due after this long idle on a word. */
const hintAfter = (ms: number): Hint => {
	if (ms >= WORD_AFTER_MS) return 'word';
	return ms >= OUTLINE_AFTER_MS ? 'outline' : 'none';
};

/** The word typed: its result, and the next word up. */
const typed = (state: Typing, at: number, options: TypingOptions): Typing => {
	const firstKeyAt = state.firstKeyAt ?? at;
	const hinted = state.hint !== 'none';
	const result: WordResult = {
		missed: state.wrong === 'miss' || hinted,
		slipped: state.wrong === 'slip',
		hinted,
		hesitated: firstKeyAt - state.since > options.hesitationMs,
		ms: at - state.since,
	};
	return {
		keys: state.keys,
		results: [...state.results, result],
		since: at,
		hint: 'none',
		effect: 'right',
	};
};

const pressed = (state: Typing, key: string, at: number, options: TypingOptions): Typing => {
	const wanted = state.keys[state.results.length];
	const got = firstKey(key);
	if (wanted === undefined || got === undefined) return { ...state, effect: 'none' };
	const touched = { ...state, firstKeyAt: state.firstKeyAt ?? at };
	if (got === wanted) return typed(touched, at, options);
	// A word already shown wrong stays as it was first marked: the keys after
	// that are copying what is in front of the typist, not recalling it.
	if (state.wrong !== undefined) return { ...touched, effect: 'wrong' };
	const slip = options.neighbours !== undefined && isNeighbour(options.neighbours, wanted, got);
	return { ...touched, wrong: slip ? 'slip' : 'miss', effect: slip ? 'slip' : 'wrong' };
};

/** Where a pass gets to after an event. */
export const typing = (state: Typing, event: TypingEvent, options: TypingOptions): Typing => {
	if (isTyped(state)) return { ...state, effect: 'none' };
	if (event.type === 'key') return pressed(state, event.key, event.at, options);
	// Hints are for a word not yet given away: a wrong key has shown it.
	if (state.wrong !== undefined) return { ...state, effect: 'none' };
	const hint =
		event.type === 'hint'
			? (HINTS[HINTS.indexOf(state.hint) + 1] ?? 'word')
			: laterHint(state.hint, hintAfter(event.at - state.since));
	return { ...state, hint, effect: hint === state.hint ? 'none' : 'hint' };
};
