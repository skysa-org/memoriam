import { Link } from '@tanstack/react-router';

import { t } from '../i18n/t.js';

/** What a link to a passage that is not there opens on: deleted, or an address typed wrong. */
export const MissingPassage = () => (
	<main className="screen">
		<header className="screen-header">
			<h1>{t('passage.missing.title')}</h1>
		</header>
		<p className="empty">{t('passage.missing.text')}</p>
		<Link to="/library" className="button">
			{t('passage.missing.action')}
		</Link>
	</main>
);
