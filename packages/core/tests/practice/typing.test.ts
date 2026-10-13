import { describe, expect, it } from 'vitest';

import { QWERTY } from '../../src/practice/keyboard.js';
import {
	hesitationThreshold,
	isTyped,
	startTyping,
	type Typing,
	typing,
	type TypingEvent,
	type TypingOptions,
} from '../../src/practice/typing.js';

const OPTIONS: TypingOptions = { hesitationMs: 2000 };
const TOUCH: TypingOptions = { ...OPTIONS, neighbours: QWERTY };

/** Events run through the reducer from a start at 0. */
const run = (
	keys: readonly string[],
	events: readonly TypingEvent[],
	options: TypingOptions = OPTIONS
): Typing => events.reduce((state, event) => typing(state, event, options), startTyping(keys, 0));

/** Keys pressed a second apart, from one second in. */
const press = (...keys: string[]): TypingEvent[] =>
	keys.map((key, at) => ({ type: 'key', key, at: (at + 1) * 1000 }));

const CLEAN = { missed: false, slipped: false, hinted: false, hesitated: false, ms: 1000 };

describe('typing', () => {
	it('reveals each word on its first letter, and is done after the last', () => {
		const state = run(['t', 'l', 'i'], press('t', 'l', 'i'));
		expect(state.results).toEqual([CLEAN, CLEAN, CLEAN]);
		expect(isTyped(state)).toBe(true);
		expect(state.effect).toBe('right');
	});

	it('takes a capital, or a letter without its accent, as the letter', () => {
		expect(run(['e', 'σ'], press('É', 'Σ')).results).toEqual([CLEAN, CLEAN]);
		expect(run(['e'], press('e')).results).toEqual([CLEAN]);
	});

	it('passes over a key that is no letter', () => {
		const state = run(
			['t'],
			[
				{ type: 'key', key: ' ', at: 300 },
				{ type: 'key', key: '.', at: 600 },
				{ type: 'key', key: 't', at: 900 },
			]
		);
		expect(state.results).toEqual([{ ...CLEAN, ms: 900 }]);
		// Nor is it the word's first key: a wait for a space is still a wait.
		const late = run(['t'], press(' ', '.', 't'));
		expect(late.results[0]?.hesitated).toBe(true);
	});

	it('shows a word in red on a wrong key, and counts one miss however many follow', () => {
		const wrong = run(['t', 'l'], press('x'));
		expect(wrong).toMatchObject({ wrong: 'miss', effect: 'wrong', results: [] });
		const state = run(['t', 'l'], press('x', 'k', 'z', 't', 'l'));
		expect(state.results).toEqual([{ ...CLEAN, missed: true, ms: 4000 }, CLEAN]);
	});

	it('counts a key next to the right one on a touch keyboard as a slip, not a miss', () => {
		const slip = run(['s'], press('a'), TOUCH);
		expect(slip).toMatchObject({ wrong: 'slip', effect: 'slip' });
		expect(run(['s'], press('a', 's'), TOUCH).results).toEqual([
			{ ...CLEAN, slipped: true, ms: 2000 },
		]);
		// With keys under the fingers there are no slips.
		expect(run(['s'], press('a', 's')).results[0]?.missed).toBe(true);
	});

	it('marks a word as its first wrong key did', () => {
		const state = run(['s'], press('a', 'k', 's'), TOUCH);
		expect(state.results[0]).toMatchObject({ slipped: true, missed: false });
	});

	it('shows an outline after five seconds idle, then the word, and counts it a miss', () => {
		const outline = run(['t'], [{ type: 'tick', at: 5000 }]);
		expect(outline).toMatchObject({ hint: 'outline', effect: 'hint' });
		const word = run(
			['t'],
			[
				{ type: 'tick', at: 5000 },
				{ type: 'tick', at: 8000 },
			]
		);
		expect(word.hint).toBe('word');
		const typed = typing(word, { type: 'key', key: 't', at: 9000 }, OPTIONS);
		expect(typed.results[0]).toEqual({
			missed: true,
			slipped: false,
			hinted: true,
			hesitated: true,
			ms: 9000,
		});
		expect(typed.hint).toBe('none');
	});

	it('shows no hint before it is due', () => {
		const state = run(['t'], [{ type: 'tick', at: 4999 }]);
		expect(state).toMatchObject({ hint: 'none', effect: 'none' });
	});

	it('gives a hint asked for, the outline and then the word', () => {
		const once = run(['t'], [{ type: 'hint', at: 500 }]);
		expect(once.hint).toBe('outline');
		const twice = typing(once, { type: 'hint', at: 600 }, OPTIONS);
		expect(twice.hint).toBe('word');
		expect(typing(twice, { type: 'hint', at: 700 }, OPTIONS).hint).toBe('word');
	});

	it('gives no hint for a word a wrong key has shown', () => {
		const state = run(
			['t'],
			[
				{ type: 'key', key: 'x', at: 100 },
				{ type: 'tick', at: 9000 },
			]
		);
		expect(state.hint).toBe('none');
	});

	it('times each word from when it was the one to type', () => {
		const state = run(
			['a', 'b'],
			[
				{ type: 'key', key: 'a', at: 1500 },
				{ type: 'key', key: 'b', at: 4000 },
			]
		);
		expect(state.results.map((result) => result.ms)).toEqual([1500, 2500]);
		expect(state.results.map((result) => result.hesitated)).toEqual([false, true]);
	});

	it('counts a hesitation to the first key on a word, right or wrong', () => {
		const state = run(
			['a'],
			[
				{ type: 'key', key: 'x', at: 1000 },
				{ type: 'key', key: 'a', at: 6000 },
			]
		);
		expect(state.results[0]).toMatchObject({ hesitated: false, missed: true, ms: 6000 });
	});

	it('takes no more keys once every word is typed', () => {
		const done = run(['a'], press('a'));
		expect(typing(done, { type: 'key', key: 'x', at: 9000 }, OPTIONS)).toEqual({
			...done,
			effect: 'none',
		});
	});
});

describe('hesitationThreshold', () => {
	it('is two and a half times the typist’s usual time per word, and two seconds at least', () => {
		expect(hesitationThreshold()).toBe(2000);
		expect(hesitationThreshold(400)).toBe(2000);
		expect(hesitationThreshold(1200)).toBe(3000);
	});
});
