import { describe, expect, it } from 'vitest';

import { addDays, instant, localDay } from '../src/day.js';

describe('localDay', () => {
	it('is the day on the user’s own clock', () => {
		expect(localDay(new Date(2026, 9, 13, 23, 59))).toBe('2026-10-13');
		expect(localDay(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
	});
});

describe('addDays', () => {
	it('counts across months, years and leap days', () => {
		expect(addDays('2026-10-13', 1)).toBe('2026-10-14');
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
	});
});

describe('instant', () => {
	it('is UTC to the second', () => {
		expect(instant(new Date(Date.UTC(2026, 9, 13, 14, 3, 2, 789)))).toBe(
			'2026-10-13T14:03:02Z'
		);
	});
});
