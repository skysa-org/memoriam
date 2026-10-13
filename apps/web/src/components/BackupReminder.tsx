import { useState } from 'react';

import { exportLibrary } from '../archive/exportLibrary.js';
import { t } from '../i18n/t.js';
import { snoozeBackup, useBackupReminder } from '../store/backup.js';
import { db } from '../store/db.js';
import { Icon } from './Icon.js';
import { useNotices } from './Notices.js';

/**
 * A reminder on Today to export a backup, while the library is only in this
 * browser (`store/backup.ts`). The export is a download, which the browser
 * shows; only an export that could not be made is said here.
 */
export const BackupReminder = () => {
	const reminder = useBackupReminder();
	const notices = useNotices();
	const [busy, setBusy] = useState(false);
	if (reminder === undefined || reminder === null) return null;

	const save = async () => {
		setBusy(true);
		const exported = await exportLibrary(db).finally(() => {
			setBusy(false);
		});
		if (!exported.ok) notices.tell(t('settings.backup.tooLarge'));
	};

	return (
		<aside className="today-backup" aria-label={t('today.backup.label')}>
			<p>
				{reminder.kind === 'never'
					? t('today.backup.never')
					: t('today.backup.since', { count: reminder.days })}
			</p>
			<div className="form-actions">
				<button
					type="button"
					className="button"
					disabled={busy}
					onClick={() => {
						void save();
					}}
				>
					<Icon name="download" />
					{t('settings.backup.export')}
				</button>
				<button
					type="button"
					className="button ghost"
					onClick={() => {
						void snoozeBackup(db, new Date());
					}}
				>
					{t('today.backup.later')}
				</button>
			</div>
		</aside>
	);
};
