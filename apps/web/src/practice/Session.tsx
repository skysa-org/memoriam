import {
	type ChunkProgress,
	fade,
	type Faded,
	type Grade,
	grade,
	hesitationThreshold,
	isTyped,
	LAPSE_LEVEL,
	learningPass,
	localDay,
	MAX_LEVEL,
	type PassSummary,
	QWERTY,
	reviewed,
	startTyping,
	summarize,
	type Typing,
	typing,
	type TypingEvent,
	type WordResult,
} from '@memoriam/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { type ReactNode, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { Icon } from '../components/Icon.js';
import { COARSE_POINTER, useMediaQuery } from '../components/layout.js';
import { useNotices } from '../components/Notices.js';
import { t } from '../i18n/t.js';
import { db } from '../store/db.js';
import { deviceId } from '../store/device.js';
import { recordPass, recordPractice, usualPace } from '../store/practice.js';
import { type Readied } from '../store/schedule.js';
import { type Settings } from '../store/settings.js';
import { ChunkView } from './ChunkView.js';
import { LetterCapture } from './LetterCapture.js';
import { chunkLines, contextBefore } from './plan.js';
import { linkAfter, type Pass, passAt, runsAfter, type Task, withRelearning } from './tasks.js';

/**
 * A session of practice, pass after pass as its tasks say (docs/ARCHITECTURE.md
 * §4, §5): a chunk learnt goes up the ladder until a clean pass at the top, and
 * is joined to the one before; a chunk reviewed is graded, and relearnt if it
 * was forgotten; and each section learnt in is run through at the end. One
 * input keeps the focus throughout, so a phone's keyboard stays up from Start
 * to the end. Each pass is recorded as it ends.
 */

type Learnt = Readonly<{ id: string; chunk: number }>;

interface Run {
	readonly pass?: Pass;
	readonly queue: readonly Task[];
	/** New chunks learnt this session, for the runs at its end. */
	readonly learnt: readonly Learnt[];
	readonly ranRuns: boolean;
	readonly reviewed: number;
	/** Runs through a section, and of those, runs without a miss. */
	readonly runs: number;
	readonly cleanRuns: number;
	/** Counts passes, so each is recorded once. */
	readonly count: number;
	readonly started: boolean;
}

export type Tally = Readonly<{
	learnt: number;
	reviewed: number;
	runs: number;
	cleanRuns: number;
}>;

const tallyOf = (run: Run): Tally => ({
	learnt: run.learnt.length,
	reviewed: run.reviewed,
	runs: run.runs,
	cleanRuns: run.cleanRuns,
});

type Action = TypingEvent | Readonly<{ type: 'start'; keys: readonly string[]; at: number }>;

type Found = Readonly<{ pass: Pass; rest: readonly Task[] }>;

/** The first task in `queue` there is a pass for, and those after it. */
const firstPass = (
	queue: readonly Task[],
	passages: ReadonlyMap<string, Readied>,
	from = 0
): Found | undefined => {
	const task = queue[from];
	if (task === undefined) return undefined;
	const owner = passages.get(task.id);
	const pass = owner && passAt(task, owner.chunked, owner.progress);
	return pass === undefined
		? firstPass(queue, passages, from + 1)
		: { pass, rest: queue.slice(from + 1) };
};

/** What comes of a learning pass. */
const nextStep = (
	faded: Faded,
	level: number,
	relearning: boolean
):
	| 'practice.learnt'
	| 'session.relearnt'
	| 'practice.harder'
	| 'practice.easier'
	| 'practice.again' => {
	if (faded.learnt) return relearning ? 'session.relearnt' : 'practice.learnt';
	if (faded.level > level) return 'practice.harder';
	return faded.level < level ? 'practice.easier' : 'practice.again';
};

const daysUntil = (due: string, today: string): number =>
	Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);

const WHERE = {
	learn: 'session.where.learn',
	relearn: 'session.where.relearn',
	review: 'session.where.review',
} as const;

/** What follows a pass: the same task again, or on with the queue. */
type After = Readonly<{ again: Pass }> | Readonly<{ queue: readonly Task[]; more: Partial<Run> }>;

const after = (
	pass: Pass,
	passage: Readied,
	ended: Readonly<{
		faded: Faded | undefined;
		graded: Grade | undefined;
		missed: readonly boolean[];
	}>,
	run: Run
): After | undefined => {
	const { task } = pass;
	if (task.kind === 'review') {
		// Forgotten: learnt again once the reviews still to come are done,
		// from where a lapse leaves it.
		const queue =
			ended.graded === 'again'
				? withRelearning(run.queue, {
						kind: 'relearn',
						id: task.id,
						chunk: task.chunk,
						level: LAPSE_LEVEL,
					})
				: run.queue;
		return { queue, more: { reviewed: run.reviewed + 1 } };
	}
	if (task.kind === 'run') {
		const clean = ended.missed.every((missed) => !missed);
		return {
			queue: run.queue,
			more: { runs: run.runs + 1, cleanRuns: run.cleanRuns + (clean ? 1 : 0) },
		};
	}
	if ('span' in task) return { queue: run.queue, more: {} };
	const { faded } = ended;
	if (faded === undefined) return undefined;
	if (!faded.learnt) {
		const history = [
			...pass.history,
			{ hidden: pass.shown.map((each) => each !== 'word'), missed: ended.missed },
		];
		const again = passAt(task, passage.chunked, passage.progress, history, faded.level);
		return again && { again };
	}
	if (task.kind === 'relearn') return { queue: run.queue, more: {} };
	const link = linkAfter(task.id, passage.chunked, passage.progress, task.chunk);
	return {
		queue: link === undefined ? run.queue : [link, ...run.queue],
		more: { learnt: [...run.learnt, { id: task.id, chunk: task.chunk }] },
	};
};

/** A pass that has ended, written down: its chunk's progress, if it has one, and the day's practice. */
const record = async (
	{
		task,
		passage,
		results,
		summary,
		graded,
		settings,
	}: Readonly<{
		task: Task;
		passage: Readied;
		results: readonly WordResult[];
		summary: PassSummary;
		graded: Grade | undefined;
		settings: Settings;
	}>,
	now: Date
): Promise<Readonly<{ progress?: ChunkProgress; problems: readonly string[] }>> => {
	const activity = {
		words: results.length,
		passes: 1,
		reviews: task.kind === 'review' ? 1 : 0,
		ms: results.reduce((sum, each) => sum + each.ms, 0),
	};
	const device = await deviceId(db);
	if ('span' in task) {
		const added = await recordPractice(db, { activity, device }, {}, now);
		return { problems: added ? [] : [t('practice.noActivity')] };
	}
	const clean = summary.missed === 0 && summary.hinted === 0;
	const result = await recordPass(
		db,
		{
			id: passage.id,
			key: passage.chunked.chunks[task.chunk]?.key ?? '',
			update: (before) =>
				task.kind === 'review' && before !== undefined
					? reviewed(before, graded ?? 'again', now, settings)
					: learningPass(before, results, now).progress,
			activity,
			device,
			...(clean && summary.medianMs !== undefined ? { pace: summary.medianMs } : {}),
		},
		{},
		now
	);
	if (!result.ok) return { problems: [t(`practice.unsaved.${result.reason}`)] };
	return {
		progress: result.progress,
		problems: result.activity ? [] : [t('practice.noActivity')],
	};
};

const keysOf = (passage: Readied | undefined, pass: Pass): string[] =>
	passage?.chunked.words.slice(pass.span.start, pass.span.end).map((word) => word.key) ?? [];

/** What the pass is, and how far the chunk has faded, if it is being learnt. */
const Where = ({ pass, parts }: Readonly<{ pass: Pass; parts: number }>) => {
	const { task } = pass;
	return (
		<p className="practice-where">
			<span>
				{'chunk' in task
					? t(WHERE[task.kind], { at: task.chunk + 1, count: parts })
					: t(`session.where.${task.kind}`)}
			</span>
			{(task.kind === 'learn' || task.kind === 'relearn') && (
				<span
					className="practice-level"
					role="img"
					aria-label={t('practice.level', { level: pass.level, top: MAX_LEVEL })}
				>
					{Array.from({ length: MAX_LEVEL + 1 }, (_, n) => (
						<span key={n} className={n <= pass.level ? 'reached' : undefined} />
					))}
				</span>
			)}
		</p>
	);
};

/** What came of a pass, and what comes next. */
const Outcome = ({
	pass,
	summary,
	faded,
	graded,
	due,
	onContinue,
}: Readonly<{
	pass: Pass;
	summary: PassSummary;
	faded: Faded | undefined;
	graded: Grade | undefined;
	/** The chunk's next review, once the pass is recorded. */
	due: string | undefined;
	onContinue: () => void;
}>) => {
	const { task } = pass;
	const learning = task.kind === 'learn' || task.kind === 'relearn';
	const review = task.kind === 'review';
	return (
		<div className="practice-outcome" role="status">
			<p>
				{t('practice.recalled', {
					recalled: summary.words - summary.missed,
					count: summary.words,
				})}
			</p>
			{learning && faded !== undefined && (
				<p className={faded.learnt ? 'practice-learnt' : undefined}>
					{faded.learnt && <Icon name="check" />}
					{t(nextStep(faded, pass.level, task.kind === 'relearn'))}
				</p>
			)}
			{review && graded === 'again' && <p>{t('session.forgot')}</p>}
			{review && graded !== 'again' && due !== undefined && (
				<p>{t('session.nextReview', { count: daysUntil(due, localDay(new Date())) })}</p>
			)}
			<button
				type="button"
				className="button primary"
				onPointerDown={(event) => {
					event.preventDefault();
				}}
				onClick={onContinue}
			>
				{t('practice.continue')}
			</button>
		</div>
	);
};

export const Session = ({
	tasks,
	passages,
	settings,
	stop,
	finished,
	onFinish,
}: Readonly<{
	/** What the session was given to do; read once, as it starts. */
	tasks: readonly Task[];
	/** Every passage a task may be in, live. */
	passages: ReadonlyMap<string, Readied>;
	settings: Settings;
	/** The way out, at the top of the screen. */
	stop: ReactNode;
	/** What is shown once every task is done. */
	finished: (tally: Tally) => ReactNode;
	/** Told once, as the last task is done. */
	onFinish?: (tally: Tally) => void;
}>) => {
	const [run, setRun] = useState<Run>(() => {
		const opening = firstPass(tasks, passages);
		return {
			...(opening === undefined ? {} : { pass: opening.pass }),
			queue: opening?.rest ?? [],
			learnt: [],
			ranRuns: false,
			reviewed: 0,
			runs: 0,
			cleanRuns: 0,
			count: 0,
			started: false,
		};
	});
	const pace = useLiveQuery(() => usualPace(db), []);
	const touch = useMediaQuery(COARSE_POINTER);
	const options = useMemo(
		() => ({
			hesitationMs: hesitationThreshold(pace),
			...(touch && settings.slips ? { neighbours: QWERTY } : {}),
		}),
		[pace, touch, settings.slips]
	);
	const [state, dispatch] = useReducer(
		(current: Typing, action: Action): Typing =>
			action.type === 'start'
				? startTyping(action.keys, action.at)
				: typing(current, action, options),
		startTyping([], 0)
	);
	const [saved, setSaved] = useState<Readonly<{ count: number; progress: ChunkProgress }>>();
	const input = useRef<HTMLInputElement>(null);
	const recorded = useRef(-1);
	const notices = useNotices();

	const { pass } = run;
	const passage = pass === undefined ? undefined : passages.get(pass.task.id);
	const done = run.started && state.keys.length > 0 && isTyped(state);
	const summary = useMemo(
		() => (done ? summarize(state.results) : undefined),
		[done, state.results]
	);
	const faded =
		summary === undefined || pass === undefined ? undefined : fade(pass.level, summary);
	const graded =
		summary === undefined
			? undefined
			: grade(summary, { review: true, ...(pace === undefined ? {} : { usualMs: pace }) });

	// The clock, for hints.
	useEffect(() => {
		if (!run.started || done) return undefined;
		const timer = window.setInterval(() => {
			dispatch({ type: 'tick', at: performance.now() });
		}, 250);
		return () => {
			window.clearInterval(timer);
		};
	}, [run.started, done]);

	// Each pass recorded as it ends, once.
	useEffect(() => {
		if (!done || pass === undefined || passage === undefined || summary === undefined) return;
		if (recorded.current === run.count) return;
		recorded.current = run.count;
		const count = run.count;
		const ended = {
			task: pass.task,
			passage,
			results: state.results,
			summary,
			graded,
			settings,
		};
		void record(ended, new Date()).then(({ progress, problems }) => {
			if (progress !== undefined) setSaved({ count, progress });
			problems.forEach((problem) => {
				notices.tell(problem);
			});
		});
	}, [done, pass, passage, summary, run.count, state.results, graded, settings, notices]);

	/** Start a pass: the input keeps the focus, and the clock starts. */
	const begin = (next: Pass, queue: readonly Task[], more: Partial<Run> = {}) => {
		input.current?.focus();
		setRun((current) => ({
			...current,
			...more,
			pass: next,
			queue,
			count: current.count + 1,
			started: true,
		}));
		dispatch({
			type: 'start',
			keys: keysOf(passages.get(next.task.id), next),
			at: performance.now(),
		});
	};

	/** On to the next task there is a pass for; then the runs; then the end. */
	const advance = (queue: readonly Task[], more: Partial<Run> = {}) => {
		const fromQueue = firstPass(queue, passages);
		const fromRuns =
			fromQueue !== undefined || run.ranRuns
				? undefined
				: firstPass(
						runsAfter(more.learnt ?? run.learnt, (id) => passages.get(id)?.chunked),
						passages
					);
		const found = fromQueue ?? fromRuns;
		const ranRuns = run.ranRuns || fromQueue === undefined;
		if (found === undefined) {
			const { pass: _, ...rest } = run;
			const ended = { ...rest, ...more, queue: [], ranRuns };
			setRun(ended);
			onFinish?.(tallyOf(ended));
			return;
		}
		begin(found.pass, found.rest, { ...more, ranRuns });
	};

	const proceed = () => {
		if (pass === undefined || passage === undefined || summary === undefined) return;
		const missed = state.results.map((result) => result.missed);
		const next = after(pass, passage, { faded, graded, missed }, run);
		if (next === undefined) return;
		if ('again' in next) {
			begin(next.again, run.queue);
			return;
		}
		advance(next.queue, next.more);
	};

	if (pass === undefined || passage === undefined) {
		return <>{finished(tallyOf(run))}</>;
	}

	const { chunked } = passage;
	const typed = run.started ? state : startTyping(keysOf(passage, pass), 0);

	return (
		<main className="screen practice">
			<header className="screen-header">
				{stop}
				<h1>{passage.title}</h1>
				<span className="practice-left">
					{t('session.left', { count: run.queue.length + 1 })}
				</span>
			</header>
			<Where pass={pass} parts={chunked.chunks.length} />
			<p className="practice-context">
				{contextBefore(chunked, pass.span.start, passage.title)}
			</p>
			<div className="practice-stage">
				<LetterCapture
					inputRef={input}
					label={t('practice.capture')}
					onKeys={(pressed, at) => {
						if (!run.started || done) return;
						pressed.forEach((key) => {
							dispatch({ type: 'key', key, at });
						});
					}}
					onEnter={() => {
						if (done) {
							proceed();
							return;
						}
						if (!run.started) begin(pass, run.queue);
					}}
				/>
				<ChunkView
					lines={chunkLines(chunked, pass.span)}
					start={pass.span.start}
					shown={pass.shown}
					typing={typed}
					label={t('practice.chunk')}
					onTap={() => {
						input.current?.focus();
					}}
				/>
			</div>
			{!run.started && (
				<div className="practice-actions">
					<p className="practice-hint">{t('practice.how')}</p>
					<button
						type="button"
						className="button primary"
						onClick={() => {
							begin(pass, run.queue);
						}}
					>
						{t('practice.start')}
					</button>
				</div>
			)}
			{run.started && !done && (
				<div className="practice-actions">
					<button
						type="button"
						className="button"
						onPointerDown={(event) => {
							event.preventDefault();
						}}
						onClick={() => {
							dispatch({ type: 'hint', at: performance.now() });
						}}
					>
						<Icon name="hint" />
						{t('practice.hint')}
					</button>
				</div>
			)}
			{summary !== undefined && (
				<Outcome
					pass={pass}
					summary={summary}
					faded={faded}
					graded={graded}
					due={saved?.count === run.count ? saved.progress.due : undefined}
					onContinue={proceed}
				/>
			)}
		</main>
	);
};
