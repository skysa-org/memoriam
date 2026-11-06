import { z } from 'zod';

import {
	applyAll,
	applyItem,
	arrivals,
	nodesOf,
	type Page,
	pageFrom,
	readTreeCursor,
	settlePage,
	treeCursorBase,
	type TreeItem,
} from '../idTree.js';
import {
	type ChangeEntry,
	type ChangeSet,
	CursorResetError,
	ProviderResponseError,
} from '../types.js';
import { clashes, createSeparate } from './duplicates.js';
import type { AppFolder } from './root.js';
import {
	type ChangeList,
	CHANGES,
	type DriveChange,
	type DriveClient,
	type DriveFailure,
	FIELDS,
	type FileList,
	FILES,
	isFolder,
	MAX_DEPTH,
	PAGE_SIZE,
	treeItemOf,
} from './wire.js';

/**
 * `drive` changes are about shared drives, which `drive.file` never reaches.
 * A `removed` change is "deletion or loss of access", and carries no file.
 */
const changeItem = (change: DriveChange): TreeItem[] => {
	if (change.changeType === 'drive') return [];
	const id = change.fileId ?? change.file?.id;
	if (id === undefined || id === '')
		throw new ProviderResponseError('gdrive sent a change with no file id');
	if (change.removed === true || change.file === undefined) return [{ id, gone: true }];
	return [treeItemOf({ ...change.file, id })];
};

// ---------------------------------------------------------------------------
// The cursor.
//
// A round from nothing is a scan — every file the app can see, by `files.list`
// — and every round after it follows the change feed. The start token is asked
// for *before* the scan, so a change made while the scan runs is reported
// again afterwards rather than missed. The tree travels with it (`idTree.ts`).
// ---------------------------------------------------------------------------

const cursorSchema = z.object({
	...treeCursorBase,
	phase: z.enum(['scan', 'feed']),
	/** The page to fetch: a `files.list` page token in a scan, a changes token after. */
	token: z.string(),
	/** Where the feed begins once the scan is done. */
	start: z.string().min(1),
});

type DriveCursor = z.infer<typeof cursorSchema>;

const parseCursor = (cursor: string): DriveCursor => readTreeCursor(cursorSchema, cursor, 'gdrive');

/**
 * On a token we stored, Drive's answer to one it cannot use is not documented.
 * A 404 or 410 is read as that, and so is a 400 that names the page token — in
 * its `location`, its reason or its message, since which of them Drive fills is
 * not documented either, and a dead token not recognised is a sync that fails
 * for ever. Any other 400 is a mistake in the request, and resetting over it
 * would rescan everything on every sync. On a round from nothing they are
 * failures like any other, since starting again would ask the same thing.
 */
const namesPageToken = (failure: DriveFailure): boolean =>
	failure.locations.includes('pageToken') ||
	[...failure.reasons, failure.message].some((text) => /page ?token/i.test(text));

const isDeadToken = (failure: DriveFailure, stored: boolean): boolean =>
	stored &&
	([404, 410].includes(failure.status) || (failure.status === 400 && namesPageToken(failure)));

interface Fetched {
	items: TreeItem[];
	roundEnds: boolean;
	/** The token the next page is fetched with. */
	next: string;
	/** The page says the app folder was trashed, or is out of reach. */
	rootGone: boolean;
}

/** `StorageProvider.changes`: a page of a scan or of the feed, read against the tree. */
export const createChanges = (client: DriveClient, appFolder: AppFolder, now: () => Date) => {
	const { attempt, call, raise, childrenOf } = client;
	const { establishRoot, confirmRoot, forget } = appFolder;
	const separate = createSeparate(client, now);

	const freshRound = async (): Promise<DriveCursor> => {
		const root = await establishRoot();
		const { startPageToken } = await call<{ startPageToken?: string }>(
			'GET',
			`${CHANGES}/startPageToken`
		);
		if (startPageToken === undefined || startPageToken === '') {
			throw new ProviderResponseError('gdrive sent no start page token');
		}
		return {
			v: 1,
			phase: 'scan',
			token: '',
			start: startPageToken,
			root,
			nodes: [],
			pending: [],
		};
	};

	const scanPage = async (from: DriveCursor, stored: boolean): Promise<Fetched> => {
		const params = new URLSearchParams({
			q: 'trashed = false',
			fields: `nextPageToken,files(${FIELDS})`,
			pageSize: PAGE_SIZE,
			spaces: 'drive',
			...(from.token === '' ? {} : { pageToken: from.token }),
		});
		const result = await attempt<FileList>('GET', `${FILES}?${params.toString()}`);
		if (!result.ok && isDeadToken(result.failure, stored && from.token !== '')) {
			throw new CursorResetError(result.failure.reasons.join('/') || result.failure.message);
		}
		if (!result.ok) return raise(result.failure);
		const next = result.value.nextPageToken;
		return {
			items: (result.value.files ?? []).map(treeItemOf),
			roundEnds: next === undefined,
			next: next ?? from.start,
			// A scan lists only what is not in the trash; a folder trashed
			// meanwhile is found by the next round.
			rootGone: false,
		};
	};

	const feedPage = async (from: DriveCursor, stored: boolean): Promise<Fetched> => {
		const params = new URLSearchParams({
			pageToken: from.token,
			pageSize: PAGE_SIZE,
			spaces: 'drive',
			includeRemoved: 'true',
			fields: `nextPageToken,newStartPageToken,changes(changeType,fileId,removed,file(${FIELDS}))`,
		});
		const result = await attempt<ChangeList>('GET', `${CHANGES}?${params.toString()}`);
		if (!result.ok && isDeadToken(result.failure, stored)) {
			throw new CursorResetError(result.failure.reasons.join('/') || result.failure.message);
		}
		if (!result.ok) return raise(result.failure);
		const next = result.value.nextPageToken ?? result.value.newStartPageToken;
		if (next === undefined || next === '') {
			throw new ProviderResponseError(
				'gdrive changes sent neither a next nor a new start token'
			);
		}
		const changes = result.value.changes ?? [];
		return {
			items: changes.flatMap(changeItem),
			roundEnds: result.value.nextPageToken === undefined,
			next,
			// From what Drive sent, not from the tree's reading of it, which also
			// takes a name no path can hold as gone: the folder is the root
			// whatever the user calls it.
			rootGone: changes.some(
				(change) =>
					(change.fileId ?? change.file?.id) === from.root &&
					(change.removed === true || change.file?.trashed === true)
			),
		};
	};

	/**
	 * Everything under a folder that has arrived from elsewhere, into the page.
	 * The feed reports a moved folder alone, and a folder moved back in from
	 * outside the app folder — or out from under one that was deleted — has
	 * contents the tree has forgotten, subfolders and all.
	 */
	const listInto = async (page: Page, folderId: string, depth: number): Promise<void> => {
		if (depth > MAX_DEPTH) return;
		const children = await childrenOf(folderId);
		children.forEach((child) => {
			applyItem(page, treeItemOf(child));
		});
		await children.filter(isFolder).reduce(async (done, child) => {
			await done;
			await listInto(page, child.id ?? '', depth + 1);
		}, Promise.resolve());
	};

	const changes = async (cursor?: string): Promise<ChangeSet> => {
		const stored = cursor !== undefined && cursor !== '';
		const from = stored ? parseCursor(cursor) : await freshRound();
		if (stored) await confirmRoot(from.root);

		const fetched =
			from.phase === 'scan' ? await scanPage(from, stored) : await feedPage(from, stored);
		// The app folder itself in the trash, or out of reach: nothing under it
		// can be placed, and the next round has to find or make another.
		if (fetched.rootGone) {
			forget();
			throw new CursorResetError('gdrive app folder is gone');
		}

		const page = pageFrom(from);
		applyAll(page, fetched.items);
		// A scan lists everything already, so only a feed round lists arrivals.
		if (from.phase === 'feed') {
			await arrivals(page).reduce(async (done, id) => {
				await done;
				await listInto(page, id, 0);
			}, Promise.resolve());
		}
		await clashes(page).reduce(async (done, clash) => {
			await done;
			await separate(page, clash);
		}, Promise.resolve());

		// Drive lists no parents, so a round's end means only what `settlePage`
		// asks once arrivals are listed: every ancestor of what the round
		// listed is in the tree. A parent it still does not know is outside the
		// app folder, or a folder the user made in Drive, which `drive.file`
		// cannot see — and either way the item has left.
		const settled = settlePage(page, fetched.roundEnds);
		const scanning = from.phase === 'scan' && !fetched.roundEnds;
		const written: DriveCursor = {
			v: 1,
			phase: scanning ? 'scan' : 'feed',
			token: fetched.next,
			start: from.start,
			root: from.root,
			nodes: nodesOf(page),
			pending: settled.pending,
		};
		const entries: ChangeEntry[] = settled.entries;
		return { entries, cursor: JSON.stringify(written), more: !fetched.roundEnds };
	};

	return changes;
};
