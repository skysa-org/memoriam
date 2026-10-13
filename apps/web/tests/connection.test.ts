import { chunkPassage, parsePassageFile, ROOT } from '@memoriam/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { importLibrary } from '../src/archive/importLibrary.js';
import {
	createCollection,
	deleteCollection,
	renameCollection,
	restoreCollection,
} from '../src/store/collections.js';
import {
	AlreadyBoundError,
	bindLibrary,
	boundConnection,
	unbindLibrary,
} from '../src/store/connection.js';
import {
	createDatabase,
	LOCAL_CONNECTION_ID,
	type MemoriamDatabase,
	type NoteRecord,
} from '../src/store/db.js';
import { deviceId } from '../src/store/device.js';
import { libraryView } from '../src/store/library.js';
import {
	createPassage,
	deletePassage,
	type PassageDetails,
	restorePassages,
	updatePassage,
} from '../src/store/passages.js';
import { recordPass } from '../src/store/practice.js';

/**
 * The library bound to a connection, and not (docs/ARCHITECTURE.md §10, "The
 * web store"): what each writer owes the remote, and what binding and
 * unbinding do to the rows.
 */

let db: MemoriamDatabase;

beforeEach(() => {
	db = createDatabase(`connection-${crypto.randomUUID()}`);
});

afterEach(async () => {
	await db.delete();
});

const DROPBOX = { connectionId: 'dropbox-1', provider: 'dropbox' } as const;

const PSALM: PassageDetails = {
	title: 'Psalm 23',
	reference: '',
	collection: ROOT,
	text: 'The Lord is my shepherd; I shall not want.\n',
};

const inPsalms = (title: string): PassageDetails => ({
	title,
	reference: '',
	collection: 'Psalms',
	text: `${title}, the words.\n`,
});

/** What is queued, as `op path → target`, in order. */
const queued = async (): Promise<string[]> =>
	(await db.opQueue.orderBy('seq').toArray()).map(
		(op) => `${op.op} ${op.path}${op.targetPath === undefined ? '' : ` → ${op.targetPath}`}`
	);

const row = (id: string) => db.notes.get([LOCAL_CONNECTION_ID, id]);

/** As a sync leaves a passage: sent, and clean. */
const sent = async (note: NoteRecord, remoteId = `r-${note.id}`): Promise<void> => {
	await db.notes.update([LOCAL_CONNECTION_ID, note.id], {
		remoteId,
		remoteVersion: 'v1',
		dirty: 0,
	});
	await db.opQueue.clear();
};

describe('a library bound to nothing', () => {
	it('owes nothing, and a delete takes the row', async () => {
		const made = await createPassage(db, PSALM);
		await updatePassage(db, made.id, { ...PSALM, text: 'Changed.\n' });
		await createCollection(db, 'Hymns');
		expect(await db.opQueue.count()).toBe(0);

		await deletePassage(db, made.id);
		expect(await row(made.id)).toBeUndefined();
	});
});

describe('binding the library', () => {
	it('queues the whole of it for the remote, a collection at a time', async () => {
		await createPassage(db, PSALM);
		await createPassage(db, inPsalms('Psalm 1'));
		await createCollection(db, 'Hymns');

		const state = await bindLibrary(db, DROPBOX, 7);

		expect(state).toMatchObject({ ...DROPBOX, boundAt: 7, clientId: await deviceId(db) });
		expect(await queued()).toEqual([
			'write psalm-23.md',
			'mkdir Hymns',
			'mkdir Psalms',
			'write Psalms/psalm-1.md',
		]);
		expect((await db.notes.toArray()).every((note) => note.dirty === 1)).toBe(true);
	});

	it('does nothing bound to the same connection, and refuses another', async () => {
		await bindLibrary(db, DROPBOX);
		await bindLibrary(db, DROPBOX);
		expect(await db.syncState.count()).toBe(1);
		await expect(
			bindLibrary(db, { connectionId: 'gdrive-1', provider: 'gdrive' })
		).rejects.toBeInstanceOf(AlreadyBoundError);
	});
});

describe('a library bound to a connection', () => {
	beforeEach(async () => {
		await bindLibrary(db, DROPBOX);
	});

	it('owes a write for a passage made or edited, once however many times', async () => {
		const made = await createPassage(db, inPsalms('Psalm 1'));
		await updatePassage(db, made.id, { ...inPsalms('Psalm 1'), text: 'Blessed.\n' });
		expect(await queued()).toEqual(['mkdir Psalms', 'write Psalms/psalm-1.md']);
	});

	it('owes a move for a passage sent and renamed, and none for one never sent', async () => {
		const made = await createPassage(db, PSALM);
		await updatePassage(db, made.id, { ...PSALM, title: 'The Lord' });
		// One write, made wherever the passage is when it goes.
		expect(await queued()).toEqual(['write psalm-23.md']);

		await sent((await row(made.id)) ?? made);
		await updatePassage(db, made.id, { ...PSALM, title: 'Psalm 23' });
		expect(await queued()).toEqual(['move the-lord.md → psalm-23.md', 'write psalm-23.md']);
	});

	it('keeps a deleted passage as a tombstone, owed its delete, until undone', async () => {
		const made = await createPassage(db, PSALM);
		await sent(made);
		await updatePassage(db, made.id, { ...PSALM, text: 'Changed.\n' });

		const deleted = await deletePassage(db, made.id);
		expect(await row(made.id)).toMatchObject({ deletedLocally: 1, remoteId: `r-${made.id}` });
		expect(await queued()).toEqual(['delete psalm-23.md']);
		expect(libraryView(await db.notes.toArray(), []).count).toBe(0);
		// Its name is free at once.
		expect((await createPassage(db, PSALM)).path).toBe('psalm-23.md');

		await restorePassages(db, deleted === undefined ? [] : [deleted]);
		// Back where its file is, and the passage made at its name meanwhile,
		// never sent, beside it.
		expect(await row(made.id)).toMatchObject({ deletedLocally: 0, path: 'psalm-23.md' });
		expect(
			(await db.notes.toArray())
				.filter((note) => note.id !== made.id)
				.map((note) => note.path)
		).toEqual(['psalm-23-2.md']);
		expect(await queued()).toEqual(['write psalm-23.md', 'write psalm-23.md']);
	});

	it('brings back a passage whose delete has been sent, cut loose from the file it removed', async () => {
		const made = await createPassage(db, PSALM);
		await sent(made);
		const deleted = await deletePassage(db, made.id);
		await db.notes.delete([LOCAL_CONNECTION_ID, made.id]);
		await db.opQueue.clear();

		await restorePassages(db, deleted === undefined ? [] : [deleted]);
		const back = await row(made.id);
		expect(back).toMatchObject({ deletedLocally: 0, dirty: 1 });
		expect(back).not.toHaveProperty('remoteId');
		expect(await queued()).toEqual(['write psalm-23.md']);
	});

	it('keeps what a pull wrote into a tombstone, and the text deleted beside it', async () => {
		const made = await createPassage(db, PSALM);
		await sent(made);
		const deleted = await deletePassage(db, made.id);
		const theirs = made.source.replace('I shall not want', 'I lack nothing');
		await db.notes.update([LOCAL_CONNECTION_ID, made.id], { source: theirs });

		await restorePassages(db, deleted === undefined ? [] : [deleted]);
		expect(await row(made.id)).toMatchObject({ source: theirs, path: 'psalm-23.md' });
		const copy = (await db.notes.toArray()).find((note) => note.id !== made.id);
		expect(copy).toMatchObject({
			source: made.source.replace(made.id, copy?.id ?? ''),
			path: 'psalm-23-2.md',
			deletedLocally: 0,
		});
		expect(copy).not.toHaveProperty('remoteId');
	});

	it('merges the progress a pull wrote into a tombstone with what was deleted', async () => {
		const made = await createPassage(db, PSALM);
		await sent(made);
		const [key = ''] =
			chunkPassage(parsePassageFile(made.source).body, 1)?.chunks.map((chunk) => chunk.key) ??
			[];
		const deleted = await deletePassage(db, made.id);
		const practised = made.source.replace(
			'chunker: 1\n',
			`chunker: 1\nprogress:\n  ${key}: { level: 3, reviewed: 2026-10-13T09:00:00Z }\n`
		);
		await db.notes.update([LOCAL_CONNECTION_ID, made.id], { source: practised });

		await restorePassages(db, deleted === undefined ? [] : [deleted]);
		expect(await db.notes.count()).toBe(1);
		expect((await row(made.id))?.source).toBe(practised);
	});

	it('moves a renamed collection passage by passage, then removes the directory it left', async () => {
		const one = await createPassage(db, inPsalms('Psalm 1'));
		const two = await createPassage(db, inPsalms('Psalm 2'));
		await sent(one);
		await sent(two);
		await db.folders.update([LOCAL_CONNECTION_ID, 'Psalms'], { remoteId: 'd-psalms' });
		await deletePassage(db, two.id);
		await db.files.put({
			connectionId: LOCAL_CONNECTION_ID,
			id: 'f1',
			path: 'Psalms/notes.pdf',
			remoteId: 'r-f1',
			size: 1,
		});

		await renameCollection(db, 'Psalms', 'Songs');

		expect(await queued()).toEqual([
			'delete Psalms/psalm-2.md',
			'mkdir Songs',
			'move-file Psalms/notes.pdf → Songs/notes.pdf',
			'move Psalms/psalm-1.md → Songs/psalm-1.md',
			'move Psalms/psalm-2.md → Songs/psalm-2.md',
			'rmdir Psalms',
		]);
		expect(await row(one.id)).toMatchObject({ path: 'Songs/psalm-1.md', dirty: 0 });
	});

	it('deletes a collection passage by passage, leaves the files beside them, and undoes it', async () => {
		const one = await createPassage(db, inPsalms('Psalm 1'));
		await sent(one);
		await db.folders.update([LOCAL_CONNECTION_ID, 'Psalms'], { remoteId: 'd-psalms' });
		await db.files.put({
			connectionId: LOCAL_CONNECTION_ID,
			id: 'f1',
			path: 'Psalms/notes.pdf',
			remoteId: 'r-f1',
			size: 1,
		});

		const removed = await deleteCollection(db, 'Psalms');
		expect(await queued()).toEqual(['delete Psalms/psalm-1.md', 'rmdir Psalms']);
		expect(await db.files.count()).toBe(1);

		await restoreCollection(db, removed);
		expect(await queued()).toEqual(['mkdir Psalms', 'write Psalms/psalm-1.md']);
		expect(await row(one.id)).toMatchObject({ deletedLocally: 0 });
	});

	it('owes one write however many passes are recorded before it goes', async () => {
		const made = await createPassage(db, PSALM);
		await sent(made);
		const [key = ''] =
			chunkPassage(parsePassageFile(made.source).body, 1)?.chunks.map((chunk) => chunk.key) ??
			[];
		const pass = (level: number) =>
			recordPass(db, {
				id: made.id,
				key,
				device: 'here',
				update: () => ({ level, reviewed: '2026-10-13T09:00:00Z' }),
				activity: { words: 8, passes: 1, reviews: 0, ms: 1000 },
			});
		await pass(1);
		await pass(2);
		expect(await queued()).toEqual(['write psalm-23.md', 'write .memoriam/activity-2026.md']);
	});

	it('records nothing for a passage deleted meanwhile', async () => {
		const made = await createPassage(db, PSALM);
		await deletePassage(db, made.id);
		expect(
			await recordPass(db, {
				id: made.id,
				key: 'k',
				device: 'here',
				update: () => ({ level: 1 }),
				activity: { words: 1, passes: 1, reviews: 0, ms: 1 },
			})
		).toEqual({ ok: false, reason: 'missing' });
	});

	it('queues what a backup brings in, a collection at a time', async () => {
		await importLibrary(db, {
			files: [
				{ path: 'Psalms/one.md', text: '---\ntitle: One\n---\n\nOne.\n' },
				{ path: 'two.md', text: '---\ntitle: Two\n---\n\nTwo.\n' },
			],
			folders: ['Empty'],
			skipped: 0,
			unreadable: [],
		});
		expect(await queued()).toEqual([
			'write two.md',
			'mkdir Empty',
			'mkdir Psalms',
			'write Psalms/one.md',
		]);
	});
});

describe('unbinding the library', () => {
	it('cuts every passage loose and keeps it, and forgets what was owed', async () => {
		await bindLibrary(db, DROPBOX);
		const kept = await createPassage(db, inPsalms('Psalm 1'));
		const gone = await createPassage(db, PSALM);
		await sent(kept);
		await sent(gone);
		await db.folders.update([LOCAL_CONNECTION_ID, 'Psalms'], { remoteId: 'd-psalms' });
		await db.files.put({
			connectionId: LOCAL_CONNECTION_ID,
			id: 'f1',
			path: 'Psalms/notes.pdf',
			remoteId: 'r-f1',
			size: 1,
		});
		await deletePassage(db, gone.id);

		await unbindLibrary(db);

		expect(await boundConnection(db)).toBeUndefined();
		expect(await db.opQueue.count()).toBe(0);
		expect(await db.files.count()).toBe(0);
		expect((await db.notes.toArray()).map((note) => note.id)).toEqual([kept.id]);
		expect(await row(kept.id)).not.toHaveProperty('remoteId');
		expect(await db.folders.get([LOCAL_CONNECTION_ID, 'Psalms'])).not.toHaveProperty(
			'remoteId'
		);

		// And owes nothing again until it is bound.
		await updatePassage(db, kept.id, { ...inPsalms('Psalm 1'), text: 'Again.\n' });
		expect(await db.opQueue.count()).toBe(0);
	});
});
