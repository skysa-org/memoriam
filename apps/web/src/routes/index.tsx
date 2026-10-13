import { createFileRoute } from '@tanstack/react-router';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { t } from '../i18n/t.js';

const Home = () => (
	<main className="screen">
		<header className="screen-header">
			<h1>{t('today.title')}</h1>
		</header>
		<p className="empty">{t('today.empty')}</p>
	</main>
);

export const Route = createFileRoute('/')({
	component: Home,
	// Its own boundary, under the root's layout, so the layout — and the "new
	// version" prompt in it — outlives a screen that throws.
	errorComponent: ErrorScreen,
});
