import type { RemoteEntry } from '@skysa/storage';
import type { FakeProvider } from '@skysa/storage/testing';
import type { SyncNote } from '@skysa/sync';
import type { MemoryStore } from '@skysa/sync/testing';

/**
 * What these tests do to a remote and to a device's store, as the kit's own
 * engine tests do it (its `tests/kit/remote.ts` and `userActions.ts`), which
 * it keeps to itself.
 */

/** What the remote holds at a path, for a test that cannot go on without it. */
export const entryAt = (provider: FakeProvider, path: string): RemoteEntry => {
	const found = provider.snapshot().find((entry) => entry.path === path);
	if (found === undefined) throw new Error(`nothing on the remote at ${path}`);
	return found;
};

/** The user's edit. */
export const editHere = (store: MemoryStore, note: SyncNote, content: string): void => {
	store.put({ ...note, content, dirty: true });
	store.queue({ op: 'write', noteId: note.id, path: note.path });
};

/** The user's rename of a note that has a file. */
export const renameHere = (store: MemoryStore, note: SyncNote, to: string): void => {
	store.put({ ...note, path: to });
	store.queue({ op: 'move', noteId: note.id, path: note.path, targetPath: to });
};
