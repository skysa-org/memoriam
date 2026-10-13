import { parseDocument } from 'yaml';

import { CURRENT_CHUNKER } from '../config.js';
import { splitFrontmatter } from '../markdown/frontmatter.js';
import { parsePassageFile } from '../markdown/passage.js';
import { chunkPassage } from '../passage/chunk.js';
import { type ChunkProgress, readProgress, writeProgress } from './codec.js';

/**
 * Two copies of one passage made one, where that can be done without guessing
 * (docs/ARCHITECTURE.md §10): an import over the library now, sync later.
 *
 * Only progress is merged. Where the words or the other details differ, there
 * is no telling which side changed them without the version both came from,
 * so the two are kept apart, and the caller keeps both files. Progress merges
 * chunk by chunk: the entry practised later wins, and the incoming one wins a
 * tie, as the remote does in sync.
 */

export type PassageMerge =
	/** Nothing in the incoming copy that ours does not have. */
	| Readonly<{ kind: 'same' }>
	/** Ours, with the incoming progress merged in, and every other byte as it was. */
	| Readonly<{ kind: 'merged'; text: string }>
	/** The words or details differ, or a file cannot be read: keep both. */
	| Readonly<{ kind: 'apart' }>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** A value with every mapping's keys in order, so two that say the same compare equal. */
const sorted = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sorted);
	if (!isRecord(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, sorted(value[key])])
	);
};

/** A file's details, its progress left out, as a string to compare; none if they cannot be read. */
const detailsOf = (frontmatter: string | null): string | undefined => {
	if (frontmatter === null) return '{}';
	const doc = parseDocument(frontmatter);
	if (doc.errors.length > 0) return undefined;
	const value: unknown = doc.toJS();
	if (value === null || value === undefined) return '{}';
	if (!isRecord(value)) return undefined;
	const { progress: _, ...details } = value;
	return JSON.stringify(sorted(details));
};

/** When an entry was practised, for ordering; the earliest there is for none. */
const practisedAt = (entry: ChunkProgress): number => {
	const at = Date.parse(entry.reviewed ?? '');
	return Number.isNaN(at) ? -Infinity : at;
};

/** The later of two entries for one chunk; the incoming one on a tie. */
const later = (ours: ChunkProgress, theirs: ChunkProgress): ChunkProgress =>
	practisedAt(ours) > practisedAt(theirs) ? ours : theirs;

/**
 * Whether two copies of a passage say the same but for their progress: the
 * same words, and every other detail the same. False where either cannot be
 * read. A pull that changes only this much was practice somewhere else, not an
 * edit (§10).
 */
export const sameApartFromProgress = (one: string, two: string): boolean => {
	if (one === two) return true;
	const a = splitFrontmatter(one);
	const b = splitFrontmatter(two);
	const details = detailsOf(a.frontmatter);
	return a.body === b.body && details !== undefined && details === detailsOf(b.frontmatter);
};

export const mergePassage = (ours: string, theirs: string): PassageMerge => {
	if (ours === theirs) return { kind: 'same' };
	if (!sameApartFromProgress(ours, theirs)) return { kind: 'apart' };
	const parsed = parsePassageFile(ours);
	const before = readProgress(parsed.progress);
	const incoming = readProgress(parsePassageFile(theirs).progress);
	const keys = [...new Set([...before.chunks.keys(), ...incoming.chunks.keys()])];
	const chunks = new Map(
		keys.flatMap((key) => {
			const a = before.chunks.get(key);
			const b = incoming.chunks.get(key);
			const entry = a === undefined || b === undefined ? (a ?? b) : later(a, b);
			return entry === undefined ? [] : [[key, entry] as const];
		})
	);
	const opaque = { ...incoming.opaque, ...before.opaque };
	const same =
		JSON.stringify([...chunks]) === JSON.stringify([...before.chunks]) &&
		JSON.stringify(sorted(opaque)) === JSON.stringify(sorted(before.opaque));
	if (same) return { kind: 'same' };
	const order =
		chunkPassage(parsed.body, parsed.chunker ?? CURRENT_CHUNKER)?.chunks.map(
			(chunk) => chunk.key
		) ?? [];
	const written = writeProgress(ours, { chunks, opaque }, order);
	return written.ok ? { kind: 'merged', text: written.text } : { kind: 'apart' };
};
