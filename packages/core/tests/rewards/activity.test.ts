import { describe, expect, it } from 'vitest';

import {
	activityIsReadable,
	activityPath,
	addBadges,
	addToDay,
	dayKey,
	dayTotals,
	isActivityPath,
	mergeActivity,
	readActivity,
	recordedBadges,
} from '../../src/rewards/activity.js';

const DAY = { words: 20, passes: 2, reviews: 1, started: 10, ms: 15000 };

const written = (text: string | undefined, key: string, more = DAY): string => {
	const result = addToDay(text, key, more);
	if (!result.ok) throw new Error(result.reason);
	return result.text;
};

describe('activity', () => {
	it('is kept in the app’s own folder, a file a year', () => {
		expect(activityPath(2026)).toBe('.memoriam/activity-2026.md');
		expect(dayKey('2026-10-13', 'k3fq9mab')).toBe('2026-10-13~k3fq9mab');
		expect(isActivityPath('.memoriam/activity-2026.md')).toBe(true);
		expect(isActivityPath('activity-2026.md')).toBe(false);
		expect(isActivityPath('.memoriam/activity-2026.md.bak')).toBe(false);
	});

	it('starts a file with a day’s line', () => {
		expect(written(undefined, '2026-10-13~k3fq9mab')).toBe(
			'---\ndays:\n  2026-10-13~k3fq9mab: { words: 20, passes: 2, reviews: 1, started: 10, ms: 15000 }\n---\n'
		);
	});

	it('adds to a day, and starts the next below it', () => {
		const first = written(undefined, '2026-10-13~a');
		const again = written(first, '2026-10-13~a', {
			words: 5,
			passes: 1,
			reviews: 0,
			started: 0,
			ms: 2500.4,
		});
		const next = written(again, '2026-10-14~a');
		expect([...readActivity(next).days]).toEqual([
			['2026-10-13~a', { words: 25, passes: 3, reviews: 1, started: 10, ms: 17500 }],
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

	it('says whether a file can be read and added to', () => {
		expect(activityIsReadable(written(undefined, 'k'))).toBe(true);
		expect(activityIsReadable('')).toBe(true);
		expect(activityIsReadable('---\ndays: [a\n---\n')).toBe(false);
		expect(activityIsReadable('---\nbadges: lots\n---\n')).toBe(false);
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
			['2026-10-13~a', { words: 0, passes: 2, reviews: 0, started: 0, ms: 0 }],
		]);
		expect(readActivity('no frontmatter').days.size).toBe(0);
	});
});

describe('badges', () => {
	it('adds a badge earned, and keeps the day of one already there', () => {
		const first = addBadges(
			written(undefined, '2026-10-13~a'),
			new Map([['first-learnt', '2026-10-13']])
		);
		if (!first.ok) throw new Error(first.reason);
		const again = addBadges(
			first.text,
			new Map([
				['first-learnt', '2026-10-20'],
				['words-100', '2026-10-20'],
			])
		);
		if (!again.ok) throw new Error(again.reason);
		expect(again.text).toContain(
			'badges:\n  first-learnt: 2026-10-13\n  words-100: 2026-10-20\n'
		);
		expect(readActivity(again.text).days.size).toBe(1);
	});

	it('will not write over badges it cannot read', () => {
		expect(addBadges('---\nbadges: [a]\n---\n', new Map([['comeback', '2026-10-13']]))).toEqual(
			{
				ok: false,
				reason: 'unreadable',
			}
		);
	});
});

describe('across files', () => {
	const a = readActivity(
		'---\ndays:\n  2026-10-13~a: { words: 10, passes: 1, reviews: 1, started: 5, ms: 100 }\n  2026-10-14~a: { words: 1, passes: 1, reviews: 0, started: 0, ms: 1 }\nbadges:\n  comeback: 2026-10-14\n---\n'
	);
	const b = readActivity(
		'---\ndays:\n  2026-10-13~b: { words: 20, passes: 2, reviews: 0, started: 0, ms: 200 }\nbadges:\n  comeback: 2026-10-13\n  first-learnt: 2026-10-14\n---\n'
	);

	it('sums each day over every device', () => {
		expect(dayTotals([a, b]).get('2026-10-13')).toEqual({
			words: 30,
			passes: 3,
			reviews: 1,
			started: 5,
			ms: 300,
		});
		expect(dayTotals([a, b]).size).toBe(2);
	});

	it('keeps the earliest day any file gives a badge', () => {
		expect(Object.fromEntries(recordedBadges([a, b]))).toEqual({
			comeback: '2026-10-13',
			'first-learnt': '2026-10-14',
		});
	});
});

describe('mergeActivity', () => {
	const ours =
		'---\n# kept\ndays:\n  2026-10-13~a: { words: 10, passes: 1, reviews: 0, started: 5, ms: 100 }\n  2026-10-14~a: { words: 4, passes: 1, reviews: 0, started: 0, ms: 50 }\nbadges:\n  comeback: 2026-10-14\n---\n';
	const theirs = readActivity(
		'---\ndays:\n  2026-10-13~a: { words: 25, passes: 2, reviews: 1, started: 5, ms: 90 }\n  2026-10-13~b: { words: 3, passes: 1, reviews: 0, started: 0, ms: 10 }\nbadges:\n  comeback: 2026-10-13\n  first-learnt: 2026-10-15\n---\n'
	);

	it('keeps every day, each count the larger, and every badge at its earlier day', () => {
		const merged = mergeActivity(ours, theirs);
		if (!merged.ok) throw new Error(merged.reason);
		const activity = readActivity(merged.text);
		expect(Object.fromEntries(activity.days)).toEqual({
			'2026-10-13~a': { words: 25, passes: 2, reviews: 1, started: 5, ms: 100 },
			'2026-10-14~a': { words: 4, passes: 1, reviews: 0, started: 0, ms: 50 },
			'2026-10-13~b': { words: 3, passes: 1, reviews: 0, started: 0, ms: 10 },
		});
		expect(Object.fromEntries(activity.badges)).toEqual({
			comeback: '2026-10-13',
			'first-learnt': '2026-10-15',
		});
		expect(merged.text).toContain('# kept\n');
	});

	it('gives ours back as it was when the incoming one adds nothing to it', () => {
		const partial =
			'---\ndays:\n  2026-10-13~a: {words: 10, passes: 1}\nbadges:\n  comeback: 2026-10-01\n---\n';
		const older = readActivity(
			'---\ndays:\n  2026-10-13~a: { words: 9, passes: 1 }\nbadges:\n  comeback: 2026-10-02\n---\n'
		);
		expect(mergeActivity(partial, older)).toEqual({ ok: true, text: partial });
		expect(mergeActivity(partial, readActivity(partial))).toEqual({ ok: true, text: partial });
	});

	it('makes a file of the incoming one where there is none, and leaves one it cannot read', () => {
		const made = mergeActivity(undefined, theirs);
		if (!made.ok) throw new Error(made.reason);
		expect(readActivity(made.text).days.size).toBe(2);
		expect(mergeActivity('---\ndays: [\n---\n', theirs)).toEqual({
			ok: false,
			reason: 'unreadable',
		});
	});
});
