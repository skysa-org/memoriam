import { Link, useRouterState } from '@tanstack/react-router';

import { t } from '../i18n/t.js';
import { Icon } from './Icon.js';

/**
 * The bar of screens: across the bottom of a phone, within reach of a thumb,
 * and across the top of a wider window.
 *
 * A passage's own screens, and the editor, are in the Library, and say so: the
 * bar shows where a screen belongs, not only which one is open.
 */
const sectionOf = (pathname: string): 'today' | 'library' | 'settings' => {
	if (pathname === '/' || pathname === '/session') return 'today';
	return pathname === '/settings' ? 'settings' : 'library';
};

export const NavBar = () => {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const section = sectionOf(pathname);
	return (
		<nav className="nav-bar" aria-label={t('shell.nav.label')}>
			<Link
				to="/"
				className="nav-item"
				aria-current={section === 'today' ? 'page' : undefined}
			>
				<Icon name="today" size={20} />
				<span>{t('shell.nav.today')}</span>
			</Link>
			<Link
				to="/library"
				className="nav-item"
				aria-current={section === 'library' ? 'page' : undefined}
			>
				<Icon name="library" size={20} />
				<span>{t('shell.nav.library')}</span>
			</Link>
			<Link
				to="/settings"
				className="nav-item"
				aria-current={section === 'settings' ? 'page' : undefined}
			>
				<Icon name="settings" size={20} />
				<span>{t('shell.nav.settings')}</span>
			</Link>
		</nav>
	);
};
