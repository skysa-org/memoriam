import { Document, isMap, isScalar, parseDocument, type YAMLMap } from 'yaml';

import { APP_DATA_FOLDER, PASSAGE_EXTENSION } from '../config.js';
import {
	frontmatterIsEditable,
	joinFrontmatter,
	splitFrontmatter,
} from '../markdown/frontmatter.js';
import { joinPath } from '../paths.js';

/**
 * A year's practice, in `.memoriam/activity-YYYY.md` (docs/ARCHITECTURE.md §3):
 *
 * ```yaml
 * days:
 *   2026-10-13~k3fq9mab: { words: 120, passes: 9, reviews: 4, ms: 312000 }
 * badges:
 *   first-learnt: 2026-10-13
 * ```
 *
 * A day is keyed by the date and the device that practised, so each key has
 * one writer and two devices' files merge exactly (§10). The file is the
 * app's own, so it is rewritten whole through `yaml`, which keeps keys and
 * comments it does not know; but a value under `days` the app cannot read as a
 * mapping is never written over.
 */

/** A day's practice on one device. */
export interface DayActivity {
	/** Words typed. */
	readonly words: number;
	/** Passes finished, learning or review. */
	readonly passes: number;
	/** Chunks reviewed. */
	readonly reviews: number;
	/** Time spent typing. */
	readonly ms: number;
}

export interface Activity {
	readonly days: ReadonlyMap<string, DayActivity>;
	/** Each badge earned, and the day it was. */
	readonly badges: ReadonlyMap<string, string>;
}

export const NO_DAY: DayActivity = { words: 0, passes: 0, reviews: 0, ms: 0 };

const DAY_FIELDS = ['words', 'passes', 'reviews', 'ms'] as const;

/** Where a year's activity is kept. */
export const activityPath = (year: number): string =>
	joinPath(APP_DATA_FOLDER, `activity-${String(year)}${PASSAGE_EXTENSION}`);

/** A day's key: its date and the device. */
export const dayKey = (day: string, device: string): string => `${day}~${device}`;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const count = (value: unknown): number =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const dayOf = (value: unknown): DayActivity | undefined =>
	isRecord(value)
		? {
				words: count(value.words),
				passes: count(value.passes),
				reviews: count(value.reviews),
				ms: count(value.ms),
			}
		: undefined;

/** A file's activity, read leniently: what is not a count is none. */
export const readActivity = (text: string): Activity => {
	const { frontmatter } = splitFrontmatter(text);
	const doc = frontmatter === null ? undefined : parseDocument(frontmatter);
	const record: unknown = doc === undefined || doc.errors.length > 0 ? undefined : doc.toJS();
	const days = isRecord(record) && isRecord(record.days) ? record.days : {};
	const badges = isRecord(record) && isRecord(record.badges) ? record.badges : {};
	return {
		days: new Map(
			Object.entries(days).flatMap(([key, value]) => {
				const day = dayOf(value);
				return day === undefined ? [] : [[key, day] as const];
			})
		),
		badges: new Map(
			Object.entries(badges).flatMap(([key, value]) =>
				typeof value === 'string' ? [[key, value] as const] : []
			)
		),
	};
};

export type ActivityWrite =
	| Readonly<{ ok: true; text: string }>
	/** YAML that does not parse, or a `days` that is not a mapping: left as it is. */
	| Readonly<{ ok: false; reason: 'unreadable' }>;

const added = (before: DayActivity, more: DayActivity): DayActivity => ({
	words: before.words + more.words,
	passes: before.passes + more.passes,
	reviews: before.reviews + more.reviews,
	ms: Math.round(before.ms + more.ms),
});

/** The `days` mapping, made if there is none; `undefined` where it is something else. */
const daysOf = (doc: Document): YAMLMap | undefined => {
	const days = doc.get('days', true);
	if (days === undefined || (isScalar(days) && days.value === null)) {
		const made = doc.createNode({});
		doc.set('days', made);
		return made;
	}
	return isMap(days) ? days : undefined;
};

/** `text` with `more` added to the day `key`, or a new file for none. */
export const addToDay = (
	text: string | undefined,
	key: string,
	more: DayActivity
): ActivityWrite => {
	const { frontmatter, body } = splitFrontmatter(text ?? '');
	// A file that opens a block the reader could not close is a block gone
	// wrong, not a body: a new one written above it would leave two.
	const opened = frontmatter === null && /^---\r?\n/.test(text ?? '');
	if (opened || (frontmatter !== null && !frontmatterIsEditable(frontmatter))) {
		return { ok: false, reason: 'unreadable' };
	}
	const doc =
		frontmatter === null || frontmatter.trim() === ''
			? new Document({})
			: parseDocument(frontmatter);
	if (!isMap(doc.contents)) return { ok: false, reason: 'unreadable' };
	const days = daysOf(doc);
	if (days === undefined) return { ok: false, reason: 'unreadable' };
	const before = days.get(key, true);
	if (before !== undefined && !isMap(before)) return { ok: false, reason: 'unreadable' };
	const was = dayOf(isMap(before) ? before.toJSON() : undefined) ?? NO_DAY;
	const now = added(was, more);
	const node = doc.createNode(Object.fromEntries(DAY_FIELDS.map((field) => [field, now[field]])));
	// One line a day, as a passage's progress is one line a chunk.
	// eslint-disable-next-line functional/immutable-data -- a node made here, set before it is used
	node.flow = true;
	days.set(key, node);
	return { ok: true, text: joinFrontmatter(doc.toString({ lineWidth: 0 }), body) };
};
