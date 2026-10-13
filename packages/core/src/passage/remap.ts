import { type ProgressBlock } from '../markdown/frontmatter.js';
import {
	type ChunkProgress,
	type Progress,
	progressBlock,
	readProgress,
} from '../progress/codec.js';
import { type Chunk, type ChunkedPassage, chunkPassage, keyText } from './chunk.js';
import { type PassageWord } from './text.js';

/**
 * Progress carried across a change to a passage's words (docs/ARCHITECTURE.md
 * §3, "Writes").
 *
 * A chunk whose words are unchanged keeps its key, and so its progress, with
 * nothing to do. These are for the chunks whose words did change:
 *
 * - **An edit in the app** (`remapProgress`) has the old words to hand. A new
 *   chunk takes an old one's progress when it stands where that one stood —
 *   between the same unchanged chunks, in the same order — and shares at least
 *   60% of its words. Its misses go with the words they were for.
 * - **An edit elsewhere** (`fillGaps`) leaves only keys behind: a text editor,
 *   or a provider's web page, changed the words and not the frontmatter. Keys
 *   that match no chunk are paired with chunks that have no progress, in
 *   order, between the same unchanged chunks — but only where there are as
 *   many of one as of the other, so nothing is guessed.
 *
 * Whatever is not carried starts again, and its old entry is dropped on the
 * next write.
 */

/** How much of a chunk's words must survive an edit for its progress to. */
export const KEEPS_PROGRESS = 0.6;

/** Lowercase words, as a chunk's key reads them. */
const wordsOf = (words: readonly Pick<PassageWord, 'text'>[]): string[] =>
	words.map((word) => keyText([word]));

/**
 * The longest run of words two lists share in order, as pairs of where each
 * shared word is in the first and in the second.
 */
export const commonWords = (
	a: readonly string[],
	b: readonly string[]
): readonly (readonly [number, number])[] => {
	// `table[i][j]` is how many words `a[i..]` and `b[j..]` share in order.
	const table = Array.from({ length: a.length + 1 }, () =>
		Array.from({ length: b.length + 1 }, () => 0)
	);
	const length = (i: number, j: number): number => table[i]?.[j] ?? 0;
	[...a.keys()].reverse().forEach((i) => {
		[...b.keys()].reverse().forEach((j) => {
			const row = table[i];
			if (row === undefined) return;
			// A table this function made and fills, never handed out.
			// eslint-disable-next-line functional/immutable-data -- see above
			row[j] =
				a[i] === b[j]
					? length(i + 1, j + 1) + 1
					: Math.max(length(i + 1, j), length(i, j + 1));
		});
	});
	const walk = (i: number, j: number): (readonly [number, number])[] => {
		if (i >= a.length || j >= b.length) return [];
		if (a[i] === b[j]) return [[i, j] as const, ...walk(i + 1, j + 1)];
		return length(i + 1, j) >= length(i, j + 1) ? walk(i + 1, j) : walk(i, j + 1);
	};
	return walk(0, 0);
};

/** What share of the longer of two lists of words they have in common. */
const overlap = (shared: number, a: number, b: number): number =>
	Math.max(a, b) === 0 ? 0 : shared / Math.max(a, b);

/**
 * Old and new chunks parted by the chunks both have (their keys are the same),
 * as the runs between those: the chunks that changed, with where they stood.
 */
interface Gap<Old, New> {
	readonly before: readonly Old[];
	readonly after: readonly New[];
}

/**
 * The gaps between the keys both lists have, in order. A key is an anchor only
 * where it stands in the same order in both: one moved across another is a
 * change, as anything else is.
 */
const gapsBetween = <Old, New>(
	old: readonly Old[],
	now: readonly New[],
	oldKey: (item: Old) => string,
	newKey: (item: New) => string
): Gap<Old, New>[] => {
	const anchors = commonWords(old.map(oldKey), now.map(newKey));
	const bounds = [...anchors, [old.length, now.length] as const];
	return bounds.map(([i, j], at) => {
		const [pi, pj] = at === 0 ? [-1, -1] : (bounds[at - 1] ?? [-1, -1]);
		return { before: old.slice(pi + 1, i), after: now.slice(pj + 1, j) };
	});
};

/** An old chunk, with its words and its progress, if it had any. */
export interface OldChunk {
	readonly key: string;
	readonly words: readonly Pick<PassageWord, 'text'>[];
}

/** A new chunk, with its words. */
export interface NewChunk {
	readonly key: string;
	readonly words: readonly Pick<PassageWord, 'text'>[];
}

/**
 * Within one gap, the old chunk each new one takes its progress from, as many
 * as can be paired in order with enough words in common: the most pairs, and
 * of those the most words kept.
 */
const pairInGap = (
	gap: Gap<OldChunk, NewChunk>
): readonly (readonly [OldChunk, NewChunk, readonly (readonly [number, number])[]])[] => {
	const { before, after } = gap;
	const shared = before.map((old) =>
		after.map((now) => {
			const common = commonWords(wordsOf(old.words), wordsOf(now.words));
			const share = overlap(common.length, old.words.length, now.words.length);
			return share >= KEEPS_PROGRESS ? { common, score: 1 + share } : undefined;
		})
	);
	// The same order-keeping table as `commonWords`, over chunks this time.
	const memo = new Map<string, number>();
	const value = (i: number, j: number): number => {
		if (i >= before.length || j >= after.length) return 0;
		const cached = memo.get(`${String(i)},${String(j)}`);
		if (cached !== undefined) return cached;
		const pair = shared[i]?.[j];
		const result = Math.max(
			pair === undefined ? 0 : pair.score + value(i + 1, j + 1),
			value(i + 1, j),
			value(i, j + 1)
		);
		memo.set(`${String(i)},${String(j)}`, result);
		return result;
	};
	const walk = (
		i: number,
		j: number
	): (readonly [OldChunk, NewChunk, readonly (readonly [number, number])[]])[] => {
		if (i >= before.length || j >= after.length) return [];
		const pair = shared[i]?.[j];
		const old = before[i];
		const now = after[j];
		if (
			pair !== undefined &&
			old !== undefined &&
			now !== undefined &&
			value(i, j) === pair.score + value(i + 1, j + 1)
		) {
			return [[old, now, pair.common] as const, ...walk(i + 1, j + 1)];
		}
		return value(i + 1, j) >= value(i, j + 1) ? walk(i + 1, j) : walk(i, j + 1);
	};
	return walk(0, 0);
};

/** Misses moved from the old words to the new: each with the word it was for. */
const carriedMisses = (
	misses: readonly number[] | undefined,
	common: readonly (readonly [number, number])[],
	length: number
): readonly number[] | undefined => {
	if (misses === undefined) return undefined;
	const moved = new Map(common.map(([from, to]) => [to, misses[from] ?? 0]));
	const carried = Array.from({ length }, (_, at) => moved.get(at) ?? 0);
	return carried.some((count) => count > 0) ? carried : undefined;
};

const withMisses = (
	progress: ChunkProgress,
	misses: readonly number[] | undefined
): ChunkProgress => {
	const { misses: _, ...rest } = progress;
	return misses === undefined ? rest : { ...rest, misses };
};

/** Only what the chunks of `now` have, keyed by their keys; entries no chunk could read are kept. */
const keptFor = (
	now: readonly NewChunk[],
	progress: Progress,
	carried: ReadonlyMap<string, ChunkProgress>
): Progress => ({
	chunks: new Map(
		now.flatMap((chunk) => {
			const kept = progress.chunks.get(chunk.key) ?? carried.get(chunk.key);
			return kept === undefined ? [] : [[chunk.key, kept] as const];
		})
	),
	opaque: progress.opaque,
});

/**
 * Progress for a passage whose words were edited in the app: what each new
 * chunk keeps, under its own key. `old` and `now` are the chunks before and
 * after, in passage order.
 */
export const remapProgress = (
	old: readonly OldChunk[],
	now: readonly NewChunk[],
	progress: Progress
): Progress => {
	const gaps = gapsBetween(
		old,
		now,
		(chunk) => chunk.key,
		(chunk) => chunk.key
	);
	const carried = new Map(
		gaps.flatMap(pairInGap).flatMap(([from, to, common]) => {
			const had = progress.chunks.get(from.key);
			return had === undefined
				? []
				: [
						[
							to.key,
							withMisses(had, carriedMisses(had.misses, common, to.words.length)),
						] as const,
					];
		})
	);
	return keptFor(now, progress, carried);
};

/**
 * Progress for a passage as it is read, whose words may have been changed by
 * another tool: keys no chunk has are paired with chunks no key names, in
 * order, where a gap holds as many of each. A carried entry keeps its misses
 * only where the chunk has as many words as they count.
 */
export const fillGaps = (
	now: readonly Readonly<Pick<Chunk, 'key'> & { words: number }>[],
	progress: Progress
): Progress => {
	const keys = [...progress.chunks.keys()];
	const gaps = gapsBetween(
		keys,
		now,
		(key) => key,
		(chunk) => chunk.key
	);
	const carried = new Map(
		gaps
			.filter((gap) => gap.before.length === gap.after.length)
			.flatMap((gap) =>
				gap.after.flatMap((chunk, at) => {
					const key = gap.before[at];
					const had = key === undefined ? undefined : progress.chunks.get(key);
					if (had === undefined) return [];
					const fits = had.misses === undefined || had.misses.length === chunk.words;
					return [[chunk.key, fits ? had : withMisses(had, undefined)] as const];
				})
			)
	);
	return keptFor(
		now.map((chunk) => ({ key: chunk.key, words: [] })),
		progress,
		carried
	);
};

/** A cut passage's chunks, each with its words, as `remapProgress` takes them. */
export const chunksWithWords = (passage: ChunkedPassage): NewChunk[] =>
	passage.chunks.map((chunk) => ({
		key: chunk.key,
		words: passage.words.slice(chunk.start, chunk.end),
	}));

/** What an edit to a passage's words does to its `progress` block. */
export type EditedProgress =
	| Readonly<{ changed: false }>
	/** `block` is `undefined` where nothing is left, and the key goes. */
	| Readonly<{ changed: true; block: ProgressBlock | undefined }>;

/**
 * The `progress` block of a passage whose body was edited in the app from
 * `before` to `after`, both cut by the chunker it names: keys the words no
 * longer match, left by another tool, are first filled against `before`
 * (`fillGaps`), and what that gives is carried to `after` (`remapProgress`),
 * in passage order.
 *
 * Nothing changes for a passage with no `progress` this app can read, or a
 * chunker this build does not have: its keys are not this build's to work
 * out, and the block is better left for one that can.
 */
export const editedProgress = (
	before: string,
	after: string,
	chunker: number,
	block: ProgressBlock | undefined
): EditedProgress => {
	const old = chunkPassage(before, chunker);
	const now = chunkPassage(after, chunker);
	if (block === undefined || old === undefined || now === undefined) return { changed: false };
	const oldChunks = chunksWithWords(old);
	const newChunks = chunksWithWords(now);
	const filled = fillGaps(
		oldChunks.map((chunk) => ({ key: chunk.key, words: chunk.words.length })),
		readProgress(block)
	);
	const written = progressBlock(
		remapProgress(oldChunks, newChunks, filled),
		newChunks.map((chunk) => chunk.key)
	);
	const next = Object.keys(written).length === 0 ? undefined : written;
	return JSON.stringify(next) === JSON.stringify(block)
		? { changed: false }
		: { changed: true, block: next };
};
