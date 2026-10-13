import { describe, expect, it } from 'vitest';

import { parsePassageFile } from '../../src/markdown/passage.js';
import {
	type ChunkProgress,
	NO_PROGRESS,
	type Progress,
	progressBlock,
	type ProgressWrite,
	readProgress,
	writeProgress,
} from '../../src/progress/codec.js';

/** The progress a passage's file holds. */
const frontmatterProgress = (text: string): Progress =>
	readProgress(parsePassageFile(text).progress);

const progressOf = (entries: readonly (readonly [string, ChunkProgress])[]): Progress => ({
	chunks: new Map(entries),
	opaque: {},
});

/** The text a write produced, or a failed test where it produced none. */
const textOf = (written: ProgressWrite): string => {
	if (!written.ok) throw new Error(`the write was refused: ${written.reason}`);
	return written.text;
};

/** Lines of `after` that are not in `before`, and the other way about. */
const changedLines = (before: string, after: string): readonly string[] => {
	const was = before.split('\n');
	const now = after.split('\n');
	return [
		...was.filter((line) => !now.includes(line)).map((line) => `- ${line}`),
		...now.filter((line) => !was.includes(line)).map((line) => `+ ${line}`),
	];
};

const PSALM = [
	'---',
	'id: 01JAB3K7Q2',
	'title: Psalm 23 # the shepherd',
	'source: Psalm 23 (ESV)',
	'tags: [scripture, comfort]',
	'created: 2026-10-01T09:00:00Z',
	'updated: 2026-10-01T09:00:00Z',
	'chunker: 1',
	'progress:',
	'  k3fq9ma: { level: 5, due: 2026-10-20, stability: 6.21, difficulty: 4.1, reps: 3, lapses: 0, reviewed: 2026-10-13T14:03:02Z, misses: "0,0,2,0,1" }',
	'  p8dz2ve: { level: 3, reviewed: 2026-10-13T14:05:00Z }',
	"# Kept by the app: everything below is the user's.",
	'memorize-by: Easter',
	'---',
	'',
	'The Lord is my shepherd; I shall not want.',
	'He makes me lie down in green pastures.',
	'',
].join('\n');

describe('readProgress', () => {
	it('reads what the app writes', () => {
		const { chunks } = readProgress({
			k3fq9ma: {
				level: 5,
				due: '2026-10-20',
				learnt: '2026-10-13',
				stability: 6.21,
				difficulty: 4.1,
				reps: 3,
				lapses: 0,
				reviewed: '2026-10-13T14:03:02Z',
				misses: '0,0,2,0,1',
			},
			p8dz2ve: { level: 3 },
		});
		expect(chunks.get('k3fq9ma')).toEqual({
			level: 5,
			due: '2026-10-20',
			learnt: '2026-10-13',
			stability: 6.21,
			difficulty: 4.1,
			reps: 3,
			lapses: 0,
			reviewed: '2026-10-13T14:03:02Z',
			misses: [0, 0, 2, 0, 1],
		});
		expect(chunks.get('p8dz2ve')).toEqual({ level: 3 });
	});

	it('keeps the order the file had', () => {
		const { chunks } = readProgress({ b: { level: 1 }, a: { level: 2 }, 'b.2': { level: 3 } });
		expect([...chunks.keys()]).toEqual(['b', 'a', 'b.2']);
	});

	it('is nothing for no block', () => {
		expect(readProgress(undefined)).toEqual(NO_PROGRESS);
	});

	it('passes over a field that is not what the app writes', () => {
		const { chunks } = readProgress({
			a: {
				level: 9,
				due: '2026-02-30',
				stability: -1,
				difficulty: 11,
				reps: 1.5,
				lapses: 'none',
				reviewed: 'yesterday',
				misses: '0,,1',
			},
		});
		// A level it cannot read is the start of the ladder.
		expect(chunks.get('a')).toEqual({ level: 0 });
	});

	it('keeps a field a newer build may have written', () => {
		const { chunks } = readProgress({ a: { level: 2, recited: 3, voice: { pace: 1.2 } } });
		expect(chunks.get('a')).toEqual({ level: 2, extra: { recited: 3, voice: { pace: 1.2 } } });
	});

	it('keeps an entry it cannot read as progress, as it was', () => {
		const progress = readProgress({ a: { level: 1 }, b: 'learnt it', c: [1, 2] });
		expect([...progress.chunks.keys()]).toEqual(['a']);
		expect(progress.opaque).toEqual({ b: 'learnt it', c: [1, 2] });
	});
});

describe('progressBlock', () => {
	it('writes fields in one order, whatever order they were given in', () => {
		const block = progressBlock(
			progressOf([['a', { misses: [1, 0], reviewed: '2026-10-13T14:00:00Z', level: 2 }]])
		);
		expect(Object.keys(block.a as object)).toEqual(['level', 'reviewed', 'misses']);
	});

	it('rounds stability and difficulty to two places', () => {
		const block = progressBlock(
			progressOf([['a', { level: 5, stability: 6.214999, difficulty: 4.1049 }]])
		);
		expect(block.a).toEqual({ level: 5, stability: 6.21, difficulty: 4.1 });
	});

	it('leaves out misses when there are none to say', () => {
		expect(progressBlock(progressOf([['a', { level: 1, misses: [] }]])).a).toEqual({
			level: 1,
		});
	});

	it('puts the chunks in the order it is given, and the rest after', () => {
		const block = progressBlock(
			{
				chunks: new Map([
					['c', { level: 1 }],
					['a', { level: 1 }],
					['b', { level: 1 }],
				]),
				opaque: { z: 'kept' },
			},
			['a', 'b', 'gone']
		);
		expect(Object.keys(block)).toEqual(['a', 'b', 'c', 'z']);
	});

	it('writes a field it does not know after those it does, and never over one', () => {
		const block = progressBlock(
			progressOf([['a', { level: 2, extra: { recited: 3, level: 'four' } }]])
		);
		expect(block.a).toEqual({ level: 2, recited: 3 });
		expect(Object.keys(block.a as object)).toEqual(['level', 'recited']);
	});

	it('comes back as it went', () => {
		const progress: Progress = {
			chunks: new Map<string, ChunkProgress>([
				[
					'k3fq9ma',
					{
						level: 5,
						due: '2026-10-20',
						stability: 6.21,
						difficulty: 4.1,
						reps: 3,
						lapses: 0,
						reviewed: '2026-10-13T14:03:02Z',
						misses: [0, 0, 2],
						extra: { recited: 1 },
					},
				],
				['p8dz2ve', { level: 0 }],
			]),
			opaque: { old: 'x' },
		};
		expect(readProgress(progressBlock(progress))).toEqual(progress);
	});
});

describe('writeProgress', () => {
	/** `text`'s progress, with one chunk's as a pass left it. */
	const pass = (text: string, chunk: ChunkProgress, key = 'p8dz2ve'): Progress => {
		const now = frontmatterProgress(text);
		return { ...now, chunks: new Map([...now.chunks, [key, chunk]]) };
	};

	it('changes only the lines of the chunk a pass changed', () => {
		const next = pass(PSALM, { level: 4, reviewed: '2026-10-14T08:00:00Z', misses: [0, 1] });
		const written = textOf(writeProgress(PSALM, next, ['k3fq9ma', 'p8dz2ve']));
		expect(changedLines(PSALM, written)).toEqual([
			'-   p8dz2ve: { level: 3, reviewed: 2026-10-13T14:05:00Z }',
			'+   p8dz2ve: { level: 4, reviewed: 2026-10-14T08:00:00Z, misses: "0,1" }',
		]);
	});

	it('does not touch `updated`, which says when the words last changed', () => {
		const next = pass(PSALM, { level: 4 });
		expect(textOf(writeProgress(PSALM, next))).toContain('updated: 2026-10-01T09:00:00Z\n');
	});

	it('gives back the file byte for byte when nothing changed', () => {
		const same = frontmatterProgress(PSALM);
		expect(writeProgress(PSALM, same, ['k3fq9ma', 'p8dz2ve'])).toEqual({
			ok: true,
			text: PSALM,
		});
	});

	it('puts the chunks back in passage order', () => {
		const written = textOf(
			writeProgress(PSALM, frontmatterProgress(PSALM), ['p8dz2ve', 'k3fq9ma'])
		);
		expect(written.indexOf('p8dz2ve')).toBeLessThan(written.indexOf('k3fq9ma'));
	});

	it('adds the first chunk to a passage that has no progress yet', () => {
		const fresh = '---\nid: abc\ntitle: Ozymandias\n---\n\nI met a traveller\n';
		const written = writeProgress(fresh, progressOf([['h2c4m7q', { level: 1 }]]));
		expect(written).toEqual({
			ok: true,
			text: '---\nid: abc\ntitle: Ozymandias\nprogress:\n  h2c4m7q: { level: 1 }\n---\n\nI met a traveller\n',
		});
	});

	it('gives a file another tool wrote a block of its own', () => {
		const written = writeProgress(
			'I met a traveller\n',
			progressOf([['h2c4m7q', { level: 1 }]])
		);
		expect(written).toEqual({
			ok: true,
			text: '---\nprogress:\n  h2c4m7q: { level: 1 }\n---\n\nI met a traveller\n',
		});
	});

	it('takes the key away when no chunk has progress', () => {
		const written = textOf(writeProgress(PSALM, NO_PROGRESS));
		expect(written).not.toContain('progress');
		expect(written).toContain('memorize-by: Easter\n');
	});

	it('keeps a CRLF file CRLF', () => {
		const crlf = PSALM.replaceAll('\n', '\r\n');
		const written = textOf(writeProgress(crlf, pass(PSALM, { level: 4 })));
		expect(written).toContain('  p8dz2ve: { level: 4 }\r\n');
		expect(written.replaceAll('\r\n', '')).not.toContain('\n');
	});

	it('says so, and writes nothing, when the frontmatter is broken', () => {
		// `readFrontmatter` recovers what it can of this, `id` and all, so the
		// passage reads; but the app never rewrites a guess.
		const broken = '---\nid: abc\ntitle: "unterminated\ntags: [a\n---\n\nwords\n';
		expect(writeProgress(broken, progressOf([['a', { level: 1 }]]))).toEqual({
			ok: false,
			reason: 'unreadable',
		});
	});

	it('says so when the writer will not change the block', () => {
		// Another key reads `progress` through an alias, so writing it would
		// change that key too.
		const anchored = '---\nid: abc\nprogress: &p\n  a: { level: 1 }\nother: *p\n---\nwords\n';
		expect(writeProgress(anchored, progressOf([['a', { level: 2 }]]))).toEqual({
			ok: false,
			reason: 'refused',
		});
	});
});
