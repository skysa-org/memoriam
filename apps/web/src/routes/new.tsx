import { ROOT } from '@memoriam/core';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { PassageEditor } from '../components/PassageEditor.js';
import { t } from '../i18n/t.js';
import { db } from '../store/db.js';
import { useLibrary } from '../store/hooks.js';
import { createPassage } from '../store/passages.js';

/** Adding a passage, into the collection the Library's `+` was beside, if any. */

export interface NewSearch {
	collection?: string;
}

const NewPassage = () => {
	const { collection = ROOT } = Route.useSearch();
	const library = useLibrary();
	const navigate = useNavigate();

	if (library === undefined) return <main className="screen" aria-busy="true" />;

	return (
		<main className="screen">
			<PassageEditor
				heading={t('passage.editor.newTitle')}
				initial={{ title: '', reference: '', collection, text: '' }}
				collections={library.collections}
				saveLabel={t('passage.editor.add')}
				onSave={async (details) => {
					const added = await createPassage(db, details);
					await navigate({ to: '/passage/$id', params: { id: added.id }, replace: true });
				}}
				onCancel={() => {
					void navigate({ to: '/library' });
				}}
			/>
		</main>
	);
};

export const Route = createFileRoute('/new')({
	validateSearch: (search: Record<string, unknown>): NewSearch =>
		typeof search.collection === 'string' ? { collection: search.collection } : {},
	component: NewPassage,
	errorComponent: ErrorScreen,
});
