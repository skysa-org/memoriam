import {
	type ChunkedPassage,
	chunkPassage,
	CURRENT_CHUNKER,
	fade,
	type Faded,
	fillGaps,
	hesitationThreshold,
	hideWords,
	isTyped,
	learningPass,
	MAX_LEVEL,
	parsePassageFile,
	type PastPass,
	type Progress,
	QWERTY,
	readProgress,
	type Shown,
	startTyping,
	summarize,
	type Typing,
	typing,
	type TypingEvent,
	type WordResult,
} from '@memoriam/core';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { Icon } from '../components/Icon.js';
import { COARSE_POINTER, useMediaQuery } from '../components/layout.js';
import { useNotices } from '../components/Notices.js';
import { t } from '../i18n/t.js';
import { db, type NoteRecord } from '../store/db.js';
import { deviceId } from '../store/device.js';
import { recordPass, usualPace } from '../store/practice.js';
import { ChunkView } from './ChunkView.js';
import { LetterCapture } from './LetterCapture.js';
import { chunkLines, contextFor, nextToLearn } from './plan.js';

/**
 * Learning a passage, chunk by chunk, up the fade ladder (docs/ARCHITECTURE.md
 * §4): a pass at the chunk's level, what came of it, and the next, until a
 * clean pass at the top learns the chunk and the next one not yet learnt
 * begins. Each pass is recorded as it ends.
 */

interface Session {
	/** The chunk being learnt, by its place in the passage. */
	readonly at: number;
	readonly level: number;
	/** This session's passes over the chunk. */
	readonly history: readonly PastPass[];
	readonly shown: readonly Shown[];
	/** Counts passes, so each is recorded once. */
	readonly pass: number;
	readonly started: boolean;
}

type Action = TypingEvent | Readonly<{ type: 'start'; keys: readonly string[]; at: number }>;

const seed = (): number => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

const read = (source: string) => {
	const parsed = parsePassageFile(source);
	const chunked = chunkPassage(parsed.body, parsed.chunker ?? CURRENT_CHUNKER);
	const progress =
		chunked === undefined
			? readProgress(parsed.progress)
			: fillGaps(
					chunked.chunks.map((chunk) => ({
						key: chunk.key,
						words: chunk.end - chunk.start,
					})),
					readProgress(parsed.progress)
				);
	return { chunked, progress };
};

/** A session at chunk `at`, its first pass ready to start. */
const sessionAt = (
	chunked: ChunkedPassage,
	progress: Progress,
	at: number,
	pass: number
): Session => {
	const chunk = chunked.chunks[at];
	const known = progress.chunks.get(chunk?.key ?? '');
	const level = known?.level ?? 0;
	const count = chunk === undefined ? 0 : chunk.end - chunk.start;
	return {
		at,
		level,
		history: [],
		shown: hideWords(count, { level, seed: seed(), history: [], misses: known?.misses ?? [] }),
		pass,
		started: false,
	};
};

/** What the next pass will be, after this one. */
const nextStep = (
	faded: Faded,
	level: number
): 'practice.learnt' | 'practice.harder' | 'practice.easier' | 'practice.again' => {
	if (faded.learnt) return 'practice.learnt';
	if (faded.level > level) return 'practice.harder';
	return faded.level < level ? 'practice.easier' : 'practice.again';
};

const Finished = ({ passage, message }: Readonly<{ passage: NoteRecord; message: string }>) => (
	<main className="screen practice">
		<header className="screen-header">
			<h1>{passage.title}</h1>
		</header>
		<p className="empty">{message}</p>
		<Link to="/passage/$id" params={{ id: passage.id }} className="button primary">
			{t('practice.back')}
		</Link>
	</main>
);

export const Learn = ({ passage }: Readonly<{ passage: NoteRecord }>) => {
	const { chunked, progress } = useMemo(() => read(passage.source), [passage.source]);
	const [session, setSession] = useState<Session | undefined>(() => {
		if (chunked === undefined) return undefined;
		const at = nextToLearn(chunked, progress);
		return at === undefined ? undefined : sessionAt(chunked, progress, at, 0);
	});
	const pace = useLiveQuery(() => usualPace(db), []);
	const touch = useMediaQuery(COARSE_POINTER);
	const options = useMemo(
		() => ({
			hesitationMs: hesitationThreshold(pace),
			...(touch ? { neighbours: QWERTY } : {}),
		}),
		[pace, touch]
	);
	const [state, dispatch] = useReducer(
		(current: Typing, action: Action): Typing =>
			action.type === 'start'
				? startTyping(action.keys, action.at)
				: typing(current, action, options),
		startTyping([], 0)
	);
	const input = useRef<HTMLInputElement>(null);
	const recorded = useRef(-1);
	const notices = useNotices();

	const chunk = session === undefined ? undefined : chunked?.chunks[session.at];
	const keys = useMemo(
		() =>
			chunk === undefined || chunked === undefined
				? []
				: chunked.words.slice(chunk.start, chunk.end).map((word) => word.key),
		[chunk, chunked]
	);
	const done = session?.started === true && state.keys.length > 0 && isTyped(state);
	const outcome = useMemo(() => {
		if (!done) return undefined;
		const summary = summarize(state.results);
		return { summary, faded: fade(session.level, summary) };
	}, [done, session, state.results]);

	// The clock, for hints.
	useEffect(() => {
		if (session?.started !== true || done) return undefined;
		const timer = window.setInterval(() => {
			dispatch({ type: 'tick', at: performance.now() });
		}, 250);
		return () => {
			window.clearInterval(timer);
		};
	}, [session?.started, done]);

	// Each pass recorded as it ends, once.
	useEffect(() => {
		if (!done || chunk === undefined) return;
		if (recorded.current === session.pass) return;
		recorded.current = session.pass;
		const results: readonly WordResult[] = state.results;
		const summary = summarize(results);
		const clean = summary.missed === 0 && summary.hinted === 0;
		void (async () => {
			const now = new Date();
			const result = await recordPass(
				db,
				{
					id: passage.id,
					key: chunk.key,
					update: (before) => learningPass(before, results, now).progress,
					activity: {
						words: results.length,
						passes: 1,
						reviews: 0,
						ms: results.reduce((sum, each) => sum + each.ms, 0),
					},
					device: await deviceId(db),
					...(clean && summary.medianMs !== undefined ? { pace: summary.medianMs } : {}),
				},
				{},
				now
			);
			if (!result.ok) {
				notices.tell(t(`practice.unsaved.${result.reason}`));
				return;
			}
			if (!result.activity) notices.tell(t('practice.noActivity'));
		})();
	}, [done, session, chunk, state.results, passage.id, notices]);

	if (chunked === undefined || chunked.chunks.length === 0) {
		return <Finished passage={passage} message={t('practice.nothing')} />;
	}
	if (session === undefined || chunk === undefined) {
		return <Finished passage={passage} message={t('practice.allLearnt')} />;
	}

	const begin = (next: Session) => {
		input.current?.focus();
		setSession({ ...next, started: true });
		dispatch({
			type: 'start',
			keys: chunked.words
				.slice(chunked.chunks[next.at]?.start ?? 0, chunked.chunks[next.at]?.end ?? 0)
				.map((word) => word.key),
			at: performance.now(),
		});
	};

	const proceed = () => {
		if (outcome === undefined) return;
		if (outcome.faded.learnt) {
			const at = nextToLearn(chunked, progress, session.at + 1);
			if (at === undefined || at === session.at) {
				setSession(undefined);
				return;
			}
			begin(sessionAt(chunked, progress, at, session.pass + 1));
			return;
		}
		const history = [
			...session.history,
			{
				hidden: session.shown.map((each) => each !== 'word'),
				missed: state.results.map((result) => result.missed),
			},
		];
		const level = outcome.faded.level;
		const misses = progress.chunks.get(chunk.key)?.misses ?? [];
		begin({
			at: session.at,
			level,
			history,
			shown: hideWords(keys.length, { level, seed: seed(), history, misses }),
			pass: session.pass + 1,
			started: true,
		});
	};

	const typed = session.started ? state : startTyping(keys, 0);
	const recalled = outcome === undefined ? 0 : outcome.summary.words - outcome.summary.missed;

	return (
		<main className="screen practice">
			<header className="screen-header">
				<Link
					to="/passage/$id"
					params={{ id: passage.id }}
					className="icon-link"
					aria-label={t('practice.stop')}
					title={t('practice.stop')}
				>
					<Icon name="close" />
				</Link>
				<h1>{passage.title}</h1>
			</header>
			<p className="practice-where">
				{t('practice.part', { at: session.at + 1, count: chunked.chunks.length })}
				<span
					className="practice-level"
					role="img"
					aria-label={t('practice.level', { level: session.level, top: MAX_LEVEL })}
				>
					{Array.from({ length: MAX_LEVEL + 1 }, (_, n) => (
						<span key={n} className={n <= session.level ? 'reached' : undefined} />
					))}
				</span>
			</p>
			<p className="practice-context">{contextFor(chunked, session.at, passage.title)}</p>
			<div className="practice-stage">
				<LetterCapture
					inputRef={input}
					label={t('practice.capture')}
					onKeys={(pressed, at) => {
						if (!session.started || done) return;
						pressed.forEach((key) => {
							dispatch({ type: 'key', key, at });
						});
					}}
					onEnter={() => {
						if (done) {
							proceed();
							return;
						}
						if (!session.started) begin(session);
					}}
				/>
				<ChunkView
					lines={chunkLines(chunked, chunk)}
					start={chunk.start}
					shown={session.shown}
					typing={typed}
					label={t('practice.chunk')}
					onTap={() => {
						input.current?.focus();
					}}
				/>
			</div>
			{!session.started && (
				<div className="practice-actions">
					<p className="practice-hint">{t('practice.how')}</p>
					<button
						type="button"
						className="button primary"
						onClick={() => {
							begin(session);
						}}
					>
						{t('practice.start')}
					</button>
				</div>
			)}
			{session.started && !done && (
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
			{outcome !== undefined && (
				<div className="practice-outcome" role="status">
					<p>{t('practice.recalled', { recalled, count: outcome.summary.words })}</p>
					<p>{t(nextStep(outcome.faded, session.level))}</p>
					<button
						type="button"
						className="button primary"
						onPointerDown={(event) => {
							event.preventDefault();
						}}
						onClick={proceed}
					>
						{t('practice.continue')}
					</button>
				</div>
			)}
		</main>
	);
};
