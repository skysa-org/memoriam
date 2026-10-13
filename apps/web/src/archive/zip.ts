import { ancestorPaths, basename, foldName, normalizePath, parentPath, ROOT } from '@memoriam/core';

/**
 * A ZIP archive written by hand, stored and not compressed, as skysa-notes
 * writes its own (docs/ARCHITECTURE.md §3, "Layout"). Passages are small,
 * DEFLATE is a dependency or a few hundred lines, and a stored archive is a
 * header, the bytes, and a table of contents: little enough to get exactly
 * right and to check field by field. Nothing here touches the network.
 *
 * https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (§4.3.7 local
 * header, §4.3.12 central directory, §4.3.16 end record, §4.4.4 flag bit 11).
 */

/** Bytes over a buffer of their own, which is what a `Blob` will take. */
export type Bytes = Uint8Array<ArrayBuffer>;

export interface ZipFile {
	/** POSIX, relative, as the library has it. */
	readonly path: string;
	readonly content: string;
	/** Epoch milliseconds; absent is the earliest the format has, 1980-01-01. */
	readonly modifiedAt?: number;
}

/** A collection with nothing in it: a folder no file implies, which needs an entry of its own. */
export interface ZipFolder {
	readonly path: string;
	readonly modifiedAt?: number;
}

export type ZipWrite =
	| Readonly<{ ok: true; parts: Bytes[] }>
	/** More entries than the format counts, more bytes than it reaches, or a name too long. */
	| Readonly<{ ok: false; limit: 'entries' | 'bytes' | 'name' }>;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
/** 2.0, the lowest anything asks for. */
const VERSION = 20;
/** Bit 11: the name is UTF-8. */
const UTF8_NAMES = 0x0800;
const STORED = 0;
/** The MS-DOS directory attribute, for readers that go by it rather than the slash. */
const DIRECTORY = 0x10;
/** Where ZIP64 begins: the all-ones value of each field means "look elsewhere". */
const ZIP64_ENTRIES = 0xffff;
const ZIP64_BYTES = 0xffffffff;
const MAX_NAME_BYTES = 0xffff;

const u16 = (value: number): number[] => [value & 0xff, (value >>> 8) & 0xff];
const u32 = (value: number): number[] => [...u16(value & 0xffff), ...u16(value >>> 16)];

const shifted = (value: number): number =>
	(value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;

const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, index) =>
	Array.from({ length: 8 }).reduce<number>(shifted, index)
);

/** CRC-32 (IEEE 802.3), unsigned. `crc32` of the ASCII for `123456789` is 0xCBF43926. */
export const crc32 = (bytes: Uint8Array): number =>
	(bytes.reduce((crc, byte) => (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8), 0xffffffff) ^
		0xffffffff) >>>
	0;

/** MS-DOS time and date: local time in two-second steps, 1980 to 2107. */
const dosStamp = (modifiedAt: number | undefined): Readonly<{ time: number; date: number }> => {
	const at = new Date(modifiedAt ?? 0);
	const year = at.getFullYear();
	if (modifiedAt === undefined || Number.isNaN(year) || year < 1980 || year > 2107) {
		return { time: 0, date: (1 << 5) | 1 };
	}
	return {
		time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >>> 1),
		date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
	};
};

export const joined = (parts: readonly Uint8Array[]): Bytes => {
	const out = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	parts.reduce((offset, part) => {
		out.set(part, offset);
		return offset + part.length;
	}, 0);
	return out;
};

/**
 * The name an entry is written under, safe for the least careful tool that
 * unpacks it ("zip slip"): relative, with no empty, `.` or `..` segment, and no
 * backslash, which some Windows tools read as a separator.
 */
export const entryName = (path: string): string => normalizePath(path.replace(/\\/g, '_'));

/** `name (2).md`: the extension kept, so the file still opens as what it is. */
const numbered = (path: string, n: number): string => {
	const name = basename(path);
	const dot = name.lastIndexOf('.');
	const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
	const folder = parentPath(path);
	return `${folder === ROOT ? '' : `${folder}/`}${stem} (${String(n)})${extension}`;
};

/** The first of `name (2)`, `name (3)`… that is not taken. */
const freeNumber = (path: string, taken: ReadonlySet<string>, n = 2): string =>
	taken.has(foldName(numbered(path, n))) ? freeNumber(path, taken, n + 1) : numbered(path, n);

/**
 * Every file under a name of its own, compared folded, as the disk most
 * people unpack onto would: a later file at a name taken, by a file or by a
 * folder another file implies, is numbered.
 */
const apart = (files: readonly ZipFile[], folders: readonly ZipFolder[]) => {
	const named = files.map((file) => ({ ...file, path: entryName(file.path) }));
	const filled = new Set(named.flatMap((file) => ancestorPaths(file.path).map(foldName)));
	const empty = folders
		.map((folder) => ({ ...folder, path: entryName(folder.path) }))
		.filter(
			(folder, at, all) =>
				folder.path !== ROOT &&
				!filled.has(foldName(folder.path)) &&
				all.findIndex((each) => foldName(each.path) === foldName(folder.path)) === at
		);
	const implied = new Set([
		...filled,
		...empty.flatMap((folder) => [...ancestorPaths(folder.path), folder.path].map(foldName)),
	]);
	const placed = named.reduce<Readonly<{ files: ZipFile[]; taken: ReadonlySet<string> }>>(
		({ files: done, taken }, file) => {
			const path = taken.has(foldName(file.path)) ? freeNumber(file.path, taken) : file.path;
			return {
				files: [...done, { ...file, path }],
				taken: new Set(taken).add(foldName(path)),
			};
		},
		{ files: [], taken: implied }
	);
	return { files: placed.files, folders: empty };
};

interface Entry {
	readonly local: readonly Bytes[];
	readonly size: number;
	readonly central: readonly Bytes[];
}

const entryFor = (
	file: ZipFile,
	offset: number,
	attributes = 0
): Entry | Readonly<{ limit: 'name' }> => {
	const name = new TextEncoder().encode(file.path);
	if (name.length > MAX_NAME_BYTES) return { limit: 'name' };
	const data = new TextEncoder().encode(file.content);
	const { time, date } = dosStamp(file.modifiedAt);
	// The part both headers share, in the order both have it. Stored, so the
	// compressed size is the size.
	const described = [
		...u16(UTF8_NAMES),
		...u16(STORED),
		...u16(time),
		...u16(date),
		...u32(crc32(data)),
		...u32(data.length),
		...u32(data.length),
		...u16(name.length),
		...u16(0),
	];
	const header = Uint8Array.from([...u32(LOCAL_HEADER), ...u16(VERSION), ...described]);
	return {
		local: [header, name, data],
		size: header.length + name.length + data.length,
		central: [
			Uint8Array.from([
				...u32(CENTRAL_HEADER),
				...u16(VERSION),
				...u16(VERSION),
				...described,
				// No comment, disk 0, no internal attributes.
				...u16(0),
				...u16(0),
				...u16(0),
				...u32(attributes),
				...u32(offset),
			]),
			name,
		],
	};
};

/**
 * A ZIP archive of `files`, with an entry for each of `folders` no file is in,
 * as the parts a `Blob` is made from. Pure: the same files give the same bytes.
 */
export const zipParts = (
	files: readonly ZipFile[],
	folders: readonly ZipFolder[] = []
): ZipWrite => {
	const placed = apart(files, folders);
	const all = [
		...placed.folders.map((folder) => ({
			file: { ...folder, path: `${folder.path}/`, content: '' },
			attributes: DIRECTORY,
		})),
		...placed.files.map((file) => ({ file, attributes: 0 })),
	];
	if (all.length >= ZIP64_ENTRIES) return { ok: false, limit: 'entries' };
	const built = all.reduce<
		Readonly<{ entries: Entry[]; size: number }> | Readonly<{ limit: 'name' }>
	>(
		(sofar, { file, attributes }) => {
			if ('limit' in sofar) return sofar;
			const entry = entryFor(file, sofar.size, attributes);
			if ('limit' in entry) return entry;
			return { entries: [...sofar.entries, entry], size: sofar.size + entry.size };
		},
		{ entries: [], size: 0 }
	);
	if ('limit' in built) return { ok: false, limit: built.limit };
	const directory = joined(built.entries.flatMap((entry) => entry.central));
	if (built.size + directory.length >= ZIP64_BYTES) return { ok: false, limit: 'bytes' };
	return {
		ok: true,
		parts: [
			...built.entries.flatMap((entry) => entry.local),
			directory,
			Uint8Array.from([
				...u32(END_RECORD),
				...u16(0),
				...u16(0),
				...u16(built.entries.length),
				...u16(built.entries.length),
				...u32(directory.length),
				...u32(built.size),
				...u16(0),
			]),
		],
	};
};
