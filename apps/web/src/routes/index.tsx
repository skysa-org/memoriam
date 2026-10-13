import { createFileRoute, Link } from '@tanstack/react-router';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { Icon } from '../components/Icon.js';
import { t } from '../i18n/t.js';
import { useLibrary } from '../store/hooks.js';

/** What there is to practise today. Until practice is scheduled, what there is at all. */
const Today = () => {
	const library = useLibrary();
	if (library === undefined) return <main className="screen" aria-busy="true" />;
	return (
		<main className="screen">
			<header className="screen-header">
				<h1>{t('today.title')}</h1>
			</header>
			{library.count === 0 ? (
				<>
					<p className="empty">{t('today.empty')}</p>
					<Link to="/new" search={{}} className="button primary">
						<Icon name="plus" />
						{t('today.add')}
					</Link>
				</>
			) : (
				<>
					<p className="empty">{t('today.ready', { count: library.count })}</p>
					<Link to="/library" className="button">
						{t('today.open')}
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
