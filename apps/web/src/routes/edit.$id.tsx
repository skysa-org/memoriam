import { parentPath } from '@memoriam/core';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { MissingPassage } from '../components/MissingPassage.js';
import { PassageEditor } from '../components/PassageEditor.js';
import { t } from '../i18n/t.js';
import { db } from '../store/db.js';
import { useLibrary, usePassage } from '../store/hooks.js';
import { passageText, updatePassage } from '../store/passages.js';

/** Editing a passage's words and details. */

const EditPassage = () => {
	const { id } = Route.useParams();
	const passage = usePassage(id);
	const library = useLibrary();
	const navigate = useNavigate();
	const [problem, setProblem] = useState<string | undefined>(undefined);

	if (passage === undefined || library === undefined) {
		return <main className="screen" aria-busy="true" />;
	}
	if (passage === null) return <MissingPassage />;

	return (
		<main className="screen">
			<PassageEditor
				key={passage.id}
				heading={t('passage.editor.editTitle')}
				initial={{
					title: passage.title,
					reference: passage.reference ?? '',
					collection: parentPath(passage.path),
					text: passageText(passage.source),
				}}
				collections={library.collections}
				saveLabel={t('passage.editor.save')}
				problem={problem}
				onSave={async (details) => {
					const edited = await updatePassage(db, passage.id, details);
					if (!edited.ok) {
						setProblem(
							edited.reason === 'unreadable'
								? t('passage.editor.unreadable')
								: t('passage.missing.text')
						);
						throw new Error(edited.reason);
					}
					await navigate({ to: '/passage/$id', params: { id }, replace: true });
				}}
				onCancel={() => {
					void navigate({ to: '/passage/$id', params: { id } });
				}}
			/>
		</main>
	);
};

export const Route = createFileRoute('/edit/$id')({
	component: EditPassage,
	errorComponent: ErrorScreen,
});
