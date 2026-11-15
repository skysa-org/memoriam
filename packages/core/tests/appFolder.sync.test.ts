import type { SyncProgress } from '@skysa/sync';
import { syncWorld } from '@skysa/sync/testing';
import { describe, expect, it } from 'vitest';

import { syncsHidden } from '../src/appFolder.js';
import { PASSAGE_FORMAT } from '../src/markdown/format.js';
import { entryAt } from './sync/remote.js';

/**
 * The hidden folder a round meets that the app keeps, `.memoriam/`, and what
 * the engine makes of it and of every other hidden path, handed this app's
 * rule (`syncsHidden`) and its documents. The engine's own tests run with no
 * app's (the kit's `packages/sync/tests/engine/hiddenFolders.test.ts`); these
 * are this app's.
 */
const { world, engineWith, pullNow, remoteFile, noteAt, pulledNote } = syncWorld(PASSAGE_FORMAT, {
	syncsHidden,
});

describe("the app's own folder", () => {
	// `.memoriam/` (docs/ARCHITECTURE.md §10): hidden from the library's lists
	// by its dot, but the year's activity files in it are synced as any passage
	// is. Anything else in it, and every other hidden path, is passed over.
	const ACTIVITY = '.memoriam/activity-2026.md';

	it('brings an activity file and its folder in', async () => {
		await world.provider.createFolder('.memoriam');
		await remoteFile(ACTIVITY, '---\ndays: {}\n---\n');

		const result = await world.engine.pull();

		expect(result.status).toBe('ok');
		expect(noteAt(ACTIVITY)?.content).toBe('---\ndays: {}\n---\n');
		expect(world.store.folders().map((folder) => folder.path)).toEqual(['.memoriam']);
	});

	it('sends one written here', async () => {
		world.store.put({ id: 'n1', path: ACTIVITY, content: 'mine\n', dirty: true });
		world.store.queue({ op: 'write', noteId: 'n1', path: ACTIVITY });

		expect((await world.engine.push()).status).toBe('ok');
		expect(world.provider.contentAt(ACTIVITY)).toBe('mine\n');
		expect(noteAt(ACTIVITY)?.dirty).toBe(false);
	});

	it('deletes an activity file here when it is deleted on the remote', async () => {
		// The deletion filter asks `syncsHidden`, not only `isHidden`: the activity
		// file is hidden but synced, so its deletion is news like a passage's.
		await world.provider.createFolder('.memoriam');
		await pulledNote(ACTIVITY, '---\ndays: {}\n---\n');
		await world.provider.delete(entryAt(world.provider, ACTIVITY));

		const result = await world.engine.pull();

		expect(result).toMatchObject({ status: 'ok', pulled: 1 });
		expect(noteAt(ACTIVITY)).toBeUndefined();
	});

	it("passes over another hidden file's deletion", async () => {
		// A row at a hidden path the engine would never have made, and a
		// deletion with no id that names its path: acted on, it would go.
		world.store.put({ id: 'n1', path: '.memoriam/notes.md', content: 'kept\n' });

		const result = await pullNow([{ path: '.memoriam/notes.md', deleted: true }]);

		expect(result).toMatchObject({ status: 'ok', pulled: 0 });
		expect(noteAt('.memoriam/notes.md')?.content).toBe('kept\n');
	});

	it('counts an activity file among the notes it reads, and no other hidden file', async () => {
		// What the import dialog counts asks `isNoteEntry`, which asks
		// `syncsHidden`: the activity file is one of the notes found, and the
		// other markdown file in the folder is not.
		await world.provider.createFolder('.memoriam');
		await remoteFile(ACTIVITY, '---\ndays: {}\n---\n');
		await remoteFile('.memoriam/notes.md', 'x\n');
		const said: SyncProgress[] = [];

		await engineWith({ onProgress: (progress) => said.push(progress) }).pull();

		expect(said.at(-1)).toEqual({ stage: 'scanning', found: 1, done: 1, listing: false });
	});

	it("keeps the app's own folder and its activity files, which sync though hidden", async () => {
		// What a batch lists of a scan (the kit's `unhidden` in `pull/batch.ts`),
		// handed this app's rule: the folder and the year's activity, and not
		// the other file beside them.
		await world.provider.createFolder('.memoriam');
		await remoteFile(ACTIVITY, '---\ndays: {}\n---\n');
		await remoteFile('.memoriam/other.md', 'x\n');

		expect((await world.engine.pull()).status).toBe('ok');
		expect(world.store.notes().map((note) => note.path)).toEqual([ACTIVITY]);
		expect(world.store.folders().map((folder) => folder.path)).toEqual(['.memoriam']);
	});

	it('passes over anything else in it, and every other hidden folder', async () => {
		await world.provider.createFolder('.memoriam');
		await remoteFile('.memoriam/notes.md', 'x\n');
		await remoteFile('.memoriam/activity-26.md', 'x\n');
		await world.provider.createFolder('.clipboard');
		await world.provider.createFile(
			'.clipboard/copied.txt',
			new TextEncoder().encode('copied')
		);
		await remoteFile('.clipboard/a.md', 'x\n');

		const result = await world.engine.pull();

		// The one change pulled is the app's folder itself.
		expect(result).toMatchObject({ status: 'ok', pulled: 1 });
		expect(world.store.notes()).toEqual([]);
		expect(world.store.files()).toEqual([]);
		expect(world.store.folders().map((folder) => folder.path)).toEqual(['.memoriam']);
	});
});
