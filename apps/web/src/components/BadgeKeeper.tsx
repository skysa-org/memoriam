import { type Badge } from '@memoriam/core';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { t } from '../i18n/t.js';
import { db } from '../store/db.js';
import { recordBadges, useRewards } from '../store/rewards.js';
import { Icon } from './Icon.js';

/**
 * Writes each badge down as it is earned, and says so, briefly
 * (docs/ARCHITECTURE.md §6): a small notice that goes by itself, and moves
 * only for those who have not asked for less motion.
 */

/** How long the notice stays. */
const SHOWN_MS = 8000;

export const BadgeKeeper = () => {
	const rewards = useRewards();
	const [shown, setShown] = useState<readonly Badge[]>([]);
	// What was last tried, so a file that cannot be written is not tried on every change.
	const tried = useRef('');

	useEffect(() => {
		if (rewards === undefined || rewards.unrecorded.size === 0) return;
		const earned = [...rewards.unrecorded.keys()];
		const attempt = earned.join(' ');
		if (tried.current === attempt) return;
		tried.current = attempt;
		void recordBadges(db, rewards.unrecorded).then((recorded) => {
			if (recorded) setShown(earned);
		});
	}, [rewards]);

	useEffect(() => {
		if (shown.length === 0) return undefined;
		const timer = window.setTimeout(() => {
			setShown([]);
		}, SHOWN_MS);
		return () => {
			window.clearTimeout(timer);
		};
	}, [shown]);

	return (
		<div className="celebration-region" aria-live="polite">
			{shown.length > 0 && (
				<div className="celebration">
					<Icon name="badge" />
					<div className="celebration-text">
						{shown.map((badge) => (
							<p key={badge}>
								{t('stats.badges.new', { name: t(`badges.${badge}.name`) })}
							</p>
						))}
						<Link
							to="/stats"
							onClick={() => {
								setShown([]);
							}}
						>
							{t('stats.badges.see')}
						</Link>
					</div>
					<button
						type="button"
						className="icon"
						aria-label={t('stats.badges.close')}
						title={t('stats.badges.close')}
						onClick={() => {
							setShown([]);
						}}
					>
						<Icon name="close" />
					</button>
				</div>
			)}
		</div>
	);
};
