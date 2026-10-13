import { describe, expect, it } from 'vitest';

import { parsePassageFile } from '../../src/markdown/passage.js';
import { chunkPassage } from '../../src/passage/chunk.js';
import { readProgress } from '../../src/progress/codec.js';
import { mergePassage } from '../../src/progress/merge.js';

const BODY =
	'\nThe Lord is my shepherd; I shall not want.\nHe makes me lie down in green pastures.\n\nHe restores my soul.\n';
const [A = '', B = ''] = chunkPassage(BODY, 1)?.chunks.map((chunk) => chunk.key) ?? [];

/** A passage file with `progress` lines, and `more` details. */
const file = (progress: readonly string[], more = '', body = BODY): string =>
	`---\nid: p1\ntitle: Psalm 23\n# mine\n${more}chunker: 1\n${
		progress.length === 0 ? '' : `progress:\n${progress.map((line) => `  ${line}\n`).join('')}`
	}---\n${body}`;

const progressOf = (text: string) => readProgress(parsePassageFile(text).progress).chunks;

describe('mergePassage', () => {
	it('is the same for the same file, or one with nothing new', () => {
		const ours = file([`${A}: { level: 2, reviewed: 2026-10-13T09:00:00Z }`]);
		expect(mergePassage(ours, ours)).toEqual({ kind: 'same' });
		expect(mergePassage(ours, file([]))).toEqual({ kind: 'same' });
		expect(
			mergePassage(ours, file([`${A}: { level: 1, reviewed: 2026-10-12T09:00:00Z }`]))
		).toEqual({ kind: 'same' });
	});

	it('takes each chunk from the copy practised later, and the incoming one on a tie', () => {
		const ours = file([
			`${A}: { level: 2, reviewed: 2026-10-13T09:00:00Z }`,
			`${B}: { level: 4, reviewed: 2026-10-13T09:00:00Z }`,
		]);
		const theirs = file([
			`${A}: { level: 5, due: 2026-10-14, reviewed: 2026-10-13T10:00:00Z }`,
			`${B}: { level: 3, reviewed: 2026-10-13T09:00:00Z }`,
		]);
		const merged = mergePassage(ours, theirs);
		if (merged.kind !== 'merged') throw new Error(merged.kind);
		expect(Object.fromEntries(progressOf(merged.text))).toEqual({
			[A]: { level: 5, due: '2026-10-14', reviewed: '2026-10-13T10:00:00Z' },
			[B]: { level: 3, reviewed: '2026-10-13T09:00:00Z' },
		});
		// Every other byte is ours: the comment kept, the body untouched.
		expect(merged.text).toContain('# mine\n');
		expect(merged.text.endsWith(BODY)).toBe(true);
	});

	it('adds chunks only the incoming copy has, in passage order', () => {
		const merged = mergePassage(file([`${B}: { level: 1 }`]), file([`${A}: { level: 2 }`]));
		if (merged.kind !== 'merged') throw new Error(merged.kind);
		expect([...progressOf(merged.text).keys()]).toEqual([A, B]);
	});

	it('keeps the two apart when the words or details differ', () => {
		const ours = file([`${A}: { level: 1 }`]);
		expect(mergePassage(ours, file([`${A}: { level: 2 }`], '', `${BODY}More.\n`))).toEqual({
			kind: 'apart',
		});
		expect(mergePassage(ours, file([`${A}: { level: 2 }`], 'tags: [psalm]\n'))).toEqual({
			kind: 'apart',
		});
	});

	it('does not tell details apart by how their YAML is spelt', () => {
		const ours = file([`${A}: { level: 1 }`], 'tags: [a, b]\n');
		const theirs = file(
			[`${A}: { level: 2, reviewed: 2026-10-13T09:00:00Z }`],
			'tags:\n  - a\n  - b\n'
		);
		expect(mergePassage(ours, theirs).kind).toBe('merged');
	});

	it('keeps the two apart when either cannot be read', () => {
		const broken = `---\nid: p1\ntitle: [Psalm\n---\n${BODY}`;
		expect(mergePassage(broken, file([]))).toEqual({ kind: 'apart' });
		expect(mergePassage(file([]), broken)).toEqual({ kind: 'apart' });
	});
});
