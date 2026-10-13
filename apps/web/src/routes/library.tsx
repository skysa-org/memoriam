import { type Measure } from '@memoriam/core';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';

import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { ConflictsBanner } from '../components/ConflictsBanner.js';
import { ErrorScreen } from '../components/ErrorScreen.js';
import { Icon } from '../components/Icon.js';
import { MasteryBar } from '../components/MasteryBar.js';
import { NameDialog } from '../components/NameDialog.js';
import { useNotices } from '../components/Notices.js';
import { t } from '../i18n/t.js';
import {
	createCollection,
	deleteCollection,
	renameCollection,
	restoreCollection,
} from '../store/collections.js';
import { db, type NoteRecord } from '../store/db.js';
import { useLibrary } from '../store/hooks.js';
import { collectionName, type CollectionView } from '../store/library.js';
import { useRewards } from '../store/rewards.js';

/** Every passage, in its collection (docs/ARCHITECTURE.md §2). */

const PassageList = ({
	passages,
	measures,
}: Readonly<{ passages: readonly NoteRecord[]; measures?: ReadonlyMap<string, Measure> }>) => (
	<ul className="passage-list">
		{passages.map((passage) => {
			const measure = measures?.get(passage.id);
			return (
				<li key={passage.id}>
					<Link to="/passage/$id" params={{ id: passage.id }} className="passage-row">
						<span className="passage-row-title">{passage.title}</span>
						{passage.reference !== undefined && (
							<span className="passage-row-reference">{passage.reference}</span>
						)}
						{measure !== undefined && measure.mastery > 0 && (
							<MasteryBar measure={measure} />
						)}
					</Link>
				</li>
			);
		})}
	</ul>
);

/** The dialog open over the list, if one is. */
type Asking =
	| Readonly<{ kind: 'create'; problem?: string }>
	| Readonly<{ kind: 'rename'; collection: CollectionView; problem?: string }>
	| Readonly<{ kind: 'delete'; collection: CollectionView }>;

const Library = () => {
	const library = useLibrary();
	const measures = useRewards()?.measures;
	const notices = useNotices();
	const [asking, setAsking] = useState<Asking | null>(null);
	const close = () => {
		setAsking(null);
	};

	const remove = async (collection: CollectionView) => {
		setAsking(null);
		const removed = await deleteCollection(db, collection.path);
		notices.offerUndo({
			message: t('library.deleted', { name: collection.name }),
			undo: () => restoreCollection(db, removed),
		});
	};

	if (library === undefined) return <main className="screen" aria-busy="true" />;

	return (
		<main className="screen">
			<header className="screen-header">
				<h1>{t('library.title')}</h1>
				<Link to="/new" search={{}} className="button primary">
					<Icon name="plus" />
					{t('library.newPassage')}
				</Link>
			</header>

			<ConflictsBanner />

			{library.count === 0 && library.collections.length === 0 && (
				<p className="empty">{t('library.empty')}</p>
			)}

			{library.unfiled.length > 0 && (
				<section className="collection" aria-label={t('library.unfiled')}>
					{library.collections.length > 0 && (
						<h2 className="collection-name">{t('library.unfiled')}</h2>
					)}
					<PassageList
						passages={library.unfiled}
						{...(measures === undefined ? {} : { measures })}
					/>
				</section>
			)}

			{library.collections.map((collection) => (
				<section key={collection.path} className="collection">
					<header className="collection-header">
						<h2 className="collection-name">{collection.name}</h2>
						<span className="collection-count">
							{t('library.passages', { count: collection.passages.length })}
						</span>
						<Link
							to="/new"
							search={{ collection: collection.path }}
							className="icon-link"
							aria-label={t('library.addTo', { name: collection.name })}
							title={t('library.addTo', { name: collection.name })}
						>
							<Icon name="plus" />
						</Link>
						<button
							type="button"
							className="icon"
							aria-label={t('library.rename', { name: collection.name })}
							title={t('library.rename', { name: collection.name })}
							onClick={() => {
								setAsking({ kind: 'rename', collection });
							}}
						>
							<Icon name="edit" />
						</button>
						<button
							type="button"
							className="icon"
							aria-label={t('library.delete', { name: collection.name })}
							title={t('library.delete', { name: collection.name })}
							onClick={() => {
								if (collection.passages.length === 0) {
									void remove(collection);
									return;
								}
								setAsking({ kind: 'delete', collection });
							}}
						>
							<Icon name="trash" />
						</button>
					</header>
					{collection.passages.length === 0 ? (
						<p className="empty">{t('library.collectionEmpty')}</p>
					) : (
						<PassageList
							passages={collection.passages}
							{...(measures === undefined ? {} : { measures })}
						/>
					)}
				</section>
			))}

			<button
				type="button"
				className="button ghost new-collection"
				onClick={() => {
					setAsking({ kind: 'create' });
				}}
			>
				<Icon name="folder" />
				{t('library.newCollection')}
			</button>

			{asking?.kind === 'create' && (
				<NameDialog
					title={t('library.create.title')}
					text={t('library.create.text')}
					label={t('library.create.label')}
					confirmLabel={t('library.create.confirm')}
					problem={asking.problem}
					onCancel={close}
					onConfirm={(name) => {
						void createCollection(db, name).then((named) => {
							setAsking(
								named.ok
									? null
									: {
											kind: 'create',
											problem: t('library.exists', {
												name: collectionName(named.path),
											}),
										}
							);
						});
					}}
				/>
			)}

			{asking?.kind === 'rename' && (
				<NameDialog
					title={t('library.renaming.title')}
					text={t('library.renaming.text')}
					label={t('library.renaming.label')}
					confirmLabel={t('library.renaming.confirm')}
					initial={asking.collection.name}
					problem={asking.problem}
					onCancel={close}
					onConfirm={(name) => {
						const { collection } = asking;
						void renameCollection(db, collection.path, name).then((named) => {
							setAsking(
								named.ok
									? null
									: {
											kind: 'rename',
											collection,
											problem: t('library.exists', {
												name: collectionName(named.path),
											}),
										}
							);
						});
					}}
				/>
			)}

			{asking?.kind === 'delete' && (
				<ConfirmDialog
					title={t('library.deleting.title', { name: asking.collection.name })}
					confirmLabel={t('library.deleting.confirm')}
					tone="danger"
					onCancel={close}
					onConfirm={() => {
						void remove(asking.collection);
					}}
				>
					{t('library.deleting.text', { count: asking.collection.passages.length })}
				</ConfirmDialog>
			)}
		</main>
	);
};

export const Route = createFileRoute('/library')({
	component: Library,
	errorComponent: ErrorScreen,
});
