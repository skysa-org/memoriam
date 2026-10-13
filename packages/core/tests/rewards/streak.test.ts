import { describe, expect, it } from 'vitest';

import { addDays, weekday } from '../../src/day.js';
import { type DayActivity } from '../../src/rewards/activity.js';
import { REPAIR_FLOOR, repairWords, streakOf } from '../../src/rewards/streak.js';

const START = '2026-09-01';
const day = (at: number): string => addDays(START, at);

const PRACTICE: DayActivity = { words: 100, passes: 4, reviews: 2, started: 20, ms: 60_000 };

/** Days practised, by their place after START; a number pair gives the words. */
const practised = (...at: readonly (number | readonly [number, number])[]) =>
	new Map(
		at.map((each) =>
			typeof each === 'number'
				? [day(each), PRACTICE]
				: [day(each[0]), { ...PRACTICE, words: each[1] }]
		)
	);

const range = (from: number, to: number): number[] =>
	Array.from({ length: to - from + 1 }, (_, at) => from + at);

describe('streakOf', () => {
	it('is none before anything is practised', () => {
		const streak = streakOf(new Map(), day(0));
		expect(streak).toMatchObject({ length: 0, best: 0, freezes: 0, practisedToday: false });
	});

	it('counts days in a row, and today is never missed', () => {
		const days = practised(...range(0, 4));
		expect(streakOf(days, day(4))).toMatchObject({ length: 5, practisedToday: true });
		// Today not practised yet: still five.
		expect(streakOf(days, day(5))).toMatchObject({ length: 5, practisedToday: false });
	});

	it('does not count a day with no pass finished', () => {
		const days = new Map([
			[day(0), PRACTICE],
			[day(1), { ...PRACTICE, passes: 0 }],
		]);
		expect(streakOf(days, day(1)).length).toBe(1);
	});

	it('earns a freeze each 7 days in a row, holds two, and spends one on a missed day', () => {
		expect(streakOf(practised(...range(0, 6)), day(6)).freezes).toBe(1);
		expect(streakOf(practised(...range(0, 20)), day(20)).freezes).toBe(2);
		// Day 7 missed: a freeze spent, and the streak goes on.
		const streak = streakOf(practised(...range(0, 6), 8, 9), day(9));
		expect(streak).toMatchObject({ length: 9, freezes: 0 });
		expect(streak.kept.get(day(7))).toBe('freeze');
	});

	it('offers a repair for a day missed with no freeze, and keeps the streak while it can be made', () => {
		const days = practised(0, 1, 2);
		const streak = streakOf(days, day(4));
		expect(streak.length).toBe(3);
		expect(streak.repair).toEqual({ missed: day(3), until: day(5), words: 200 });
	});

	it('is mended by a day of twice the usual practice, within two days', () => {
		const streak = streakOf(practised(0, 1, 2, 4, [5, 200], 6), day(6));
		expect(streak.length).toBe(6);
		expect(streak.kept.get(day(3))).toBe('repair');
		expect(streak.repair).toBeUndefined();
	});

	it('starts afresh from the days after a miss once the repair can no longer be made', () => {
		const streak = streakOf(practised(0, 1, 2, 4, 5, 6), day(6));
		expect(streak).toMatchObject({ length: 3, best: 5 });
		expect(streak.repair).toBeUndefined();
		const lapsed = streakOf(practised(0, 1, 2), day(6));
		expect(lapsed.length).toBe(0);
	});

	it('neither counts nor breaks on the rest day', () => {
		const rest = weekday(day(3));
		const streak = streakOf(practised(0, 1, 2, 4), day(4), { restDay: rest });
		expect(streak.length).toBe(4);
		expect(streak.kept.get(day(3))).toBe('rest');
		// Practised on it, it counts like any other day.
		expect(streakOf(practised(...range(0, 4)), day(4), { restDay: rest }).length).toBe(5);
	});

	it('marks the day each milestone was first reached', () => {
		const streak = streakOf(practised(...range(0, 29)), day(29));
		expect([...streak.reached]).toEqual([
			[7, day(6)],
			[30, day(29)],
		]);
	});

	it('welcomes back practice after a week or more without', () => {
		expect(streakOf(practised(0, 8), day(8)).comebacks).toEqual([day(8)]);
		expect(streakOf(practised(0, 7), day(7)).comebacks).toEqual([]);
	});
});

describe('repairWords', () => {
	it('asks for twice the usual day, and never less than the floor', () => {
		expect(repairWords(practised([0, 50], [1, 70], [2, 300]), day(3))).toBe(140);
		expect(repairWords(practised([0, 5]), day(3))).toBe(REPAIR_FLOOR);
		expect(repairWords(new Map(), day(3))).toBe(REPAIR_FLOOR);
	});
});
