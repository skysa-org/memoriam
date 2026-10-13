import { createFileRoute, Link } from '@tanstack/react-router';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { Icon } from '../components/Icon.js';
import { t } from '../i18n/t.js';
import { useLibrary } from '../store/hooks.js';
import { planCounts, useDayPlan } from '../store/schedule.js';

/** What there is to practise today, and the way into it. */
const Today = () => {
	const library = useLibrary();
	const plan = useDayPlan();
	if (library === undefined || plan === undefined) {
		return <main className="screen" aria-busy="true" />;
	}
	const { reviews, newWords } = planCounts(plan);
	return (
		<main className="screen">
			<header className="screen-header">
				<h1>{t('today.title')}</h1>
			</header>
			{library.count === 0 && (
				<>
					<p className="empty">{t('today.empty')}</p>
					<Link to="/new" search={{}} className="button primary">
						<Icon name="plus" />
						{t('today.add')}
					</Link>
				</>
			)}
			{library.count > 0 && plan.steps.length === 0 && (
				<>
					<p className="empty">{t('today.done')}</p>
					<p className="empty">{t('today.more')}</p>
					<Link to="/library" className="button">
						{t('today.open')}
					</Link>
				</>
			)}
			{library.count > 0 && plan.steps.length > 0 && (
				<>
					<div className="today-counts">
						{reviews > 0 && <p>{t('today.reviews', { count: reviews })}</p>}
						{newWords > 0 && <p>{t('today.newWords', { count: newWords })}</p>}
					</div>
					<Link to="/session" className="button primary">
						{t('today.start')}
					</Link>
				</>
			)}
		</main>
	);
};

export const Route = createFileRoute('/')({
	component: Today,
	// Its own boundary, under the root's layout, so the layout — and the "new
	// version" prompt in it — outlives a screen that throws.
	errorComponent: ErrorScreen,
});
