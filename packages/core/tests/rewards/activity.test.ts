import { describe, expect, it } from 'vitest';

import { activityPath, addToDay, dayKey, readActivity } from '../../src/rewards/activity.js';

const DAY = { words: 20, passes: 2, reviews: 1, ms: 15000 };

const written = (text: string | undefined, key: string, more = DAY): string => {
	const result = addToDay(text, key, more);
	if (!result.ok) throw new Error(result.reason);
	return result.text;
};

describe('activity', () => {
	it('is kept in the app’s own folder, a file a year', () => {
		expect(activityPath(2026)).toBe('.memoriam/activity-2026.md');
		expect(dayKey('2026-10-13', 'k3fq9mab')).toBe('2026-10-13~k3fq9mab');
	});

	it('starts a file with a day’s line', () => {
		expect(written(undefined, '2026-10-13~k3fq9mab')).toBe(
			'---\ndays:\n  2026-10-13~k3fq9mab: { words: 20, passes: 2, reviews: 1, ms: 15000 }\n---\n'
		);
	});

	it('adds to a day, and starts the next below it', () => {
		const first = written(undefined, '2026-10-13~a');
		const again = written(first, '2026-10-13~a', {
			words: 5,
			passes: 1,
			reviews: 0,
			ms: 2500.4,
		});
		const next = written(again, '2026-10-14~a');
		expect([...readActivity(next).days]).toEqual([
			['2026-10-13~a', { words: 25, passes: 3, reviews: 1, ms: 17500 }],
			['2026-10-14~a', DAY],
		]);
	});

	it('keeps what it does not know: other keys, comments, another device’s days', () => {
		const theirs =
			'---\n# kept by hand\nnote: mine\ndays:\n  2026-10-13~b: { words: 3, passes: 1, reviews: 0, ms: 900 }\nbadges:\n  first-learnt: 2026-10-01\n---\n\nA body.\n';
		const text = written(theirs, '2026-10-13~a');
		expect(text).toContain('# kept by hand\nnote: mine\n');
		expect(text).toContain('2026-10-13~b: { words: 3, passes: 1, reviews: 0, ms: 900 }\n');
		expect(text.endsWith('---\n\nA body.\n')).toBe(true);
		expect(readActivity(text).badges).toEqual(new Map([['first-learnt', '2026-10-01']]));
	});

	it('will not write over what it cannot read', () => {
		expect(addToDay('---\ndays: [a\n---\n', 'k', DAY)).toEqual({
			ok: false,
			reason: 'unreadable',
		});
		expect(addToDay('---\ndays: lots\n---\n', 'k', DAY)).toEqual({
			ok: false,
			reason: 'unreadable',
		});
		expect(addToDay('---\ndays:\n  k: 5\n---\n', 'k', DAY)).toEqual({
			ok: false,
			reason: 'unreadable',
		});
	});

	it('reads leniently: what is not a count is none', () => {
		const activity = readActivity(
			'---\ndays:\n  2026-10-13~a: { words: many, passes: 2, ms: -5 }\n  odd: 7\n---\n'
		);
		expect([...activity.days]).toEqual([
			['2026-10-13~a', { words: 0, passes: 2, reviews: 0, ms: 0 }],
		]);
		expect(readActivity('no frontmatter').days.size).toBe(0);
	});
});
