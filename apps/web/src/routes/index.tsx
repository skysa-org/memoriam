import { type Streak } from '@memoriam/core';
import { createFileRoute, Link } from '@tanstack/react-router';

import { BackupReminder } from '../components/BackupReminder.js';
import { ErrorScreen } from '../components/ErrorScreen.js';
import { Icon } from '../components/Icon.js';
import { formatDay } from '../i18n/dates.js';
import { t } from '../i18n/t.js';
import { useLibrary } from '../store/hooks.js';
import { type Rewards, useRewards } from '../store/rewards.js';
import { type DayPlan, planCounts, useDayPlan } from '../store/schedule.js';

/**
 * What there is to practise today, and the way into it: the streak, the day's
 * goal — the reviews due, and the day's new words (docs/ARCHITECTURE.md §6) —
 * and Start.
 */

const StreakLine = ({ streak }: Readonly<{ streak: Streak }>) => {
	if (streak.length === 0 && streak.repair === undefined) return null;
	return (
		<div className="today-streak">
			{streak.length > 0 && (
				<p>
					<Icon name="flame" />
					<span>{t('today.streak', { count: streak.length })}</span>
					{streak.freezes > 0 && (
						<span className="today-freezes">
							<Icon name="freeze" />
							{t('today.freezes', { count: streak.freezes })}
						</span>
					)}
				</p>
			)}
			{streak.repair !== undefined && (
				<p className="today-repair">
					{t('today.repair', {
						count: streak.repair.words,
						day: formatDay(streak.repair.until, 'weekday'),
					})}
				</p>
			)}
		</div>
	);
};

const Meter = ({
	label,
	done,
	total,
}: Readonly<{ label: string; done: number; total: number }>) => (
	<div className="today-meter">
		<span>{label}</span>
		<progress max={total} value={Math.min(done, total)} aria-label={label} />
	</div>
);

/** The day's goal: the reviews due, and the day's new words, and how far through each it is. */
const Goal = ({ plan, rewards }: Readonly<{ plan: DayPlan; rewards: Rewards }>) => {
	const { reviews, fresh } = planCounts(plan);
	const reviewed = rewards.days.get(plan.today)?.reviews ?? 0;
	const reviewTotal = reviewed + reviews;
	const wordTotal = plan.startedToday + fresh;
	if (reviewTotal === 0 && wordTotal === 0) return null;
	return (
		<section className="today-goal" aria-labelledby="today-goal">
			<h2 id="today-goal">{t('today.goal')}</h2>
			{reviewTotal > 0 && (
				<Meter
					label={t('today.reviews', { done: reviewed, count: reviewTotal })}
					done={reviewed}
					total={reviewTotal}
				/>
			)}
			{wordTotal > 0 && (
				<Meter
					label={t('today.newWords', { done: plan.startedToday, count: wordTotal })}
					done={plan.startedToday}
					total={wordTotal}
				/>
			)}
			{reviews === 0 && fresh === 0 && <p className="today-done">{t('today.goalDone')}</p>}
		</section>
	);
};

const Today = () => {
	const library = useLibrary();
	const plan = useDayPlan();
	const rewards = useRewards();
	if (library === undefined || plan === undefined || rewards === undefined) {
		return <main className="screen" aria-busy="true" />;
	}
	return (
		<main className="screen">
			<header className="screen-header">
				<h1>{t('today.title')}</h1>
			</header>
			<StreakLine streak={rewards.streak} />
			{library.count === 0 && (
				<>
					<p className="empty">{t('today.empty')}</p>
					<Link to="/new" search={{}} className="button primary">
						<Icon name="plus" />
						{t('today.add')}
					</Link>
				</>
			)}
			{library.count > 0 && <Goal plan={plan} rewards={rewards} />}
			{library.count > 0 && plan.steps.length === 0 && (
				<>
					<p className="empty">{t('today.done')}</p>
					<p className="empty">{t('today.beyond')}</p>
					<Link to="/library" className="button">
						{t('today.open')}
					</Link>
				</>
			)}
			{library.count > 0 && plan.steps.length > 0 && (
				<Link to="/session" className="button primary">
					<Icon name="play" />
					{t('today.start')}
				</Link>
			)}
			<BackupReminder />
		</main>
	);
};

export const Route = createFileRoute('/')({
	component: Today,
	// Its own boundary, under the root's layout, so the layout — and the "new
	// version" prompt in it — outlives a screen that throws.
	errorComponent: ErrorScreen,
});
