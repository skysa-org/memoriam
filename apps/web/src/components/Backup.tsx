import { useRef, useState } from 'react';

import { exportLibrary } from '../archive/exportLibrary.js';
import { gather, importLibrary, type ImportReport } from '../archive/importLibrary.js';
import { LOCALE, t } from '../i18n/t.js';
import { db } from '../store/db.js';
import { Icon } from './Icon.js';

/**
 * The library out as a backup, and passages in from files
 * (docs/ARCHITECTURE.md §3, §10): the only copy there is, until sync, is the
 * one in this browser.
 */

type Busy = 'export' | 'import' | undefined;

const names = new Intl.ListFormat(LOCALE, { type: 'conjunction' });

/** What an import came to, a sentence for each thing that happened. */
const reported = (report: ImportReport): string[] => {
	const lines = [
		report.added > 0 ? t('settings.backup.added', { count: report.added }) : undefined,
		report.merged > 0 ? t('settings.backup.merged', { count: report.merged }) : undefined,
		report.unchanged > 0
			? t('settings.backup.unchanged', { count: report.unchanged })
			: undefined,
		report.copied > 0 ? t('settings.backup.copied', { count: report.copied }) : undefined,
		report.records > 0 ? t('settings.backup.records') : undefined,
		report.skipped > 0 ? t('settings.backup.skipped', { count: report.skipped }) : undefined,
		report.unreadable.length > 0
			? t('settings.backup.unreadable', { names: names.format(report.unreadable) })
			: undefined,
	].filter((line) => line !== undefined);
	return lines.length === 0 ? [t('settings.backup.nothing')] : lines;
};

export const Backup = () => {
	const [busy, setBusy] = useState<Busy>();
	const [said, setSaid] = useState<readonly string[]>([]);
	const picker = useRef<HTMLInputElement>(null);

	const save = async () => {
		setBusy('export');
		const exported = await exportLibrary(db).finally(() => {
			setBusy(undefined);
		});
		setSaid([
			exported.ok
				? t('settings.backup.exported', { name: exported.name })
				: t('settings.backup.tooLarge'),
		]);
	};

	const bring = async (files: readonly File[]) => {
		if (files.length === 0) return;
		setBusy('import');
		const report = await gather(files)
			.then((gathered) => importLibrary(db, gathered))
			.finally(() => {
				setBusy(undefined);
			});
		setSaid(reported(report));
	};

	return (
		<section className="settings-section" aria-labelledby="settings-backup">
			<h2 id="settings-backup">{t('settings.backup.title')}</h2>
			<p className="field-hint">{t('settings.backup.hint')}</p>
			<div className="form-actions">
				<button
					type="button"
					className="button"
					disabled={busy !== undefined}
					onClick={() => {
						void save();
					}}
				>
					<Icon name="download" />
					{busy === 'export'
						? t('settings.backup.exporting')
						: t('settings.backup.export')}
				</button>
				<button
					type="button"
					className="button"
					disabled={busy !== undefined}
					onClick={() => {
						picker.current?.click();
					}}
				>
					<Icon name="upload" />
					{busy === 'import'
						? t('settings.backup.importing')
						: t('settings.backup.import')}
				</button>
				<input
					ref={picker}
					type="file"
					className="file-picker"
					multiple
					accept=".md,.markdown,.txt,.zip,text/markdown,text/plain,application/zip"
					aria-label={t('settings.backup.import')}
					tabIndex={-1}
					onChange={(event) => {
						const files = [...(event.target.files ?? [])];
						// Emptied, so the same file chosen again is a change again.
						event.target.value = '';
						void bring(files);
					}}
				/>
			</div>
			<p className="field-hint">{t('settings.backup.importHint')}</p>
			<div className="settings-said" role="status">
				{said.map((line) => (
					<p key={line}>{line}</p>
				))}
			</div>
		</section>
	);
};
