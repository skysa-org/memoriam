import { z } from 'zod';

import {
	frontmatterIsEditable,
	type ProgressBlock,
	readFrontmatter,
	splitFrontmatter,
} from '../markdown/frontmatter.js';
import { serializePassageFile } from '../markdown/passage.js';
import { readTime } from '../markdown/time.js';

/**
 * A passage's progress, as its frontmatter keeps it (docs/ARCHITECTURE.md §3):
 * one entry under `progress:` for each chunk, keyed by the chunk's key, holding
 * how far it has faded and, once it has graduated, its schedule.
 *
 * ```yaml
 * progress:
 *   k3fq9ma: { level: 5, due: 2026-10-20, stability: 6.21, difficulty: 4.1, reps: 3, lapses: 0, reviewed: 2026-10-13T14:03:02Z, misses: "0,0,2,0,1" }
 *   p8dz2ve: { level: 3, reviewed: 2026-10-13T14:05:00Z }
 * ```
 *
 * Reading is lenient, because the file is the user's and any tool may have
 * been at it. A field that is not what this app writes is passed over, and the
 * next pass writes it afresh; a field this app does not know, which a newer
 * build may have written, is kept as it was; an entry that is not a mapping at
 * all is no progress this app can read, and is kept too, as it was.
 */

/** The highest fade level: every word hidden, nothing but a line of context (§4). */
export const MAX_LEVEL = 5;

/** What is known of one chunk. */
export interface ChunkProgress {
	/** How far the chunk has faded: 0, every word shown, to `MAX_LEVEL`. */
	readonly level: number;
	/** The day the chunk is next due, `YYYY-MM-DD`, once it has graduated. */
	readonly due?: string;
	/** FSRS stability, in days. */
	readonly stability?: number;
	/** FSRS difficulty, 1 to 10. */
	readonly difficulty?: number;
	/** Reviews since the chunk graduated. */
	readonly reps?: number;
	/** Reviews it was forgotten at. */
	readonly lapses?: number;
	/** When it was last practised, an ISO instant. */
	readonly reviewed?: string;
	/** Misses for each of its words, in order. */
	readonly misses?: readonly number[];
	/** Fields this build does not know, kept as the file had them. */
	readonly extra?: Readonly<Record<string, unknown>>;
}

/** A passage's progress, read out of its frontmatter. */
export interface Progress {
	/** Each chunk's progress by its key, in the order the file had them. */
	readonly chunks: ReadonlyMap<string, ChunkProgress>;
	/** Entries that are not a mapping, kept as they were. */
	readonly opaque: Readonly<Record<string, unknown>>;
}

export const NO_PROGRESS: Progress = { chunks: new Map(), opaque: {} };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MISSES = /^\d+(?:,\d+)*$/;

/** A field that is not what this app writes is read as absent. */
const lenient = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

const ENTRY = z.looseObject({
	level: z.number().int().min(0).max(MAX_LEVEL).catch(0),
	due: lenient(
		z
			.string()
			.regex(DAY)
			.refine((day) => readTime(day) !== undefined)
	),
	stability: lenient(z.number().positive()),
	difficulty: lenient(z.number().min(1).max(10)),
	reps: lenient(z.number().int().nonnegative()),
	lapses: lenient(z.number().int().nonnegative()),
	reviewed: lenient(z.string().refine((instant) => readTime(instant) !== undefined)),
	misses: lenient(z.string().regex(MISSES)),
});

/** The fields this build knows, in the order an entry is written. */
const FIELDS = [
	'level',
	'due',
	'stability',
	'difficulty',
	'reps',
	'lapses',
	'reviewed',
	'misses',
] as const;

const isField = (key: string): boolean => FIELDS.some((field) => field === key);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Drop keys whose value is undefined, so an absent field is not written as `null`. */
const defined = <T extends object>(value: T): T =>
	Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

const readEntry = (raw: Readonly<Record<string, unknown>>): ChunkProgress => {
	const { level, due, stability, difficulty, reps, lapses, reviewed, misses } = ENTRY.parse(raw);
	const extra = Object.fromEntries(Object.entries(raw).filter(([key]) => !isField(key)));
	return {
		...defined({ due, stability, difficulty, reps, lapses, reviewed }),
		level,
		...(misses === undefined ? {} : { misses: misses.split(',').map(Number) }),
		...(Object.keys(extra).length === 0 ? {} : { extra }),
	};
};

/** Read the `progress` mapping a passage's frontmatter holds (`readFrontmatter`). */
export const readProgress = (block: ProgressBlock | undefined): Progress => {
	const entries = Object.entries(block ?? {});
	return {
		chunks: new Map(
			entries.flatMap(([key, raw]) => (isRecord(raw) ? [[key, readEntry(raw)] as const] : []))
		),
		opaque: Object.fromEntries(entries.filter(([, raw]) => !isRecord(raw))),
	};
};

/**
 * Rounded to two places, and the rounded value is the truth: what the file
 * says is what the next read sees, so nothing depends on digits it dropped.
 */
const rounded = (value: number | undefined): number | undefined =>
	value === undefined ? undefined : Math.round(value * 100) / 100;

const entryBlock = (chunk: ChunkProgress): Record<string, unknown> =>
	defined({
		level: chunk.level,
		due: chunk.due,
		stability: rounded(chunk.stability),
		difficulty: rounded(chunk.difficulty),
		reps: chunk.reps,
		lapses: chunk.lapses,
		reviewed: chunk.reviewed,
		misses:
			chunk.misses === undefined || chunk.misses.length === 0
				? undefined
				: chunk.misses.join(','),
		...Object.fromEntries(Object.entries(chunk.extra ?? {}).filter(([key]) => !isField(key))),
	});

/**
 * The `progress` mapping to write: the chunks named in `order` first, in that
 * order, which is the passage's (§3, "Frontmatter details"); then any chunk it
 * does not name, as they came; then the entries no chunk could be read from.
 */
export const progressBlock = (progress: Progress, order: readonly string[] = []): ProgressBlock => {
	const named = order.filter((key) => progress.chunks.has(key));
	const rest = [...progress.chunks.keys()].filter((key) => !named.includes(key));
	return Object.fromEntries([
		...[...named, ...rest].flatMap((key) => {
			const chunk = progress.chunks.get(key);
			return chunk === undefined ? [] : [[key, entryBlock(chunk)] as const];
		}),
		...Object.entries(progress.opaque),
	]);
};

/** Why a passage's progress could not be written. */
export type ProgressRefusal =
	/** The frontmatter is YAML the parser had to repair, which the app never rewrites. */
	| 'unreadable'
	/** It reads, but the writer would not change it: an anchor or alias holds `progress`. */
	| 'refused';

export type ProgressWrite =
	Readonly<{ ok: true; text: string }> | Readonly<{ ok: false; reason: ProgressRefusal }>;

/**
 * `text`, a passage's whole file, with `progress` as its progress and every
 * other byte as it was: not `updated`, which says when the passage was last
 * edited and a pass does not edit it, and not a key or comment the app does not
 * know.
 *
 * A write that cannot be made is said, never dropped: the caller tells the
 * user, rather than letting a pass vanish and the next one start from where
 * this one did (§3, "Writes").
 */
export const writeProgress = (
	text: string,
	progress: Progress,
	order: readonly string[] = []
): ProgressWrite => {
	const { frontmatter, body } = splitFrontmatter(text);
	if (!frontmatterIsEditable(frontmatter)) return { ok: false, reason: 'unreadable' };

	const block = progressBlock(progress, order);
	const value = Object.keys(block).length === 0 ? undefined : block;
	const written = serializePassageFile({ frontmatter, body, metadata: { progress: value } });
	const back = readFrontmatter(splitFrontmatter(written).frontmatter).progress;
	return JSON.stringify(back) === JSON.stringify(value)
		? { ok: true, text: written }
		: { ok: false, reason: 'refused' };
};
