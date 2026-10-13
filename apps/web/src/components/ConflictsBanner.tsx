import { Link } from '@tanstack/react-router';

import { t } from '../i18n/t.js';
import { useConflicts } from '../store/conflicts.js';
import { db as appDatabase, type MemoriamDatabase } from '../store/db.js';

/**
 * Says that passages were changed in two places at once, for as long as both
 * versions are kept, with the way to choose between them (`routes/conflicts.tsx`).
 */
export const ConflictsBanner = ({
	database = appDatabase,
}: Readonly<{ database?: MemoriamDatabase }>) => {
	const count = useConflicts(database)?.length ?? 0;
	if (count === 0) return null;
	return (
		<div className="conflicts-banner" role="status">
			<p>{t('sync.conflicts', { count })}</p>
			<Link to="/conflicts" className="button">
				{t('sync.resolve')}
			</Link>
		</div>
	);
};
