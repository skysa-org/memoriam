import {
	activityPath,
	addToDay,
	chunkPassage,
	type ChunkProgress,
	CURRENT_CHUNKER,
	type DayActivity,
	dayKey,
	fillGaps,
	localDay,
	parsePassageFile,
	readProgress,
	writeProgress,
} from '@memoriam/core';

import { LOCAL_CONNECTION_ID, type MemoriamDatabase, type NoteRecord } from './db.js';
import { rowFor } from './passages.js';
import { getPreference } from './prefs.js';

/**
 * Practice, as the store keeps it: a pass's progress written into its
 * passage's frontmatter, and the day's practice into the year's activity file
 * (docs/ARCHITECTURE.md §3, §7 "Recording a pass").
 *
 * One transaction, which reads the file as it is now and changes only the
 * chunk practised: two tabs practising one passage each write their own chunk
 * over the other's, never over its whole progress.
 */

export interface PassRecord {
	/** The passage. */
	readonly id: string;
	/** The chunk practised, by the key it had when the pass began. */
	readonly key: string;
	/** Its progress after the pass, from what the file has for it now. */
	readonly update: (before: ChunkProgress | undefined) => ChunkProgress;
	/** What the pass adds to today's practice. */
	readonly activity: DayActivity;
	/** This device's name for itself (`deviceId`). */
	readonly device: string;
	/** The pass's median time per word, if it was clean: the typist's pace. */
	readonly pace?: number;
}

export type Recorded =
	/** `activity` is false where the activity file could not be added to. */
	| Readonly<{ ok: true; progress: ChunkProgress; activity: boolean }>
	/** No passage by that id: deleted, maybe in another tab. */
	| Readonly<{ ok: false; reason: 'missing' }>
	/** Its words changed meanwhile, and the chunk is no longer one of its own. */
	| Readonly<{ ok: false; reason: 'changed' }>
	/** Its frontmatter is YAML the app does not rewrite, or will not take apart. */
	| Readonly<{ ok: false; reason: 'unreadable' | 'refused' }>;

export const PACE_KEY = 'practice.pace';

/** How much one clean pass moves the typist's pace. */
const PACE_WEIGHT = 0.2;

/**
 * The typist's usual time per word on this device, in milliseconds: what a
 * hesitation and an Easy grade are measured against (§4, §5). None until a
 * clean pass has been typed here.
 */
export const usualPace = async (db: MemoriamDatabase): Promise<number | undefined> => {
	const kept = Number(await getPreference(db, PACE_KEY));
	return Number.isFinite(kept) && kept > 0 ? kept : undefined;
};

const notePace = async (db: MemoriamDatabase, pace: number): Promise<void> => {
	const before = await usualPace(db);
	const next = before === undefined ? pace : before + PACE_WEIGHT * (pace - before);
	await db.prefs.put({ key: PACE_KEY, value: String(Math.round(next)) });
};

/** The year's activity file with the pass added, or `undefined` where it cannot be. */
const activityRow = (
	row: NoteRecord | undefined,
	{ activity, device }: PassRecord,
	connectionId: string,
	now: Date
): NoteRecord | undefined => {
	const day = localDay(now);
	const written = addToDay(row?.source, dayKey(day, device), activity);
	if (!written.ok) return undefined;
	const at = now.getTime();
	return rowFor({
		id: row?.id ?? `activity-${day.slice(0, 4)}`,
		connectionId,
		path: row?.path ?? activityPath(now.getFullYear()),
		source: written.text,
		createdAt: row?.createdAt ?? at,
		updatedAt: at,
	});
};

/** Record a pass: its chunk's progress, and the day's practice. */
export const recordPass = (
	db: MemoriamDatabase,
	pass: PassRecord,
	{ connectionId = LOCAL_CONNECTION_ID }: Readonly<{ connectionId?: string }> = {},
	now: Date = new Date()
): Promise<Recorded> =>
	db.transaction('rw', db.notes, db.prefs, async () => {
		const row = await db.notes.get([connectionId, pass.id]);
		if (row === undefined) return { ok: false, reason: 'missing' } as const;

		const parsed = parsePassageFile(row.source);
		const chunked = chunkPassage(parsed.body, parsed.chunker ?? CURRENT_CHUNKER);
		const chunks = chunked?.chunks ?? [];
		if (!chunks.some((chunk) => chunk.key === pass.key)) {
			return { ok: false, reason: 'changed' } as const;
		}
		// Keys another tool left behind are put right first, so the write that
		// adds this pass does not drop what they hold.
		const progress = fillGaps(
			chunks.map((chunk) => ({ key: chunk.key, words: chunk.end - chunk.start })),
			readProgress(parsed.progress)
		);
		const practised = pass.update(progress.chunks.get(pass.key));
		const written = writeProgress(
			row.source,
			{ ...progress, chunks: new Map(progress.chunks).set(pass.key, practised) },
			chunks.map((chunk) => chunk.key)
		);
		if (!written.ok) return written;
		await db.notes.put({ ...row, source: written.text, dirty: 1 });

		const path = activityPath(now.getFullYear());
		const year = await db.notes
			.where('[connectionId+path]')
			.equals([connectionId, path])
			.first();
		const activity = activityRow(year, pass, connectionId, now);
		if (activity !== undefined) await db.notes.put(activity);
		if (pass.pace !== undefined) await notePace(db, pass.pace);
		return { ok: true, progress: practised, activity: activity !== undefined } as const;
	});
