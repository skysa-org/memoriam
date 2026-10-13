import { isLearnt, localDay, planDay } from '@memoriam/core';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { Icon } from '../components/Icon.js';
import { MissingPassage } from '../components/MissingPassage.js';
import { t } from '../i18n/t.js';
import { Finished } from '../practice/Finished.js';
import { Session, type Tally } from '../practice/Session.js';
import { runThrough, type Task, tasksOf } from '../practice/tasks.js';
import { usePassage } from '../store/hooks.js';
import { type Readied, readied } from '../store/schedule.js';
import { type Settings, useSettings } from '../store/settings.js';

/**
 * Practising one passage: what is due in it, then every part not yet learnt,
 * whatever the day's cap on new words (docs/ARCHITECTURE.md §5). Once it is
 * all learnt, it can be run through whole.
 */

/** Its tasks, as the passage was when practice began. */
const planned = (passage: Readied | undefined): Task[] => {
	if (passage === undefined) return [];
	const now = new Date();
	return tasksOf(
		planDay([passage], { now, today: localDay(now), newWords: Infinity, startedToday: 0 })
	);
};

const Practise = ({
	id,
	title,
	passage,
	settings,
}: Readonly<{ id: string; title: string; passage: Readied | undefined; settings: Settings }>) => {
	const [tasks, setTasks] = useState<readonly Task[]>(() => planned(passage));
	// A fresh session for each run through.
	const [round, setRound] = useState(0);
	const chunks = passage?.chunked.chunks ?? [];
	const allLearnt =
		passage !== undefined &&
		chunks.length > 0 &&
		chunks.every((chunk) => isLearnt(passage.progress.chunks.get(chunk.key)));
	const message = (() => {
		if (allLearnt) return t('practice.allLearnt');
		return chunks.length === 0 ? t('practice.nothing') : t('session.done');
	})();

	const ending = (tally?: Tally) => (
		<Finished title={title} tally={tally} message={message}>
			{allLearnt && (
				<button
					type="button"
					className="button primary"
					onClick={() => {
						setTasks(runThrough(id, passage.chunked));
						setRound((before) => before + 1);
					}}
				>
					{t('session.runThrough')}
				</button>
			)}
			<Link
				to="/passage/$id"
				params={{ id }}
				className={allLearnt ? 'button' : 'button primary'}
			>
				{t('practice.back')}
			</Link>
		</Finished>
	);

	if (passage === undefined || tasks.length === 0) return ending();
	return (
		<Session
			key={round}
			tasks={tasks}
			passages={new Map([[id, passage]])}
			settings={settings}
			stop={
				<Link
					to="/passage/$id"
					params={{ id }}
					className="icon-link"
					aria-label={t('practice.stop')}
					title={t('practice.stop')}
				>
					<Icon name="close" />
				</Link>
			}
			finished={ending}
		/>
	);
};

const Practice = () => {
	const { id } = Route.useParams();
	const row = usePassage(id);
	const settings = useSettings();
	const passage = useMemo(() => (row ? readied(row) : undefined), [row]);
	if (row === undefined || settings === undefined) {
		return <main className="screen" aria-busy="true" />;
	}
	if (row === null) return <MissingPassage />;
	// Keyed by passage, so going from one to another starts afresh.
	return (
		<Practise
			key={row.id}
			id={row.id}
			title={row.title}
			passage={passage}
			settings={settings}
		/>
	);
};

export const Route = createFileRoute('/practice/$id')({
	component: Practice,
	errorComponent: ErrorScreen,
});
