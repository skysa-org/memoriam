import { ROOT } from '@memoriam/core';
import { useBlocker } from '@tanstack/react-router';
import { type SyntheticEvent, useId, useRef, useState } from 'react';

import { t } from '../i18n/t.js';
import { type PassageDetails } from '../store/passages.js';
import { ConfirmDialog } from './ConfirmDialog.js';

/**
 * A passage's words and details, as they are added or edited: a title, where
 * the words are from, the collection, and the words themselves in a plain text
 * area, line breaks and all (docs/ARCHITECTURE.md §2).
 *
 * Saved when the user says so, not as they type: a passage is practised from
 * what was saved, and half an edit is not a passage anyone means to learn.
 * Leaving with changes unsaved asks first — by Cancel, by the bar of screens,
 * or by closing the tab.
 */
export interface PassageEditorProps {
	heading: string;
	initial: PassageDetails;
	/** The collections there are, by path. */
	collections: readonly Readonly<{ path: string; name: string }>[];
	saveLabel: string;
	/** What went wrong with the last save, said above the buttons. */
	problem?: string | undefined;
	onSave: (details: PassageDetails) => Promise<void>;
	onCancel: () => void;
}

const same = (a: PassageDetails, b: PassageDetails): boolean =>
	a.title === b.title &&
	a.reference === b.reference &&
	a.collection === b.collection &&
	a.text === b.text;

export const PassageEditor = ({
	heading,
	initial,
	collections,
	saveLabel,
	problem,
	onSave,
	onCancel,
}: PassageEditorProps) => {
	// What editing began from, kept: the passage may be saved in another tab
	// meanwhile, and that is not a change made here.
	const [start] = useState(initial);
	const [details, setDetails] = useState(initial);
	const [saving, setSaving] = useState(false);
	// Read by the blocker at the moment it is asked, which is after a save has
	// begun to navigate: state would still say there were changes.
	const leaving = useRef(false);
	const ids = { title: useId(), reference: useId(), collection: useId(), text: useId() };
	const hints = { title: useId(), reference: useId(), text: useId() };

	const changed = !same(details, start);
	const blocker = useBlocker({
		shouldBlockFn: () => changed && !leaving.current,
		enableBeforeUnload: () => changed && !leaving.current,
		withResolver: true,
	});

	const set =
		(field: keyof PassageDetails) =>
		(event: { target: { value: string } }): void => {
			setDetails((now) => ({ ...now, [field]: event.target.value }));
		};

	const submit = (event: SyntheticEvent) => {
		event.preventDefault();
		if (details.text.trim() === '' || saving) return;
		setSaving(true);
		leaving.current = true;
		onSave(details)
			.catch(() => undefined)
			.finally(() => {
				leaving.current = false;
				setSaving(false);
			});
	};

	// Known collections, and the one being edited into if it is somehow not
	// among them, so the choice shown is always the one that will be saved.
	const known =
		details.collection === ROOT || collections.some((each) => each.path === details.collection);
	const choices = known
		? collections
		: [...collections, { path: details.collection, name: details.collection }];

	return (
		<form className="editor" onSubmit={submit}>
			<header className="screen-header">
				<h1>{heading}</h1>
			</header>

			<div className="field-row">
				<label htmlFor={ids.title}>{t('passage.editor.title')}</label>
				<input
					id={ids.title}
					className="field"
					value={details.title}
					onChange={set('title')}
					aria-describedby={hints.title}
					autoComplete="off"
				/>
				<p id={hints.title} className="field-hint">
					{t('passage.editor.titleHint')}
				</p>
			</div>

			<div className="field-row">
				<label htmlFor={ids.reference}>{t('passage.editor.reference')}</label>
				<input
					id={ids.reference}
					className="field"
					value={details.reference}
					onChange={set('reference')}
					aria-describedby={hints.reference}
					autoComplete="off"
				/>
				<p id={hints.reference} className="field-hint">
					{t('passage.editor.referenceHint')}
				</p>
			</div>

			<div className="field-row">
				<label htmlFor={ids.collection}>{t('passage.editor.collection')}</label>
				<select
					id={ids.collection}
					className="field"
					value={details.collection}
					onChange={set('collection')}
				>
					<option value={ROOT}>{t('passage.editor.noCollection')}</option>
					{choices.map((each) => (
						<option key={each.path} value={each.path}>
							{each.name}
						</option>
					))}
				</select>
			</div>

			<div className="field-row">
				<label htmlFor={ids.text}>{t('passage.editor.text')}</label>
				<textarea
					id={ids.text}
					className="field passage-field"
					value={details.text}
					onChange={set('text')}
					aria-describedby={hints.text}
					rows={14}
					required
				/>
				<p id={hints.text} className="field-hint">
					{t('passage.editor.textHint')}
				</p>
			</div>

			{problem !== undefined && (
				<p className="form-problem" role="alert">
					{problem}
				</p>
			)}

			<div className="form-actions">
				<button
					type="submit"
					className="button primary"
					disabled={details.text.trim() === '' || saving}
				>
					{saveLabel}
				</button>
				<button type="button" className="button" onClick={onCancel}>
					{t('common.cancel')}
				</button>
			</div>

			{blocker.status === 'blocked' && (
				<ConfirmDialog
					title={t('passage.editor.discard.title')}
					confirmLabel={t('passage.editor.discard.confirm')}
					tone="danger"
					onConfirm={blocker.proceed}
					onCancel={blocker.reset}
				>
					{t('passage.editor.discard.text')}
				</ConfirmDialog>
			)}
		</form>
	);
};
