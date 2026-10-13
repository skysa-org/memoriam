import { createFileRoute, Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { Icon } from '../components/Icon.js';
import { useNotices } from '../components/Notices.js';
import { formatMoment } from '../i18n/dates.js';
import { t } from '../i18n/t.js';
import {
	type Conflict,
	copiedAt,
	keepBoth,
	keepCopy,
	keepOriginal,
	keepOrphan,
	linesAgainst,
	type Resolved,
	useConflicts,
} from '../store/conflicts.js';
import { db, type NoteRecord } from '../store/db.js';
import { deletePassage, type Edited, passageText, restorePassages } from '../store/passages.js';

/**
 * Passages changed in two places at once (docs/ARCHITECTURE.md §10,
 * "Conflicts"): each version side by side, the lines they differ in marked,
 * and the choice of which to keep — or both, as two passages. A choice of one
 * can be taken back from its notice.
 */

/** One version: its details and its words, marked against the other's. */
const Version = ({
	label,
	note,
	other,
	children,
}: Readonly<{
	label: string;
	note: NoteRecord;
	other?: NoteRecord;
	children: ReactNode;
}>) => (
	<article className="conflict-version">
		<h3 className="passage-label">{label}</h3>
		<p className="conflict-title">{note.title}</p>
		{note.reference !== undefined && <p className="passage-reference">{note.reference}</p>}
		<div className="passage-text conflict-text">
			{linesAgainst(passageText(note.source), passageText(other?.source ?? note.source)).map(
				({ line, differs }, at) =>
					differs ? (
						<mark key={at} className="conflict-line">
							{line}
							{'\n'}
						</mark>
					) : (
						<span key={at} className="conflict-line">
							{line}
							{'\n'}
						</span>
					)
			)}
		</div>
		<div className="form-actions">{children}</div>
	</article>
);

const ConflictView = ({ conflict }: Readonly<{ conflict: Conflict }>) => {
	const notices = useNotices();
	const [busy, setBusy] = useState(false);
	const { copy, original } = conflict;
	const when = copiedAt(copy.path);
	const copyLabel = t('conflicts.copy', {
		when: when === undefined ? copy.path : formatMoment(when),
	});

	/** Make a choice that loses nothing, and say only what stopped it. */
	const choose = async (choice: () => Promise<Edited>) => {
		setBusy(true);
		const result = await choice().finally(() => {
			setBusy(false);
		});
		if (!result.ok) {
			notices.tell(
				result.reason === 'unreadable' ? t('conflicts.unreadable') : t('conflicts.missing')
			);
		}
	};

	/** Keep one version, with the way back offered. */
	const offered = async (choice: () => Promise<Resolved>) => {
		setBusy(true);
		const result = await choice().finally(() => {
			setBusy(false);
		});
		if (!result.ok) {
			notices.tell(t('conflicts.missing'));
			return;
		}
		notices.offerUndo({
			message: t('conflicts.kept', { title: copy.title }),
			undo: result.undo,
		});
	};

	if (original === undefined) {
		return (
			<section className="conflict" aria-label={copy.title}>
				<h2>{copy.title}</h2>
				<p className="field-hint">{t('conflicts.orphan')}</p>
				<Version label={copyLabel} note={copy}>
					<button
						type="button"
						className="button primary"
						disabled={busy}
						onClick={() => {
							void choose(() => keepOrphan(db, copy.id));
						}}
					>
						{t('conflicts.keepOrphan')}
					</button>
					<button
						type="button"
						className="button"
						disabled={busy}
						onClick={() => {
							void deletePassage(db, copy.id).then((removed) => {
								if (removed === undefined) return;
								notices.offerUndo({
									message: t('conflicts.deleted', { title: removed.title }),
									undo: () => restorePassages(db, [removed]),
								});
							});
						}}
					>
						<Icon name="trash" />
						{t('conflicts.deleteOrphan')}
					</button>
				</Version>
			</section>
		);
	}

	const pair = { copyId: copy.id, originalId: original.id };
	return (
		<section className="conflict" aria-label={original.title}>
			<h2>{original.title}</h2>
			<div className="conflict-versions">
				<Version label={t('conflicts.original')} note={original} other={copy}>
					<button
						type="button"
						className="button primary"
						disabled={busy}
						onClick={() => {
							void offered(() => keepOriginal(db, pair));
						}}
					>
						{t('conflicts.keepThis')}
					</button>
				</Version>
				<Version label={copyLabel} note={copy} other={original}>
					<button
						type="button"
						className="button primary"
						disabled={busy}
						onClick={() => {
							void offered(() => keepCopy(db, pair));
						}}
					>
						{t('conflicts.keepThis')}
					</button>
				</Version>
			</div>
			<div className="form-actions">
				<button
					type="button"
					className="button"
					disabled={busy}
					onClick={() => {
						void choose(() =>
							keepBoth(db, copy.id, t('conflicts.otherTitle', { title: copy.title }))
						);
					}}
				>
					{t('conflicts.keepBoth')}
				</button>
			</div>
		</section>
	);
};

const Conflicts = () => {
	const conflicts = useConflicts();
	if (conflicts === undefined) return <main className="screen" aria-busy="true" />;
	return (
		<main className="screen">
			<header className="screen-header">
				<Link
					to="/library"
					className="icon-link"
					aria-label={t('passage.back')}
					title={t('passage.back')}
				>
					<Icon name="back" />
				</Link>
				<h1>{t('conflicts.title')}</h1>
			</header>
			{conflicts.length === 0 ? (
				<p className="empty">{t('conflicts.none')}</p>
			) : (
				<>
					<p className="field-hint">{t('conflicts.hint')}</p>
					<p className="field-hint">{t('conflicts.differs')}</p>
					{conflicts.map((conflict) => (
						<ConflictView key={conflict.copy.id} conflict={conflict} />
					))}
				</>
			)}
		</main>
	);
};

export const Route = createFileRoute('/conflicts')({
	component: Conflicts,
	errorComponent: ErrorScreen,
});
