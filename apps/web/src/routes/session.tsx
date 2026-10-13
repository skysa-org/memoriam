import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { Icon } from '../components/Icon.js';
import { t } from '../i18n/t.js';
import { Finished } from '../practice/Finished.js';
import { Session, type Tally } from '../practice/Session.js';
import { tasksOf } from '../practice/tasks.js';
import { type DayPlan, useDayPlan } from '../store/schedule.js';

/** The day's practice, as planned when it began (docs/ARCHITECTURE.md §5). */

const Planned = ({ plan }: Readonly<{ plan: DayPlan }>) => {
	// The plan as it stood at Start: each pass recorded changes it, and the
	// session itself says what follows.
	const [tasks] = useState(() => tasksOf(plan.steps));
	const ending = (tally?: Tally) => (
		<Finished
			title={t('today.title')}
			tally={tally}
			message={tally === undefined ? t('session.nothing') : t('session.done')}
		>
			<Link to="/" className="button primary">
				{t('session.back')}
			</Link>
		</Finished>
	);
	if (tasks.length === 0) return ending();
	return (
		<Session
			tasks={tasks}
			passages={plan.passages}
			settings={plan.settings}
			stop={
				<Link
					to="/"
					className="icon-link"
					aria-label={t('session.stop')}
					title={t('session.stop')}
				>
					<Icon name="close" />
				</Link>
			}
			finished={ending}
		/>
	);
};

const DaySession = () => {
	const plan = useDayPlan();
	if (plan === undefined) return <main className="screen" aria-busy="true" />;
	return <Planned plan={plan} />;
};

export const Route = createFileRoute('/session')({
	component: DaySession,
	errorComponent: ErrorScreen,
});
