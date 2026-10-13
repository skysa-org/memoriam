import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { ChunkedText } from '../components/ChunkedText.js';
import { ErrorScreen } from '../components/ErrorScreen.js';
import { Icon } from '../components/Icon.js';
import { MasteryBar } from '../components/MasteryBar.js';
import { MissingPassage } from '../components/MissingPassage.js';
import { useNotices } from '../components/Notices.js';
import { t } from '../i18n/t.js';
import { db } from '../store/db.js';
import { usePassage } from '../store/hooks.js';
import { deletePassage, restorePassages } from '../store/passages.js';
import { useRewards } from '../store/rewards.js';

/**
 * One passage: its words, as the chunks they are learnt in, where they are
 * from, and what can be done with it.
 */

const Passage = () => {
	const { id } = Route.useParams();
	const passage = usePassage(id);
	const measure = useRewards()?.measures.get(id);
	const notices = useNotices();
	const navigate = useNavigate();

	if (passage === undefined) return <main className="screen" aria-busy="true" />;
	if (passage === null) return <MissingPassage />;

	const remove = async () => {
		const removed = await deletePassage(db, passage.id);
		if (removed === undefined) return;
		await navigate({ to: '/library' });
		notices.offerUndo({
			message: t('passage.deleted', { title: removed.title }),
			undo: () => restorePassages(db, [removed]),
		});
	};

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
				<h1>{passage.title}</h1>
				<Link
					to="/edit/$id"
					params={{ id: passage.id }}
					className="icon-link"
					aria-label={t('passage.edit')}
					title={t('passage.edit')}
				>
					<Icon name="edit" />
				</Link>
				<button
					type="button"
					className="icon"
					aria-label={t('passage.delete')}
					title={t('passage.delete')}
					onClick={() => {
						void remove();
					}}
				>
					<Icon name="trash" />
				</button>
			</header>
			{passage.reference !== undefined && (
				<p className="passage-reference">{passage.reference}</p>
			)}
			{measure !== undefined && measure.mastery > 0 && (
				<p className="passage-measure">
					<MasteryBar measure={measure} />
				</p>
			)}
			<Link
				to="/practice/$id"
				params={{ id: passage.id }}
				className="button primary passage-practise"
			>
				<Icon name="play" />
				{t('passage.practise')}
			</Link>
			<ChunkedText source={passage.source} />
		</main>
	);
};

export const Route = createFileRoute('/passage/$id')({
	component: Passage,
	errorComponent: ErrorScreen,
});
