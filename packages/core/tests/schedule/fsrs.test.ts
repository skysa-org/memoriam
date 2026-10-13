import { describe, expect, it } from 'vitest';

import { type ChunkProgress } from '../../src/progress/codec.js';
import {
	cardOf,
	isDue,
	isRelearning,
	LAPSE_LEVEL,
	recall,
	reviewed,
} from '../../src/schedule/fsrs.js';

const LEARNT: ChunkProgress = { level: 5, due: '2026-10-14', reviewed: '2026-10-13T20:00:00Z' };
const DAY_AFTER = new Date(2026, 9, 14, 9, 0);

describe('cardOf', () => {
	it('is no card for a chunk not yet learnt', () => {
		expect(cardOf({ level: 3 })).toBeUndefined();
	});

	it('is a new card for a chunk learnt and not yet reviewed', () => {
		expect(cardOf(LEARNT)).toMatchObject({ state: 0, reps: 0 });
	});

	it('is a review card for one reviewed before', () => {
		const card = cardOf({ ...LEARNT, stability: 6.2, difficulty: 4.1, reps: 3, lapses: 1 });
		expect(card).toMatchObject({
			state: 2,
			stability: 6.2,
			difficulty: 4.1,
			reps: 3,
			lapses: 1,
		});
	});
});

describe('reviewed', () => {
	it('gives a first review its card, due days on', () => {
		const after = reviewed(LEARNT, 'good', DAY_AFTER);
		expect(after).toMatchObject({
			level: 5,
			reps: 1,
			lapses: 0,
			reviewed: '2026-10-14T' + after.reviewed?.slice(11),
		});
		expect(after.stability).toBeGreaterThan(1);
		expect(after.difficulty).toBeGreaterThanOrEqual(1);
		expect(after.due && after.due > '2026-10-14').toBe(true);
	});

	it('keeps two places, as the file does', () => {
		const after = reviewed(LEARNT, 'hard', DAY_AFTER);
		expect(String(after.stability).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
		expect(String(after.difficulty).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(2);
	});

	it('spaces an easy review further than a good one, and a good than a hard', () => {
		const due = (grade: 'hard' | 'good' | 'easy') =>
			reviewed(LEARNT, grade, DAY_AFTER).due ?? '';
		expect(due('hard') <= due('good')).toBe(true);
		expect(due('good') < due('easy')).toBe(true);
	});

	it('drops a forgotten chunk down the ladder to relearn, due again tomorrow or after', () => {
		const known = reviewed(LEARNT, 'good', DAY_AFTER);
		const later = new Date(2026, 9, 25, 9, 0);
		const forgot = reviewed(known, 'again', later);
		expect(forgot).toMatchObject({ level: LAPSE_LEVEL, lapses: 1 });
		expect(forgot.due && forgot.due >= '2026-10-26').toBe(true);
		expect(isRelearning(forgot)).toBe(true);
		expect(isDue(forgot, '2026-12-31')).toBe(false);
	});

	it('never goes past the longest interval', () => {
		const sure = { ...LEARNT, stability: 3000, difficulty: 1, reps: 20 };
		const after = reviewed(sure, 'easy', DAY_AFTER, { retention: 0.85, maxInterval: 30 });
		expect(after.due && after.due <= '2026-11-13').toBe(true);
	});

	it('keeps what it does not know', () => {
		const after = reviewed({ ...LEARNT, misses: [0, 1], extra: { x: 1 } }, 'good', DAY_AFTER);
		expect(after).toMatchObject({ misses: [0, 1], extra: { x: 1 } });
	});
});

describe('recall', () => {
	it('falls as days pass, and is certain for a chunk not yet reviewed', () => {
		const known = reviewed(LEARNT, 'good', DAY_AFTER);
		const soon = recall(known, new Date(2026, 9, 15));
		const late = recall(known, new Date(2026, 11, 1));
		expect(soon).toBeGreaterThan(late ?? 1);
		expect(recall(LEARNT, DAY_AFTER)).toBe(1);
		expect(recall({ level: 2 }, DAY_AFTER)).toBeUndefined();
	});
});

describe('isDue', () => {
	it('is a learnt chunk whose day has come', () => {
		expect(isDue(LEARNT, '2026-10-13')).toBe(false);
		expect(isDue(LEARNT, '2026-10-14')).toBe(true);
		expect(isDue(LEARNT, '2026-11-01')).toBe(true);
		expect(isDue({ level: 5 }, '2026-11-01')).toBe(false);
		expect(isDue(undefined, '2026-11-01')).toBe(false);
	});
});
