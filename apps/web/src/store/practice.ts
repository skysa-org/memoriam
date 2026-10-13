import {
	activityPath,
	type ActivityWrite,
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

import { isLive, LOCAL_CONNECTION_ID, type MemoriamDatabase, writerTables } from './db.js';
import { rowFor } from './passages.js';
import { getPreference } from './prefs.js';
import { queuePracticeWrite } from './queue.js';

/**
 * Practice, as the store keeps it: a pass's progress written into its
 * passage's frontmatter, and the day's practice into the year's activity file
 * (docs/ARCHITECTURE.md §3, §7 "Recording a pass").
 *
 * One transaction, which reads the file as it is now and changes only the
 * chunk practised: two tabs practising one passage each write their own chunk
 * over the other's, never over its whole progress. The write that sends it is
 * queued in the same transaction; when it goes is the scheduler's to say.
 */

export interface PassRecord {
	/** The passage. */
	readonly id: string;
	/** The chunk practised, by the key it had when the pass began. */
	readonly key: string;
	/** Its progress after the pass, from what the file has for it now. */
	readonly update: (before: ChunkProgress | undefined) => ChunkProgress;
	/**
	 * What the pass adds to today's practice. Whether it began a chunk, and
	 * so counts against the day's new words, is read from the file.
	 */
	readonly activity: Omit<DayActivity, 'started'>;
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

/**
 * Change this year's activity file, made if there is none; false where it
 * cannot be read, and is left as it was. Run it inside a transaction on
 * `notes`, so it changes the file as it is when the write is made.
 */
export const changeActivity = async (
	db: MemoriamDatabase,
	connectionId: string,
	now: Date,
	change: (text: string | undefined) => ActivityWrite
): Promise<boolean> => {
	const path = activityPath(now.getFullYear());
	const row = await db.notes
		.where('[connectionId+path]')
		.equals([connectionId, path])
		.filter(isLive)
		.first();
	const written = change(row?.source);
	if (!written.ok) return false;
	if (written.text === row?.source) return true;
	const at = now.getTime();
	const next = rowFor(
		{
			id: row?.id ?? `activity-${String(now.getFullYear())}`,
			connectionId,
			path,
			source: written.text,
			createdAt: row?.createdAt ?? at,
			updatedAt: at,
		},
		row
	);
	await db.notes.put(next);
	await queuePracticeWrite(db, next);
	return true;
};

/** Add to today's line in the year's activity file; false where it cannot be read. */
const addActivity = (
	db: MemoriamDatabase,
	{ connectionId, device }: Readonly<{ connectionId: string; device: string }>,
	activity: DayActivity,
	now: Date
): Promise<boolean> =>
	changeActivity(db, connectionId, now, (text) =>
		addToDay(text, dayKey(localDay(now), device), activity)
	);

/**
 * Record practice that is no one chunk's: a link pass, a run through a
 * section. Only the day's practice is added to.
 */
export const recordPractice = (
	db: MemoriamDatabase,
	{ activity, device }: Readonly<{ activity: Omit<DayActivity, 'started'>; device: string }>,
	{ connectionId = LOCAL_CONNECTION_ID }: Readonly<{ connectionId?: string }> = {},
	now: Date = new Date()
): Promise<boolean> =>
	db.transaction('rw', writerTables(db), () =>
		addActivity(db, { connectionId, device }, { ...activity, started: 0 }, now)
	);

/** Record a pass: its chunk's progress, and the day's practice. */
export const recordPass = (
	db: MemoriamDatabase,
	pass: PassRecord,
	{ connectionId = LOCAL_CONNECTION_ID }: Readonly<{ connectionId?: string }> = {},
	now: Date = new Date()
): Promise<Recorded> =>
	db.transaction('rw', [...writerTables(db), db.prefs], async () => {
		const row = await db.notes.get([connectionId, pass.id]);
		if (row === undefined || !isLive(row)) return { ok: false, reason: 'missing' } as const;

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
		const before = progress.chunks.get(pass.key);
		const practised = pass.update(before);
		const written = writeProgress(
			row.source,
			{ ...progress, chunks: new Map(progress.chunks).set(pass.key, practised) },
			chunks.map((chunk) => chunk.key)
		);
		if (!written.ok) return written;
		const practisedRow = { ...row, source: written.text, dirty: 1 as const };
		await db.notes.put(practisedRow);
		await queuePracticeWrite(db, practisedRow);

		const chunk = chunks.find((each) => each.key === pass.key);
		const started = before === undefined && chunk !== undefined ? chunk.end - chunk.start : 0;
		const activity = await addActivity(
			db,
			{ connectionId, device: pass.device },
			{ ...pass.activity, started },
			now
		);
		if (pass.pace !== undefined) await notePace(db, pass.pace);
		return { ok: true, progress: practised, activity } as const;
	});
