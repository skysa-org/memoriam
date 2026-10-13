import { BADGES } from '@memoriam/core';
import { createFileRoute, Link } from '@tanstack/react-router';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { Heatmap } from '../components/Heatmap.js';
import { Icon } from '../components/Icon.js';
import { MasteryBar } from '../components/MasteryBar.js';
import { formatDay } from '../i18n/dates.js';
import { t } from '../i18n/t.js';
import { type Rewards, useRewards } from '../store/rewards.js';
import { useSettings } from '../store/settings.js';

/**
 * Progress: the streak, practice by the day, what is learnt, and the badges
 * (docs/ARCHITECTURE.md §6). Informative, never a scolding.
 */

/** Weeks of practice shown: half a year, which still fits a phone. */
const WEEKS = 26;

const StreakCard = ({ rewards, rest }: Readonly<{ rewards: Rewards; rest: boolean }>) => {
	const { streak } = rewards;
	return (
		<section className="stats-card" aria-labelledby="stats-streak">
			<h2 id="stats-streak">{t('stats.streak.title')}</h2>
			<p className="stats-big">
				<Icon name="flame" size={22} />
				{streak.length > 0
					? t('stats.streak.days', { count: streak.length })
					: t('stats.streak.none')}
			</p>
			{streak.best > 0 && <p>{t('stats.streak.best', { count: streak.best })}</p>}
			<p>
				<Icon name="freeze" />
				{t('stats.streak.freezes', { count: streak.freezes })}
			</p>
			<p className="field-hint">{t('stats.streak.freezesHint')}</p>
			{rest && <p className="field-hint">{t('stats.streak.rest')}</p>}
		</section>
	);
};

const Totals = ({ rewards }: Readonly<{ rewards: Rewards }>) => {
	const words = rewards.passages.reduce((sum, each) => sum + each.measure.learntWords, 0);
	const learnt = rewards.passages.filter((each) => each.measure.learnt).length;
	const days = [...rewards.days.values()];
	const minutes = Math.round(days.reduce((sum, day) => sum + day.ms, 0) / 60_000);
	const passes = days.reduce((sum, day) => sum + day.passes, 0);
	return (
		<section className="stats-card" aria-labelledby="stats-totals">
			<h2 id="stats-totals">{t('stats.totals.title')}</h2>
			<ul className="stats-totals">
				<li>{t('stats.totals.words', { count: words })}</li>
				<li>{t('stats.totals.passages', { count: learnt })}</li>
				<li>{t('stats.totals.minutes', { count: minutes })}</li>
				<li>{t('stats.totals.passes', { count: passes })}</li>
			</ul>
		</section>
	);
};

const Passages = ({ rewards }: Readonly<{ rewards: Rewards }>) => (
	<section className="stats-card" aria-labelledby="stats-passages">
		<h2 id="stats-passages">{t('stats.passages.title')}</h2>
		{rewards.passages.length === 0 ? (
			<p className="empty">{t('stats.passages.none')}</p>
		) : (
			<ul className="stats-passages">
				{rewards.passages.map(({ id, title, measure }) => (
					<li key={id}>
						<Link to="/passage/$id" params={{ id }}>
							{title}
						</Link>
						<MasteryBar measure={measure} />
					</li>
				))}
			</ul>
		)}
	</section>
);

const Badges = ({ rewards }: Readonly<{ rewards: Rewards }>) => (
	<section className="stats-card" aria-labelledby="stats-badges">
		<h2 id="stats-badges">{t('stats.badges.title')}</h2>
		<ul className="badge-grid">
			{BADGES.map((badge) => {
				const day = rewards.badges.get(badge);
				return (
					<li key={badge} className={day === undefined ? 'badge locked' : 'badge earned'}>
						<Icon name="badge" size={24} />
						<span className="badge-name">{t(`badges.${badge}.name`)}</span>
						<span className="badge-how">{t(`badges.${badge}.how`)}</span>
						<span className="badge-when">
							{day === undefined
								? t('stats.badges.notYet')
								: t('stats.badges.earned', { date: formatDay(day, 'medium') })}
						</span>
					</li>
				);
			})}
		</ul>
	</section>
);

const Stats = () => {
	const rewards = useRewards();
	const settings = useSettings();
	if (rewards === undefined || settings === undefined) {
		return <main className="screen" aria-busy="true" />;
	}
	return (
		<main className="screen">
			<header className="screen-header">
				<h1>{t('stats.title')}</h1>
			</header>
			<StreakCard rewards={rewards} rest={settings.restDay !== undefined} />
			<section className="stats-card" aria-labelledby="stats-heat">
				<h2 id="stats-heat">{t('stats.heat.title')}</h2>
				<Heatmap
					days={rewards.days}
					today={rewards.today}
					kept={rewards.streak.kept}
					weeks={WEEKS}
				/>
			</section>
			<Totals rewards={rewards} />
			<Passages rewards={rewards} />
			<Badges rewards={rewards} />
		</main>
	);
};

export const Route = createFileRoute('/stats')({
	component: Stats,
	errorComponent: ErrorScreen,
});
