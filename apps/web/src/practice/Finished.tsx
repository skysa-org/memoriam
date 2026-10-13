import { type ReactNode } from 'react';

import { t } from '../i18n/t.js';
import { type Tally } from './Session.js';

/** The end of a session, or a session with nothing in it: what came of it, and where next. */
export const Finished = ({
	title,
	tally,
	message,
	children,
}: Readonly<{
	title: string;
	tally?: Tally | undefined;
	message: string;
	/** The ways on. */
	children: ReactNode;
}>) => (
	<main className="screen practice">
		<header className="screen-header">
			<h1>{title}</h1>
		</header>
		<div className="practice-tally" role="status">
			{tally !== undefined && tally.reviewed > 0 && (
				<p>{t('session.reviewed', { count: tally.reviewed })}</p>
			)}
			{tally !== undefined && tally.learnt > 0 && (
				<p>{t('session.learnt', { count: tally.learnt })}</p>
			)}
			<p className="empty">{message}</p>
		</div>
		<div className="form-actions">{children}</div>
	</main>
);
