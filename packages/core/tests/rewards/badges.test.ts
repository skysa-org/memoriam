import { describe, expect, it } from 'vitest';

import { BADGES, earnedBadges, isBadge } from '../../src/rewards/badges.js';
import { type Measure } from '../../src/rewards/mastery.js';
import { NO_STREAK } from '../../src/rewards/streak.js';

const TODAY = '2026-10-13';

const passage = (more: Partial<Measure> = {}): Measure => ({
	words: 100,
	learntWords: 0,
	mastery: 0,
	learnt: false,
	mastered: false,
	...more,
});

describe('earnedBadges', () => {
	it('earns nothing for nothing', () => {
		expect(earnedBadges({ today: TODAY, passages: [passage()], streak: NO_STREAK }).size).toBe(
			0
		);
	});

	it('earns for words learnt across the library, and for a passage learnt and mastered', () => {
		const earned = earnedBadges({
			today: TODAY,
			passages: [
				passage({ learntWords: 300, learnt: true, heldSince: '2026-10-01' }),
				passage({ learntWords: 250, learnt: true, mastered: true }),
			],
			streak: NO_STREAK,
		});
		expect(Object.fromEntries(earned)).toEqual({
			'first-learnt': '2026-10-01',
			'first-mastered': TODAY,
			'words-100': TODAY,
			'words-500': TODAY,
		});
	});

	it('earns for a passage held, on the day it had been held long enough', () => {
		const earned = earnedBadges({
			today: TODAY,
			passages: [passage({ learntWords: 50, learnt: true, heldSince: '2026-07-01' })],
			streak: NO_STREAK,
		});
		expect(earned.get('held-30')).toBe('2026-07-31');
		expect(earned.get('held-90')).toBe('2026-09-29');
		expect(earned.has('held-365')).toBe(false);
	});

	it('earns for a streak on the day it reached its length, and for coming back', () => {
		const earned = earnedBadges({
			today: TODAY,
			passages: [],
			streak: {
				...NO_STREAK,
				reached: new Map([[7, '2026-09-07']]),
				comebacks: ['2026-08-01', '2026-09-20'],
			},
		});
		expect(Object.fromEntries(earned)).toEqual({
			'streak-7': '2026-09-07',
			comeback: '2026-08-01',
		});
	});
});

describe('isBadge', () => {
	it('knows the badges, and nothing else', () => {
		expect(BADGES.every(isBadge)).toBe(true);
		expect(isBadge('streak-8')).toBe(false);
	});
});
