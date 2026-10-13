import {
	activityPath,
	type ChunkedPassage,
	chunkPassage,
	CURRENT_CHUNKER,
	fillGaps,
	isHidden,
	localDay,
	parsePassageFile,
	planDay,
	type PlanPassage,
	type Progress,
	readActivity,
	readProgress,
	type Step,
} from '@memoriam/core';
import { useLiveQuery } from 'dexie-react-hooks';

import {
	db as defaultDb,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
} from './db.js';
import { readSettings, type Settings } from './settings.js';

/**
 * The day's practice, worked out from the passages themselves each time they
 * change (docs/ARCHITECTURE.md §5): every passage read, cut into chunks, and
 * its progress laid against them. No table of cards is kept beside the files
 * yet; a library would have to be large for this to be slow.
 */

/** A passage as practice reads it. */
export interface Readied extends PlanPassage {
	readonly title: string;
}

/** A passage's chunks and progress; none for one cut by a chunker this build does not have. */
export const readied = (row: NoteRecord): Readied | undefined => {
	const parsed = parsePassageFile(row.source);
	const chunked: ChunkedPassage | undefined = chunkPassage(
		parsed.body,
		parsed.chunker ?? CURRENT_CHUNKER
	);
	if (chunked === undefined) return undefined;
	const progress: Progress = fillGaps(
		chunked.chunks.map((chunk) => ({ key: chunk.key, words: chunk.end - chunk.start })),
		readProgress(parsed.progress)
	);
	return { id: row.id, title: row.title, chunked, progress, createdAt: row.createdAt };
};

/** Words of new chunks begun on `today`, on every device. */
export const startedOn = (rows: readonly NoteRecord[], today: string): number => {
	const year = rows.find((row) => row.path === activityPath(Number(today.slice(0, 4))));
	if (year === undefined) return 0;
	return [...readActivity(year.source).days]
		.filter(([key]) => key.startsWith(`${today}~`))
		.reduce((sum, [, day]) => sum + day.started, 0);
};

export interface DayPlan {
	readonly steps: readonly Step[];
	readonly passages: ReadonlyMap<string, Readied>;
	readonly settings: Settings;
	readonly today: string;
	/** Words of new chunks begun today already. */
	readonly startedToday: number;
}

export const planFor = (rows: readonly NoteRecord[], settings: Settings, now: Date): DayPlan => {
	const today = localDay(now);
	const passages = rows
		.filter((row) => !isHidden(row.path))
		.flatMap((row) => {
			const ready = readied(row);
			return ready === undefined ? [] : [ready];
		});
	const startedToday = startedOn(rows, today);
	return {
		steps: planDay(passages, { now, today, newWords: settings.newWords, startedToday }),
		passages: new Map(passages.map((passage) => [passage.id, passage])),
		settings,
		today,
		startedToday,
	};
};

/** What a day's plan holds: chunks to review or learn again, and words to learn. */
export const planCounts = ({
	steps,
	passages,
}: Pick<DayPlan, 'steps' | 'passages'>): Readonly<{ reviews: number; newWords: number }> =>
	steps.reduce(
		(counts, step) => {
			if (step.kind === 'review') {
				return { ...counts, reviews: counts.reviews + step.chunks.length };
			}
			if (step.kind === 'relearn') return { ...counts, reviews: counts.reviews + 1 };
			const chunk = passages.get(step.id)?.chunked.chunks[step.chunk];
			const words = chunk === undefined ? 0 : chunk.end - chunk.start;
			return { ...counts, newWords: counts.newWords + words };
		},
		{ reviews: 0, newWords: 0 }
	);

/** The day's plan, live. */
export const useDayPlan = (
	now: Date = new Date(),
	db: MemoriamDatabase = defaultDb,
	connectionId: string = LOCAL_CONNECTION_ID
): DayPlan | undefined => {
	const day = localDay(now);
	return useLiveQuery(
		async () => {
			const rows = await db.notes.where('connectionId').equals(connectionId).toArray();
			return planFor(rows, await readSettings(db), new Date());
		},
		// The day, so a page left open past midnight plans the new one.
		[db, connectionId, day]
	);
};
