import {
	type ChunkedPassage,
	hideWords,
	isLearnt,
	linkSpan,
	MAX_LEVEL,
	type PastPass,
	type Progress,
	RUN_WORDS,
	runSpan,
	type Shown,
	type Span,
	type Step,
} from '@memoriam/core';

/**
 * A session, as the passes it is made of (docs/ARCHITECTURE.md §5, "A day's
 * session"): what the plan says, then what the session itself adds as it goes
 * — a link pass after each new chunk, relearning after a chunk forgotten, and
 * a run through each section learnt in at the end.
 */

export type Task =
	/**
	 * A chunk up the ladder, pass after pass, until a clean pass at the top;
	 * from `level`, where the session knows better than the file yet does.
	 */
	| Readonly<{ kind: 'learn' | 'relearn'; id: string; chunk: number; level?: number }>
	/** One pass over a learnt chunk, bare, graded for the scheduler. */
	| Readonly<{ kind: 'review'; id: string; chunk: number }>
	/** One pass over words that are no single chunk: practice, not graded. */
	| Readonly<{ kind: 'link' | 'run'; id: string; span: Span }>;

/** The plan's steps, a review of several chunks a task for each. */
export const tasksOf = (steps: readonly Step[]): Task[] =>
	steps.flatMap((step): Task[] =>
		step.kind === 'review'
			? step.chunks.map((chunk) => ({ kind: 'review', id: step.id, chunk }))
			: [step]
	);

/** Where a task's words are in its passage. */
export const spanOf = (task: Task, chunked: ChunkedPassage): Span | undefined =>
	'span' in task ? task.span : chunked.chunks[task.chunk];

/** A chunk forgotten at review, relearnt once the reviews still to come are done. */
export const withRelearning = (queue: readonly Task[], task: Task): Task[] => {
	const after = queue.findIndex((each) => each.kind !== 'review');
	return after === -1
		? [...queue, task]
		: [...queue.slice(0, after), task, ...queue.slice(after)];
};

/**
 * The link pass after a chunk is learnt, if the chunk before it in its section
 * is learnt too: the seam between them, practised once.
 */
export const linkAfter = (
	id: string,
	chunked: ChunkedPassage,
	progress: Progress,
	chunk: number
): Task | undefined => {
	const before = chunked.chunks[chunk - 1];
	const span = linkSpan(chunked, chunk);
	if (span === undefined || !isLearnt(progress.chunks.get(before?.key ?? ''))) return undefined;
	return { kind: 'link', id, span };
};

/**
 * Runs through each section a chunk was learnt in this session, up to the
 * last chunk learnt there; none where that would be the chunk alone.
 */
export const runsAfter = (
	learnt: readonly Readonly<{ id: string; chunk: number }>[],
	chunkedOf: (id: string) => ChunkedPassage | undefined
): Task[] => {
	const last = learnt.reduce<ReadonlyMap<string, Readonly<{ id: string; chunk: number }>>>(
		(found, each) => {
			const section = chunkedOf(each.id)?.chunks[each.chunk]?.section;
			const key = `${each.id}#${String(section)}`;
			const kept = found.get(key);
			return kept !== undefined && kept.chunk >= each.chunk
				? found
				: new Map(found).set(key, each);
		},
		new Map()
	);
	return [...last.values()].flatMap(({ id, chunk }): Task[] => {
		const chunked = chunkedOf(id);
		const own = chunked?.chunks[chunk];
		const span = chunked === undefined ? undefined : runSpan(chunked, chunk);
		if (span === undefined || own === undefined || span.start === own.start) return [];
		return [{ kind: 'run', id, span }];
	});
};

/** A whole passage as runs, section by section, each no longer than a run goes. */
export const runThrough = (id: string, chunked: ChunkedPassage, window = RUN_WORDS): Task[] =>
	chunked.chunks
		.reduce<Span[]>((spans, chunk, at) => {
			const open = spans.at(-1);
			const sameSection = chunked.chunks[at - 1]?.section === chunk.section;
			if (open !== undefined && sameSection && chunk.end - open.start <= window) {
				return [...spans.slice(0, -1), { start: open.start, end: chunk.end }];
			}
			return [...spans, { start: chunk.start, end: chunk.end }];
		}, [])
		.map((span) => ({ kind: 'run', id, span }));

/** A pass over a task's words: how far they have faded, and which are hidden. */
export interface Pass {
	readonly task: Task;
	readonly span: Span;
	readonly level: number;
	/** This session's passes over the task, for which words take their turn. */
	readonly history: readonly PastPass[];
	readonly shown: readonly Shown[];
}

const seed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

/** The next pass at a task: at `level`, or the chunk's own; bare, for all but learning. */
export const passAt = (
	task: Task,
	chunked: ChunkedPassage,
	progress: Progress,
	history: readonly PastPass[] = [],
	level?: number
): Pass | undefined => {
	const span = spanOf(task, chunked);
	if (span === undefined) return undefined;
	const count = span.end - span.start;
	if (task.kind !== 'learn' && task.kind !== 'relearn') {
		return {
			task,
			span,
			level: MAX_LEVEL,
			history,
			shown: hideWords(count, { level: MAX_LEVEL, seed: 0, history: [] }),
		};
	}
	const entry = progress.chunks.get(chunked.chunks[task.chunk]?.key ?? '');
	const at = level ?? task.level ?? entry?.level ?? 0;
	return {
		task,
		span,
		level: at,
		history,
		shown: hideWords(count, { level: at, seed: seed(), history, misses: entry?.misses ?? [] }),
	};
};
