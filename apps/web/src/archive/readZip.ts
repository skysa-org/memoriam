import { type Bytes, crc32 } from './zip.js';

/**
 * A ZIP archive read back into the files it holds, for an import: the one an
 * export writes, and the one an operating system makes of a folder. Ported
 * from skysa-notes. Two methods are read: stored (0), which the export writes,
 * and deflate (8), which Finder, Windows and `zip` write, inflated by the
 * browser itself (`DecompressionStream('deflate-raw')`), so nothing is added
 * to the bundle.
 *
 * Nothing here is trusted to be what it says. An entry larger than a passage
 * file may be is not inflated at all; one that inflates past the size it
 * declared is cut off there and refused, the compressed bytes going in a slice
 * at a time so that is where it stops; and every entry's checksum is compared,
 * so a damaged archive is a file the user is told about rather than a passage
 * that quietly holds the wrong words.
 *
 * https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT (§4.3.7 local
 * header, §4.3.12 central directory, §4.3.16 end record, §4.4.4 flag bits).
 */

/** One file or folder an archive holds, by the name it was stored under. */
export type ZipEntry =
	| Readonly<{ kind: 'file'; name: string; bytes: Bytes }>
	| Readonly<{ kind: 'folder'; name: string }>
	/** Encrypted, compressed by a method this does not read, too large, or damaged. */
	| Readonly<{
			kind: 'unreadable';
			name: string;
			reason: 'encrypted' | 'method' | 'too-large' | 'damaged';
	  }>;

type Unreadable = Extract<ZipEntry, { kind: 'unreadable' }>['reason'];

export type ZipRead =
	| Readonly<{ ok: true; entries: ZipEntry[] }>
	/** Not a ZIP; a ZIP64 one, far past anything this app makes; or one split across disks. */
	| Readonly<{ ok: false; reason: 'not-zip' | 'zip64' | 'spanned' }>;

/** The largest entry read: far past any passage, and short of filling a tab. */
export const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

const CENTRAL_HEADER = 0x02014b50;
const END_RECORD = 0x06054b50;
const LOCAL_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const ENCRYPTED = 0x0001;
const STORED = 0;
const DEFLATED = 8;

/**
 * Where the end record is: the last place its signature appears with a comment
 * length that reaches exactly to the end. Searched for from the back.
 */
const endRecordAt = (view: DataView): number => {
	const last = view.byteLength - END_RECORD_SIZE;
	const first = Math.max(0, last - MAX_COMMENT);
	const ends = (offset: number): boolean =>
		view.getUint32(offset, true) === END_RECORD &&
		offset + END_RECORD_SIZE + view.getUint16(offset + 20, true) === view.byteLength;
	// A loop, where the rest of the repo recurses: up to 65,535 steps back
	// through a comment would be a stack that deep.
	const offset = { current: last };
	// eslint-disable-next-line functional/no-loop-statements
	while (offset.current >= first && !ends(offset.current)) offset.current -= 1;
	return offset.current >= first ? offset.current : -1;
};

/** UTF-8 where it reads as UTF-8; otherwise the nearest the browser has to code page 437. */
const nameOf = (bytes: Uint8Array): string => {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return new TextDecoder('windows-1252').decode(bytes);
	}
};

interface Listed {
	readonly name: string;
	readonly flags: number;
	readonly method: number;
	readonly crc: number;
	readonly compressed: number;
	readonly size: number;
	readonly offset: number;
}

const lengthsAt = (view: DataView, offset: number): number =>
	view.getUint16(offset + 28, true) +
	view.getUint16(offset + 30, true) +
	view.getUint16(offset + 32, true);

const entryAt = (
	view: DataView,
	bytes: Uint8Array,
	offset: number
): Listed | 'not-zip' | 'zip64' => {
	if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== CENTRAL_HEADER) {
		return 'not-zip';
	}
	const nameLength = view.getUint16(offset + 28, true);
	const entry: Listed = {
		name: nameOf(bytes.subarray(offset + 46, offset + 46 + nameLength)),
		flags: view.getUint16(offset + 8, true),
		method: view.getUint16(offset + 10, true),
		crc: view.getUint32(offset + 16, true),
		compressed: view.getUint32(offset + 20, true),
		size: view.getUint32(offset + 24, true),
		offset: view.getUint32(offset + 42, true),
	};
	return entry.size === 0xffffffff || entry.offset === 0xffffffff ? 'zip64' : entry;
};

/** Every entry the central directory lists, in its order; or why there are none. */
const listed = (
	view: DataView,
	bytes: Uint8Array
): Listed[] | Exclude<ZipRead, { ok: true }>['reason'] => {
	if (view.byteLength < END_RECORD_SIZE) return 'not-zip';
	const end = endRecordAt(view);
	if (end < 0) return 'not-zip';
	if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) {
		return 'spanned';
	}
	const count = view.getUint16(end + 10, true);
	const start = view.getUint32(end + 16, true);
	if (count === 0xffff || start === 0xffffffff) return 'zip64';
	const entries: Listed[] = [];
	const offset = { current: start };
	// A loop, for the reason `endRecordAt` gives: one step per entry. `entries`
	// is written to as it goes, and nothing outside sees it until it is done.
	// eslint-disable-next-line functional/no-loop-statements
	while (entries.length < count) {
		const entry = entryAt(view, bytes, offset.current);
		if (typeof entry === 'string') return entry;
		// eslint-disable-next-line functional/immutable-data
		entries.push(entry);
		offset.current += 46 + lengthsAt(view, offset.current);
	}
	return entries;
};

/**
 * How much compressed input goes into the decompressor at once: deflate
 * inflates at most about 1032 to 1, so a slice this size is at most some 17 MB
 * out before the count below sees it and stops.
 */
const SLICE = 16 * 1024;

const feed = async (writer: WritableStreamDefaultWriter<BufferSource>, data: Uint8Array) => {
	const write = async (at: number): Promise<void> => {
		if (at >= data.length) {
			await writer.close();
			return;
		}
		await writer.write(data.slice(at, at + SLICE));
		await write(at + SLICE);
	};
	await write(0).catch(() => undefined);
};

/** Inflate raw deflate, stopping once more than `limit` bytes have come out. */
const inflate = async (data: Uint8Array, limit: number): Promise<Bytes | undefined> => {
	const stream = new DecompressionStream('deflate-raw');
	void feed(stream.writable.getWriter(), data);
	const reader = stream.readable.getReader();
	const chunks: Uint8Array[] = [];
	const total = { current: 0 };
	const pump = async (): Promise<boolean> => {
		const { done, value } = await reader.read();
		if (done) return true;
		total.current += value.length;
		if (total.current > limit) {
			await reader.cancel();
			return false;
		}
		// eslint-disable-next-line functional/immutable-data
		chunks.push(value);
		return pump();
	};
	if (!(await pump())) return undefined;
	const out = new Uint8Array(total.current);
	chunks.reduce((at, chunk) => {
		out.set(chunk, at);
		return at + chunk.length;
	}, 0);
	return out;
};

const contentOf = async (
	view: DataView,
	bytes: Uint8Array,
	entry: Listed
): Promise<Bytes | Unreadable> => {
	if ((entry.flags & ENCRYPTED) !== 0) return 'encrypted';
	if (entry.method !== STORED && entry.method !== DEFLATED) return 'method';
	if (entry.size > MAX_ENTRY_BYTES) return 'too-large';
	if (
		entry.offset + 30 > view.byteLength ||
		view.getUint32(entry.offset, true) !== LOCAL_HEADER
	) {
		return 'damaged';
	}
	// The local header's own name and extra field, which can differ in length
	// from the central directory's copy of them.
	const start =
		entry.offset +
		30 +
		view.getUint16(entry.offset + 26, true) +
		view.getUint16(entry.offset + 28, true);
	if (start + entry.compressed > bytes.length) return 'damaged';
	const data = bytes.subarray(start, start + entry.compressed);
	const content =
		entry.method === STORED
			? new Uint8Array(data)
			: await inflate(data, entry.size).catch(() => undefined);
	if (content?.length !== entry.size) return 'damaged';
	return crc32(content) === entry.crc ? content : 'damaged';
};

/**
 * Every entry of an archive, in the order it lists them; an entry that cannot
 * be read is listed as one, so the rest still come in and the user can be told
 * which did not. One entry at a time, so at most one is being inflated at once.
 */
export const readZip = async (archive: ArrayBuffer): Promise<ZipRead> => {
	const bytes = new Uint8Array(archive);
	const view = new DataView(archive);
	const entries = listed(view, bytes);
	if (typeof entries === 'string') return { ok: false, reason: entries };
	const read = await entries.reduce<Promise<ZipEntry[]>>(async (sofar, entry) => {
		const done = await sofar;
		// A folder, by its trailing separator: `/`, or `\` from Windows tools.
		if (entry.name.endsWith('/') || entry.name.endsWith('\\')) {
			return [...done, { kind: 'folder', name: entry.name }];
		}
		const content = await contentOf(view, bytes, entry);
		return [
			...done,
			typeof content === 'string'
				? { kind: 'unreadable', name: entry.name, reason: content }
				: { kind: 'file', name: entry.name, bytes: content },
		];
	}, Promise.resolve([]));
	return { ok: true, entries: read };
};
