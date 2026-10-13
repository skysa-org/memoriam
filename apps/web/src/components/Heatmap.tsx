import { type DayActivity, heatmap, type Kept } from '@memoriam/core';
import { useMemo } from 'react';

import { formatDay } from '../i18n/dates.js';
import { t } from '../i18n/t.js';

/**
 * Practice by the day, a column a week (docs/ARCHITECTURE.md §6). The days the
 * streak kept without practice — a freeze, a repair, a rest day — are marked.
 */

const KEPT = {
	freeze: 'stats.heat.freeze',
	repair: 'stats.heat.repair',
	rest: 'stats.heat.rest',
} as const;

const titleOf = (day: string, words: number, kept: Kept | undefined): string => {
	const date = formatDay(day, 'short');
	if (kept !== undefined && words === 0) return t(KEPT[kept], { date });
	return t('stats.heat.day', { date, count: words });
};

export const Heatmap = ({
	days,
	today,
	kept,
	weeks,
}: Readonly<{
	days: ReadonlyMap<string, DayActivity>;
	today: string;
	kept: ReadonlyMap<string, Kept>;
	weeks: number;
}>) => {
	const cells = useMemo(
		() => heatmap(days, today, { weeks, kept }).flat(),
		[days, today, weeks, kept]
	);
	const practised = cells.filter((cell) => cell.words > 0).length;
	return (
		<figure className="heatmap">
			<div
				className="heatmap-grid"
				role="img"
				aria-label={t('stats.heat.label', { weeks, count: practised })}
				style={{ gridTemplateColumns: `repeat(${String(weeks)}, 1fr)` }}
			>
				{cells.map((cell) => (
					<span
						key={cell.day}
						className={`heatmap-cell level-${String(cell.level)}${
							cell.kept === undefined ? '' : ` kept-${cell.kept}`
						}`}
						title={titleOf(cell.day, cell.words, cell.kept)}
					/>
				))}
			</div>
			<figcaption className="heatmap-legend" aria-hidden="true">
				<span>{t('stats.heat.less')}</span>
				{[0, 1, 2, 3, 4].map((level) => (
					<span key={level} className={`heatmap-cell level-${String(level)}`} />
				))}
				<span>{t('stats.heat.more')}</span>
			</figcaption>
		</figure>
	);
};
