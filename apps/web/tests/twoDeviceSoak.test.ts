import {
	chunkPassage,
	createFakeProvider,
	createSyncEngine,
	type FakeProvider,
	foldName,
	isHidden,
	isWithin,
	mergeFile,
	parentPath,
	parsePassageFile,
	randoms,
	readProgress,
	ROOT,
	type StorageProvider,
	type SyncEngine,
	type SyncOutcome,
} from '@memoriam/core';
import { afterEach, describe, expect, it } from 'vitest';

import { createCollection, deleteCollection, renameCollection } from '../src/store/collections.js';
import { bindLibrary } from '../src/store/connection.js';
import { createDatabase, isLive, type MemoriamDatabase, type NoteRecord } from '../src/store/db.js';
import {
	createPassage,
	deletePassage,
	keptText,
	passageText,
	restorePassages,
	updatePassage,
} from '../src/store/passages.js';
import { recordPass } from '../src/store/practice.js';
import { createDexieSyncStore } from '../src/sync/store.js';

/**
 * Two devices sharing one remote, each with its own database, web store and
 * engine, driven at random from a seed (docs/ARCHITECTURE.md §10). Passages are
 * made, edited, retitled, moved, deleted and put back, and practised;
 * collections are made, renamed and deleted; and each device syncs now and
 * then, sometimes with a device carrying on while one of its pushes is in
 * flight. At the end the two sync in turn until nothing moves, and then:
 * - they hold the same passages, and so does the remote;
 * - neither owes the remote anything;
 * - the last words each device gave a passage nobody deleted are still a
 *   passage's words on both, unless somebody edited them since;
 * - the last pass on a passage nobody deleted is still in some passage's
 *   progress on both, unless somebody edited the words it was held in.
 *
 * Words are never given twice, and every pass has an instant of its own, so
 * either is found wherever it is kept: in the passage, or in a conflict copy.
 *
 * Which passage a row is can change under it. A passage made here that meets
 * another at its path on the remote keeps its row, and its id, for the
 * remote's file, whose own `id` is the other passage's; its words go to a
 * conflict copy. So the test counts a row's id and its file's `id` as one
 * passage, wherever it has seen them together.
 *
 * A failure prints the seed's trace, every step and what each sync did, and
 * what each side holds at the end.
 */

const CONNECTION = 'dropbox-1';
const START = Date.parse('2026-10-13T08:00:00Z');
/** The app's own folder on the remote, which the activity files sync in. */
const APP_FOLDER = '.memoriam';

const SEEDS = 12;
const STEPS = 40;
/** Rounds of A then B at the end, at most, for two in a row to change nothing. */
const ROUNDS = 10;
/** Few titles and collection names, so names collide. */
const TITLES = ['Plan', 'Psalm', 'Creed', 'Ode'];
const COLLECTIONS = ['Psalms', 'Gospels', 'Poems'];
const OPERATIONS = ['write', 'move', 'delete'] as const;

type Operation = (typeof OPERATIONS)[number];

type Kind =
	| 'create'
	| 'edit'
	| 'retitle'
	| 'move'
	| 'delete'
	| 'pass'
	| 'addCollection'
	| 'renameCollection'
	| 'deleteCollection'
	| 'sync';

/** How often each step is chosen, against the others. */
const STEP_WEIGHTS: readonly (readonly [Kind | 'syncInFlight', number])[] = [
	['create', 5],
	['edit', 4],
	['retitle', 2],
	['move', 2],
	['delete', 2],
	['pass', 4],
	['addCollection', 1],
	['renameCollection', 1],
	['deleteCollection', 1],
	['sync', 6],
	['syncInFlight', 2],
];

/** What a device does while its own push is in flight: anything but a sync. */
const WRITER_WEIGHTS = STEP_WEIGHTS.flatMap(([kind, weight]) =>
	kind === 'sync' || kind === 'syncInFlight' ? [] : [[kind, weight] as const]
);

interface Device {
	readonly name: 'A' | 'B';
	readonly db: MemoriamDatabase;
	readonly engine: SyncEngine;
	/** An engine over the same store, for a provider wrapped by `inFlight`. */
	readonly over: (provider: StorageProvider) => SyncEngine;
}

/** Words a step gave a passage, making it or editing it. */
interface Given {
	readonly device: Device['name'];
	readonly id: string;
	readonly words: string;
}

/** A pass a step recorded, on a passage's first chunk. */
interface Pass {
	readonly id: string;
	readonly key: string;
	readonly level: number;
	readonly reviewed: string;
}

/** One seed's run: the devices, and what the test knows of what they did. */
interface Soak {
	readonly fake: FakeProvider;
	readonly devices: readonly [Device, Device];
	readonly next: () => number;
	readonly counters: Map<string, number>;
	readonly log: Map<number, string>;
	/** Every passage a step made, with the order it was made in. */
	readonly known: Map<string, number>;
	/** Ids seen naming one passage, a row's and its file's, as a union-find forest. */
	readonly same: Map<string, string>;
	/** Words given, in order. */
	readonly given: Map<number, Given>;
	/** Passes recorded, in order. */
	readonly passes: Map<number, Pass>;
	/** Passages a device deleted and did not put back at once. */
	readonly deleted: Set<string>;
	/** Words a device edited away, or deleted: nobody's to keep. */
	readonly dropped: Set<string>;
	/** Passes, by instant, held in words a device edited away or deleted. */
	readonly droppedPasses: Set<string>;
	/** What an action fired while a push was in flight threw. */
	readonly errors: Map<number, string>;
}

const opened: MemoriamDatabase[] = [];

afterEach(async () => {
	await Promise.all(opened.splice(0).map((db) => db.delete()));
});

/** Every file on the remote, by path, leaving out the app's own. */
const remoteFiles = (fake: FakeProvider) =>
	Object.fromEntries(
		fake
			.snapshot()
			.filter((entry) => entry.kind === 'file' && !isHidden(entry.path))
			.map((entry) => [entry.path, fake.contentAt(entry.path)])
	);

/** Every live passage. */
const liveRows = async (db: MemoriamDatabase): Promise<NoteRecord[]> =>
	(await db.notes.toArray()).filter((note) => isLive(note) && !isHidden(note.path));

/** Every live passage, by path, as its file. */
const localFiles = async (db: MemoriamDatabase) =>
	Object.fromEntries((await liveRows(db)).map((note) => [note.path, note.source]));

/** The app's own files that sync, the activity files, as a device holds them. */
const activityFiles = async (db: MemoriamDatabase) =>
	Object.fromEntries(
		(await db.notes.toArray())
			.filter((note) => isLive(note) && isWithin(note.path, APP_FOLDER))
			.map((note) => [note.path, note.source])
	);

const remoteActivityFiles = (fake: FakeProvider) =>
	Object.fromEntries(
		fake
			.snapshot()
			.filter((entry) => entry.kind === 'file' && isWithin(entry.path, APP_FOLDER))
			.map((entry) => [entry.path, fake.contentAt(entry.path)])
	);

/**
 * The provider, with `action` run the first time `operation` has reached the
 * remote and before the engine hears back, as in `pushQueue.test.ts`.
 */
const inFlight = (
	fake: FakeProvider,
	operation: Operation,
	action: () => Promise<unknown>
): StorageProvider => {
	const fired = new Set<string>();
	const once = async () => {
		if (fired.has(operation)) return;
		fired.add(operation);
		await action();
	};
	return {
		...fake,
		write: async (path, content, options) => {
			const entry = await fake.write(path, content, options);
			if (operation === 'write') await once();
			return entry;
		},
		move: async (entry, target) => {
			const moved = await fake.move(entry, target);
			if (operation === 'move') await once();
			return moved;
		},
		delete: async (entry) => {
			await fake.delete(entry);
			if (operation === 'delete') await once();
		},
	};
};

const bump = (counters: Map<string, number>, name: string): number => {
	const value = (counters.get(name) ?? 0) + 1;
	counters.set(name, value);
	return value;
};

const count = (soak: Soak, name: string): number => bump(soak.counters, name);

/** The clock, a second on for every action, so that every pass is later than the last. */
const tick = (soak: Soak): number => START + count(soak, 'clock') * 1000;

const note = (soak: Soak, line: string): void => {
	soak.log.set(soak.log.size, line);
};

const pick = <T>(soak: Soak, items: readonly T[]): T | undefined =>
	items[Math.floor(soak.next() * items.length)];

const weighted = <K>(soak: Soak, table: readonly (readonly [K, number])[]): K | undefined => {
	const total = table.reduce((sum, [, weight]) => sum + weight, 0);
	const roll = soak.next() * total;
	const reaches = table.map(
		([kind], at) =>
			[kind, table.slice(0, at + 1).reduce((sum, [, weight]) => sum + weight, 0)] as const
	);
	return reaches.find(([, upTo]) => roll < upTo)?.[0];
};

const other = (soak: Soak, device: Device): Device =>
	soak.devices[0] === device ? soak.devices[1] : soak.devices[0];

/** The `id` a row's file gives, which is not always the row's. */
const fileId = (row: NoteRecord): string | undefined => parsePassageFile(row.source).id;

/** The passage an id names, as far as the test has seen. */
const root = (soak: Soak, id: string): string => {
	const up = soak.same.get(id);
	return up === undefined ? id : root(soak, up);
};

/** A row's id and its file's are one passage. */
const join = (soak: Soak, row: NoteRecord): void => {
	const id = fileId(row);
	if (id === undefined) return;
	const [mine, its] = [root(soak, row.id), root(soak, id)];
	if (mine !== its) soak.same.set(mine, its);
};

/** Every row's id joined to its file's, on both devices. */
const observe = async (soak: Soak): Promise<void> => {
	const rows = await Promise.all(soak.devices.map((each) => each.db.notes.toArray()));
	rows.flat()
		.filter((row) => !isHidden(row.path))
		.forEach((row) => {
			join(soak, row);
		});
};

/** A passage as the trace names it: `p3`, the fourth made; `copy` for anything else. */
const label = (soak: Soak, id: string): string => {
	const order = soak.known.get(id);
	return order === undefined ? 'copy' : `p${String(order)}`;
};

/** Words no step has given before, numbered for the trace. */
const freshWords = (soak: Soak): string => {
	const at = count(soak, 'words');
	return `Verse ${String(at)} speaks of the light.\n\nVerse ${String(at)} speaks of the rain.\n`;
};

const wordsLabel = (words: string): string => `w${/Verse (\d+)/.exec(words)?.[1] ?? '?'}`;

/** The instants of every pass a row's progress holds. */
const passesIn = (row: NoteRecord): string[] =>
	[...readProgress(parsePassageFile(row.source).progress).chunks.values()].flatMap((entry) =>
		entry.reviewed === undefined ? [] : [entry.reviewed]
	);

/** The words a row held, and the passes in them, are edited away. */
const editedAway = (soak: Soak, row: NoteRecord): void => {
	join(soak, row);
	soak.dropped.add(passageText(row.source));
	passesIn(row).forEach((reviewed) => soak.droppedPasses.add(reviewed));
};

/** A row the user deleted: its passage, and what it held. */
const deletedRow = (soak: Soak, row: NoteRecord): void => {
	editedAway(soak, row);
	soak.deleted.add(row.id);
};

/** The passages a step may act on: those steps made, never a conflict copy. */
const passagesOf = async (soak: Soak, device: Device): Promise<NoteRecord[]> =>
	(await liveRows(device.db))
		.filter((row) => soak.known.has(row.id))
		.sort((a, b) => (soak.known.get(a.id) ?? 0) - (soak.known.get(b.id) ?? 0));

/** Every collection the device has: its rows, and the folders passages are in. */
const collectionsOf = async (device: Device): Promise<string[]> => {
	const folders = (await device.db.folders.toArray()).map((folder) => folder.path);
	const parents = (await liveRows(device.db)).map((row) => parentPath(row.path));
	return [...new Set([...folders, ...parents])]
		.filter((path) => path !== ROOT && !isHidden(path))
		.sort();
};

const otherTitle = (soak: Soak, title: string): string =>
	pick(
		soak,
		TITLES.filter((each) => each !== title)
	) ?? title;

const create = async (soak: Soak, device: Device): Promise<void> => {
	const text = freshWords(soak);
	const title = pick(soak, TITLES) ?? '';
	const collection = soak.next() < 0.5 ? ROOT : (pick(soak, await collectionsOf(device)) ?? ROOT);
	const made = await createPassage(
		device.db,
		{ title, reference: '', collection, text },
		{},
		tick(soak)
	);
	soak.known.set(made.id, soak.known.size);
	soak.given.set(soak.given.size, { device: device.name, id: made.id, words: keptText(text) });
	note(soak, `${device.name} create ${label(soak, made.id)} ${wordsLabel(text)} at ${made.path}`);
};

/** A step on one of the device's passages; one makes a passage where it has none. */
const onPassage =
	(change: (soak: Soak, device: Device, row: NoteRecord) => Promise<void>) =>
	async (soak: Soak, device: Device): Promise<void> => {
		const row = pick(soak, await passagesOf(soak, device));
		if (row === undefined) return create(soak, device);
		return change(soak, device, row);
	};

const edit = onPassage(async (soak, device, row) => {
	const text = freshWords(soak);
	const title = soak.next() < 0.5 ? row.title : otherTitle(soak, row.title);
	const edited = await updatePassage(
		device.db,
		row.id,
		{ title, reference: row.reference ?? '', collection: parentPath(row.path), text },
		{},
		tick(soak)
	);
	const at = edited.ok ? edited.passage.path : `refused (${edited.reason})`;
	const before = wordsLabel(passageText(row.source));
	note(
		soak,
		`${device.name} edit ${label(soak, row.id)} ${before} to ${wordsLabel(text)}, "${title}": ${at}`
	);
	if (!edited.ok) return;
	editedAway(soak, row);
	soak.given.set(soak.given.size, { device: device.name, id: row.id, words: keptText(text) });
});

/** The same words, under other details. */
const redetail = async (
	soak: Soak,
	device: Device,
	row: NoteRecord,
	{ title, collection }: Readonly<{ title: string; collection: string }>
): Promise<string> => {
	const edited = await updatePassage(
		device.db,
		row.id,
		{ title, reference: row.reference ?? '', collection, text: passageText(row.source) },
		{},
		tick(soak)
	);
	return edited.ok ? edited.passage.path : `refused (${edited.reason})`;
};

const retitle = onPassage(async (soak, device, row) => {
	const title = otherTitle(soak, row.title);
	const at = await redetail(soak, device, row, { title, collection: parentPath(row.path) });
	note(soak, `${device.name} retitle ${label(soak, row.id)} "${title}": ${row.path} to ${at}`);
});

const move = onPassage(async (soak, device, row) => {
	const here = foldName(parentPath(row.path));
	const targets = [...new Set([ROOT, ...(await collectionsOf(device)), ...COLLECTIONS])].filter(
		(path) => foldName(path) !== here
	);
	const collection = pick(soak, targets) ?? ROOT;
	const at = await redetail(soak, device, row, { title: row.title, collection });
	note(soak, `${device.name} move ${label(soak, row.id)}: ${row.path} to ${at}`);
});

const remove = onPassage(async (soak, device, row) => {
	const gone = await deletePassage(device.db, row.id);
	if (gone === undefined) {
		note(soak, `${device.name} delete ${label(soak, row.id)}: missing`);
		return;
	}
	if (soak.next() < 0.4) {
		await restorePassages(device.db, [gone], tick(soak));
		note(soak, `${device.name} delete ${label(soak, row.id)} at ${row.path}, and undo it`);
		return;
	}
	deletedRow(soak, gone);
	note(soak, `${device.name} delete ${label(soak, row.id)} at ${row.path}`);
});

/** A pass on the passage's first chunk, as `practise` in `pushQueue.test.ts`. */
const pass = onPassage(async (soak, device, row) => {
	const [key] =
		chunkPassage(parsePassageFile(row.source).body, 1)?.chunks.map((chunk) => chunk.key) ?? [];
	if (key === undefined) return;
	const at = tick(soak);
	const entry = {
		level: 1 + Math.floor(soak.next() * 5),
		reviewed: new Date(at).toISOString().replace('.000Z', 'Z'),
	};
	const recorded = await recordPass(
		device.db,
		{
			id: row.id,
			key,
			device: device.name,
			update: () => entry,
			activity: { words: 3, passes: 1, reviews: 0, ms: 1000 },
		},
		{},
		new Date(at)
	);
	const outcome = recorded.ok ? '' : `: refused (${recorded.reason})`;
	note(
		soak,
		`${device.name} pass ${label(soak, row.id)} ${key} level ${String(entry.level)} at ${entry.reviewed}${outcome}`
	);
	if (recorded.ok) soak.passes.set(soak.passes.size, { id: row.id, key, ...entry });
});

const addCollection = async (soak: Soak, device: Device): Promise<void> => {
	const name = pick(soak, COLLECTIONS) ?? '';
	const named = await createCollection(device.db, name, {}, tick(soak));
	note(soak, `${device.name} add collection ${name}${named.ok ? '' : ': exists'}`);
};

const renameOne = async (soak: Soak, device: Device): Promise<void> => {
	const from = pick(soak, await collectionsOf(device));
	if (from === undefined) return addCollection(soak, device);
	const name = pick(soak, COLLECTIONS) ?? '';
	const named = await renameCollection(device.db, from, name);
	note(soak, `${device.name} rename collection ${from} to ${name}${named.ok ? '' : ': exists'}`);
};

const deleteOne = async (soak: Soak, device: Device): Promise<void> => {
	const path = pick(soak, await collectionsOf(device));
	if (path === undefined) return addCollection(soak, device);
	const removed = await deleteCollection(device.db, path);
	removed.passages.forEach((row) => {
		deletedRow(soak, row);
	});
	const names = removed.passages.map((row) => label(soak, row.id)).join(', ');
	note(soak, `${device.name} delete collection ${path} with [${names}]`);
};

const told = (soak: Soak, device: Device, outcome: SyncOutcome, how = 'sync'): SyncOutcome => {
	const conflicts = outcome.conflicts.length > 0 ? ` [${outcome.conflicts.join(', ')}]` : '';
	const error = outcome.error === undefined ? '' : ` (${outcome.error})`;
	note(
		soak,
		`${device.name} ${how}: ${outcome.status}${error}, pulled ${String(outcome.pulled)}, pushed ${String(outcome.pushed)}${conflicts}`
	);
	return outcome;
};

const sync = async (soak: Soak, device: Device): Promise<void> => {
	told(soak, device, await device.engine.sync());
};

const ACTIONS: Readonly<Record<Kind, (soak: Soak, device: Device) => Promise<void>>> = {
	create,
	edit,
	retitle,
	move,
	delete: remove,
	pass,
	addCollection,
	renameCollection: renameOne,
	deleteCollection: deleteOne,
	sync,
};

/**
 * A sync of `device`, with something done the first time one of its push's
 * operations has reached the remote: mostly by the other device, a sync of
 * its own included, and otherwise by this one, carrying on.
 */
const syncInFlight = async (soak: Soak, device: Device): Promise<void> => {
	const operation = pick(soak, OPERATIONS) ?? 'write';
	const actor = soak.next() < 0.6 ? other(soak, device) : device;
	const kind =
		(actor === device ? weighted(soak, WRITER_WEIGHTS) : weighted(soak, STEP_WEIGHTS)) ??
		'sync';
	const doing = kind === 'syncInFlight' ? 'sync' : kind;
	note(soak, `${device.name} sync, ${actor.name} to ${doing} on its first ${operation}:`);
	const action = () =>
		ACTIONS[doing](soak, actor).catch((error: unknown) => {
			soak.errors.set(soak.errors.size, `${actor.name} ${doing}: ${String(error)}`);
		});
	const engine = device.over(inFlight(soak.fake, operation, action));
	told(soak, device, await engine.sync(), `sync (${operation} in flight)`);
};

const step = async (soak: Soak): Promise<void> => {
	const device = soak.next() < 0.5 ? soak.devices[0] : soak.devices[1];
	const kind = weighted(soak, STEP_WEIGHTS) ?? 'sync';
	await (kind === 'syncInFlight' ? syncInFlight(soak, device) : ACTIONS[kind](soak, device));
	await observe(soak);
};

const isQuiet = (outcome: SyncOutcome): boolean =>
	outcome.status === 'ok' &&
	outcome.pulled === 0 &&
	outcome.pushed === 0 &&
	outcome.conflicts.length === 0;

/** A then B, round after round, until two rounds in a row change nothing. */
const settle = (soak: Soak): Promise<number> =>
	Array.from({ length: ROUNDS }).reduce<Promise<number>>(async (pending) => {
		const quiet = await pending;
		if (quiet >= 2) return quiet;
		const [a, b] = soak.devices;
		const first = told(soak, a, await a.engine.sync(), 'settle');
		const second = told(soak, b, await b.engine.sync(), 'settle');
		await observe(soak);
		return isQuiet(first) && isQuiet(second) ? quiet + 1 : 0;
	}, Promise.resolve(0));

const device = async (
	name: Device['name'],
	fake: FakeProvider,
	counters: Map<string, number>
): Promise<Device> => {
	const db = createDatabase(`soak-${name}-${crypto.randomUUID()}`);
	opened.push(db);
	await bindLibrary(db, { connectionId: CONNECTION, provider: 'dropbox' });
	const now = () => START + (counters.get('clock') ?? 0) * 1000;
	const store = createDexieSyncStore(db, { connectionId: CONNECTION, now });
	const over = (provider: StorageProvider) =>
		createSyncEngine({
			provider,
			store,
			now: () => new Date(now()),
			newId: () => `${name.toLowerCase()}-copy-${String(bump(counters, `copy-${name}`))}`,
			merge: mergeFile,
		});
	return { name, db, engine: over(fake), over };
};

const soakFor = async (seed: number): Promise<Soak> => {
	const fake = createFakeProvider();
	await fake.ensureRoot();
	const counters = new Map<string, number>();
	const numbers = randoms(seed, 4096);
	return {
		fake,
		devices: [await device('A', fake, counters), await device('B', fake, counters)],
		next: () => numbers[(bump(counters, 'random') - 1) % numbers.length] ?? 0,
		counters,
		log: new Map([[0, `seed ${String(seed)}`]]),
		known: new Map(),
		same: new Map(),
		given: new Map(),
		passes: new Map(),
		deleted: new Set(),
		dropped: new Set(),
		droppedPasses: new Set(),
		errors: new Map(),
	};
};

/** The passage a row's file says it is, where that is not the row's own id. */
const fileLabel = (soak: Soak, row: NoteRecord): string => {
	const id = fileId(row);
	return id === undefined || id === row.id ? '' : ` (file ${label(soak, id)})`;
};

/** What each device and the remote hold at the end, for a failure to print. */
const holdings = async (soak: Soak): Promise<string> => {
	const rows = await Promise.all(
		soak.devices.map(async (each) =>
			(await each.db.notes.toArray())
				.filter((row) => !isWithin(row.path, APP_FOLDER))
				.sort((a, b) => a.path.localeCompare(b.path))
				.map((row) =>
					[
						`  ${each.name} ${row.path}: ${label(soak, row.id)}${fileLabel(soak, row)}`,
						wordsLabel(passageText(row.source)),
						...(row.dirty === 1 ? ['dirty'] : []),
						...(row.deletedLocally === 1 ? ['tombstone'] : []),
						...(row.remoteId === undefined ? ['unsent'] : []),
					].join(' ')
				)
		)
	);
	const remote = Object.entries(remoteFiles(soak.fake)).map(
		([path, source]) => `  remote ${path}: ${wordsLabel(passageText(source ?? ''))}`
	);
	return ['at the end:', ...rows.flat(), ...remote].join('\n');
};

const holdsPass = (row: NoteRecord, last: Pass): boolean => {
	const entry = readProgress(parsePassageFile(row.source).progress).chunks.get(last.key);
	return entry?.level === last.level && entry.reviewed === last.reviewed;
};

/** Each device's last words for each passage still kept by nobody's choice, where missing. */
const lostWords = (soak: Soak, rows: readonly (readonly NoteRecord[])[]): string[] => {
	const gone = new Set([...soak.deleted].map((id) => root(soak, id)));
	const last = new Map(
		[...soak.given.values()].map(
			(given) => [`${given.device}|${root(soak, given.id)}`, given] as const
		)
	);
	return [...last.values()]
		.filter((given) => !gone.has(root(soak, given.id)) && !soak.dropped.has(given.words))
		.flatMap((given) =>
			soak.devices.flatMap((each, at) =>
				(rows[at] ?? []).some((row) => passageText(row.source) === given.words)
					? []
					: [
							`${given.device}'s ${wordsLabel(given.words)} for ${label(soak, given.id)}, gone on ${each.name}`,
						]
			)
		);
};

/** The last pass on each passage still kept by nobody's choice, where missing. */
const lostPasses = (soak: Soak, rows: readonly (readonly NoteRecord[])[]): string[] => {
	const gone = new Set([...soak.deleted].map((id) => root(soak, id)));
	const last = new Map(
		[...soak.passes.values()].map((each) => [root(soak, each.id), each] as const)
	);
	return [...last.values()]
		.filter((each) => !gone.has(root(soak, each.id)) && !soak.droppedPasses.has(each.reviewed))
		.flatMap((each) =>
			soak.devices.flatMap((device, at) =>
				(rows[at] ?? []).some((row) => holdsPass(row, each))
					? []
					: [
							`the pass on ${label(soak, each.id)} at ${each.reviewed}, gone on ${device.name}`,
						]
			)
		);
};

describe('two devices on one remote, driven at random', () => {
	const seeds = Array.from({ length: SEEDS }, (_, at) => at + 1);

	it.each(seeds)(
		'seed %i converges, owes nothing, and keeps every edit and pass',
		async (seed) => {
			const soak = await soakFor(seed);
			await Array.from({ length: STEPS }).reduce<Promise<void>>(async (pending) => {
				await pending;
				await step(soak);
			}, Promise.resolve());
			const quiet = await settle(soak);
			const end = await holdings(soak);
			const said = () => `${[...soak.log.values()].join('\n')}\n${end}`;

			expect([...soak.errors.values()], said()).toEqual([]);
			expect(quiet, said()).toBe(2);

			// Convergence.
			const [a, b] = soak.devices;
			const files = await localFiles(a.db);
			expect(await localFiles(b.db), said()).toEqual(files);
			expect(remoteFiles(soak.fake), said()).toEqual(files);
			const activity = await activityFiles(a.db);
			expect(await activityFiles(b.db), said()).toEqual(activity);
			expect(remoteActivityFiles(soak.fake), said()).toEqual(activity);

			// Quiet.
			const owed = await Promise.all(
				soak.devices.map(async (each) => [
					...(await each.db.opQueue.toArray()).map(
						(op) => `${each.name} queued ${op.op} ${op.path}`
					),
					...(await each.db.notes.toArray())
						.filter((row) => row.dirty === 1)
						.map((row) => `${each.name} dirty ${row.path}`),
				])
			);
			expect(owed.flat(), said()).toEqual([]);

			// No lost edit, and no lost practice.
			const rows = await Promise.all(soak.devices.map((each) => liveRows(each.db)));
			expect(lostWords(soak, rows), said()).toEqual([]);
			expect(lostPasses(soak, rows), said()).toEqual([]);
		},
		20_000
	);
});
