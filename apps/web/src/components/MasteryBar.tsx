import { type Measure } from '@memoriam/core';

import { t } from '../i18n/t.js';

/** How much of a passage is learnt, as a bar, and how well it is held now. */
export const MasteryBar = ({ measure }: Readonly<{ measure: Measure }>) => {
	const percent = Math.round(measure.mastery * 100);
	const label = t('stats.passages.mastery', { percent });
	return (
		<span className="mastery">
			<progress className="mastery-bar" max={100} value={percent} aria-label={label} />
			<span className="mastery-text">
				{label}
				{measure.health !== undefined && (
					<span className="mastery-health">
						{t('stats.passages.health', { percent: Math.round(measure.health * 100) })}
					</span>
				)}
			</span>
		</span>
	);
};
