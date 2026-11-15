import { describe, expect, it } from 'vitest';

import { syncWorld } from '../kit/world.js';

/**
 * The hidden folder a round meets that the app keeps, `.memoriam/`, and what
 * the engine makes of it and of every other hidden path (`unsynced`).
 */
const { world, remoteFile, noteAt } = syncWorld();

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
