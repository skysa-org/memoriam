import { describe, expect, it } from 'vitest';

import {
	readFrontmatter,
	splitFrontmatter,
	writeFrontmatter,
} from '../../src/markdown/frontmatter.js';
import { parsePassageFile } from '../../src/markdown/passage.js';

/** The fields a passage has and a note does not (docs/ARCHITECTURE.md §3). */

describe("a passage's own fields", () => {
	const file = [
		'---',
		'id: 01JAB3K7Q2',
		'title: Psalm 23',
		'source: Psalm 23 (ESV)',
		'tags: [scripture]',
		'created: 2026-10-13T14:00:00Z',
		'updated: 2026-10-13T14:00:00Z',
		'chunker: 1',
		'progress:',
		'  k3fq9ma: { level: 5, due: 2026-10-20 }',
		'  p8dz2ve: { level: 3 }',
		'---',
		'',
		'The Lord is my shepherd; I shall not want.',
		'',
	].join('\n');

	it('reads them', () => {
		const parsed = parsePassageFile(file);
		expect(parsed.source).toBe('Psalm 23 (ESV)');
		expect(parsed.chunker).toBe(1);
		expect(parsed.progress).toEqual({
			k3fq9ma: { level: 5, due: '2026-10-20' },
			p8dz2ve: { level: 3 },
		});
		expect(parsed.body).toBe('\nThe Lord is my shepherd; I shall not want.\n');
	});

	it('reads a chunker only as a whole number from 1', () => {
		['chunker: 0', 'chunker: 1.5', 'chunker: "1"', 'chunker: -2', 'chunker: [1]'].forEach(
			(yaml) => {
				expect(readFrontmatter(yaml).chunker).toBeUndefined();
			}
		);
		expect(readFrontmatter('chunker: 2').chunker).toBe(2);
	});

	it('reads progress only when it is a mapping', () => {
		expect(readFrontmatter('progress: 3').progress).toBeUndefined();
		expect(readFrontmatter('progress: [a, b]').progress).toBeUndefined();
		expect(readFrontmatter('progress:').progress).toBeUndefined();
		expect(readFrontmatter('progress: {}').progress).toEqual({});
	});

	it('writes each chunk of progress on a line of its own', () => {
		expect(
			writeFrontmatter(null, {
				id: 'abc',
				chunker: 1,
				progress: { k3fq9ma: { level: 5, misses: '0,0,2' }, p8dz2ve: { level: 3 } },
			})
		).toBe(
			[
				'id: abc',
				'chunker: 1',
				'progress:',
				'  k3fq9ma: { level: 5, misses: "0,0,2" }',
				'  p8dz2ve: { level: 3 }',
				'',
			].join('\n')
		);
	});

	it('never folds a long line', () => {
		const title = Array.from({ length: 40 }, () => 'word').join(' ');
		expect(writeFrontmatter('id: abc\n', { title })).toBe(`id: abc\ntitle: ${title}\n`);
	});

	it('leaves the block byte for byte when progress says what the file says', () => {
		const { frontmatter } = splitFrontmatter(file);
		expect(
			writeFrontmatter(frontmatter, {
				progress: { k3fq9ma: { level: 5, due: '2026-10-20' }, p8dz2ve: { level: 3 } },
			})
		).toBe(frontmatter);
	});

	it('calls the same progress in another order a change', () => {
		const { frontmatter } = splitFrontmatter(file);
		expect(
			writeFrontmatter(frontmatter, {
				progress: { p8dz2ve: { level: 3 }, k3fq9ma: { level: 5, due: '2026-10-20' } },
			})
		).toContain(
			'progress:\n  p8dz2ve: { level: 3 }\n  k3fq9ma: { level: 5, due: 2026-10-20 }\n'
		);
	});

	it('takes `chunker` as a sign of metadata, and not `source` or `progress`', () => {
		// A block the parser had to repair is frontmatter only if it names
		// something only metadata is named.
		const repaired = (key: string): string | null =>
			splitFrontmatter(`---\n${key}: x\nbad: "unterminated\n---\nbody`).frontmatter;
		expect(repaired('chunker')).not.toBeNull();
		expect(repaired('source')).toBeNull();
		expect(repaired('progress')).toBeNull();
	});
});
