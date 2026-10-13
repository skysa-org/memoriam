import { describe, expect, it } from 'vitest';

import { weekday } from '../../src/day.js';
import { type DayActivity } from '../../src/rewards/activity.js';
import { heatmap } from '../../src/rewards/heatmap.js';

const day = (words: number): DayActivity => ({ words, passes: 1, reviews: 0, started: 0, ms: 1 });

// A Tuesday.
const TODAY = '2026-10-13';

describe('heatmap', () => {
	it('is weeks from the week start, up to today', () => {
		const weeks = heatmap(new Map(), TODAY, { weeks: 3 });
		expect(weeks).toHaveLength(3);
		expect(weeks[0]?.[0]?.day).toBe('2026-09-28');
		expect(weekday(weeks[0]?.[0]?.day ?? '')).toBe(1);
		expect(weeks[2]?.map((cell) => cell.day)).toEqual(['2026-10-12', '2026-10-13']);
		expect(heatmap(new Map(), TODAY, { weeks: 1, weekStart: 0 })[0]?.[0]?.day).toBe(
			'2026-10-11'
		);
	});

	it('puts each day practised in a quarter of those in view', () => {
		const days = new Map([
			['2026-10-06', day(10)],
			['2026-10-07', day(20)],
			['2026-10-08', day(30)],
			['2026-10-09', day(400)],
		]);
		const cells = heatmap(days, TODAY, { weeks: 2 }).flat();
		const levelOn = (on: string) => cells.find((cell) => cell.day === on)?.level;
		expect(
			['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map(levelOn)
		).toEqual([0, 1, 2, 3, 4]);
	});

	it('marks the days the streak kept', () => {
		const cells = heatmap(new Map(), TODAY, {
			weeks: 1,
			kept: new Map([['2026-10-12', 'freeze']]),
		}).flat();
		expect(cells[0]).toEqual({ day: '2026-10-12', words: 0, level: 0, kept: 'freeze' });
	});
});
