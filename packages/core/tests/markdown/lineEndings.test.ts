import { describe, expect, it } from 'vitest';

import {
	frontmatterIsEditable,
	splitFrontmatter,
	writeFrontmatter,
} from '../../src/markdown/frontmatter.js';
import { firstLineEnding, toLf, withLineEnding } from '../../src/markdown/lineEndings.js';
import { parsePassageFile, serializePassageFile } from '../../src/markdown/passage.js';

/**
 * A passage written on Windows, or arriving through a provider that stores what
 * it was given, ends its lines `\r\n`. CommonMark says that is the same
 * document, and so does this app: the same frontmatter, the same body, and a
 * write that keeps the file's own endings.
 */

const CRLF_NOTE = '---\r\nid: abc\r\ntitle: A\r\n---\r\n\r\n# A\r\n\r\nline one\r\nline two\r\n';
const LF_NOTE = CRLF_NOTE.replaceAll('\r\n', '\n');

describe('reading a document whose lines end the Windows way', () => {
	it('finds the frontmatter in a file whose lines end with a bare carriage return', () => {
		// The rarest spelling, and the one the splitter did not know. Missing it
		// hands the whole file to the body, where the block reads as a setext
		// heading: the note loses its id, takes its title from its own YAML, and
		// gains a second frontmatter block above the first on the next write.
		const file = '---\rid: abc\rtitle: A\r---\r\rBody\r';
		expect(splitFrontmatter(file).frontmatter).toBe('id: abc\rtitle: A');
		expect(parsePassageFile(file).id).toBe('abc');
		expect(parsePassageFile(file).title).toBe('A');
	});

	it('does not take a later fence pair for the frontmatter', () => {
		// `EOL` gained a `\r` alternative in this change, which makes a stray
		// later match likelier, and the file below does begin with `---`. With
		// the `match.index !== 0` guard gone the pattern matches at offset 11 and
		// the first sixteen bytes of the user's file are silently dropped.
		const file = '---x\nintro\n---\nid: abc\n---\nreal body\n';
		expect(splitFrontmatter(file)).toEqual({ frontmatter: null, body: file });
	});

	it('can still patch a block whose lines end with a bare carriage return', () => {
		// The YAML parser reads `\n`. Handed the block verbatim it sees one
		// unreadable scalar, decides the document is malformed, and hands the
		// block back with the patch silently dropped — so the note keeps the
		// title it had and the rename the user just typed is gone.
		expect(writeFrontmatter('id: abc\rtitle: A', { title: 'B' })).toContain('title: B');
		expect(writeFrontmatter('id: abc\rtitle: A', { title: 'B' })).toContain('id: abc');
	});

	it('calls a block whose lines end with a bare carriage return editable', () => {
		// The same misreading, reported to the user: a banner saying the app
		// will not touch the frontmatter of a note whose frontmatter is fine.
		expect(frontmatterIsEditable('id: abc\rtitle: A')).toBe(true);
	});
});

describe('writing a passage file', () => {
	const rewrite = (file: string): string => {
		const { frontmatter, body } = splitFrontmatter(file);
		return serializePassageFile({ frontmatter, body, metadata: {} });
	};

	it('gives back a Windows note byte for byte when nothing is patched', () => {
		expect(rewrite(CRLF_NOTE)).toBe(CRLF_NOTE);
	});

	it('gives back a Unix note byte for byte when nothing is patched', () => {
		expect(rewrite(LF_NOTE)).toBe(LF_NOTE);
	});

	it('does not mix the two when it adds frontmatter to a Windows note', () => {
		// The import path: a note arrives with no id and is given one. Writing
		// an `\n` block above a `\r\n` body makes a file no tool authors, and
		// every line of it reads as changed to anything comparing line by line.
		const written = serializePassageFile({
			frontmatter: null,
			body: '# A\r\n\r\nbody\r\n',
			metadata: { id: 'x' },
		});
		expect(written).toBe('---\r\nid: x\r\n---\r\n\r\n# A\r\n\r\nbody\r\n');
		expect(written.split('\r\n').join('')).not.toContain('\n');
	});

	it('does not add a second blank line to a Windows body that opens with one', () => {
		// The separator exists so a note gaining frontmatter gets the customary
		// blank line after the closing fence. A body that already opens with one
		// must not be given another — and on a Windows note that line is `\r\n`,
		// which a check written only for `\n` does not recognise.
		expect(
			serializePassageFile({ frontmatter: null, body: '\r\nbody\r\n', metadata: { id: 'x' } })
		).toBe('---\r\nid: x\r\n---\r\n\r\nbody\r\n');
	});

	it('still gives a body with no line ending at all its blank line', () => {
		expect(
			serializePassageFile({ frontmatter: null, body: 'body', metadata: { id: 'x' } })
		).toBe('---\nid: x\n---\n\nbody');
	});

	it('still writes a Unix note the Unix way', () => {
		expect(
			serializePassageFile({
				frontmatter: null,
				body: '# A\n\nbody\n',
				metadata: { id: 'x' },
			})
		).toBe('---\nid: x\n---\n\n# A\n\nbody\n');
	});

	it('is not talked into CRLF by a carriage return inside a code fence', () => {
		// A Unix file carrying one `\r\n` as *content*, in a code sample. It is
		// not the file's line-ending style and must not decide how the block
		// above it is written — otherwise one byte of a code block flips every
		// frontmatter line of an otherwise Unix note, and `git diff` shows the
		// whole block as changed.
		const file = '---\nid: x\n---\n\n```\nfoo\r\nbar\n```\n';
		const { frontmatter, body } = splitFrontmatter(file);
		const written = serializePassageFile({ frontmatter, body, metadata: { title: 'T' } });

		expect(written).toBe('---\nid: x\ntitle: T\n---\n\n```\nfoo\r\nbar\n```\n');
		expect(written.slice(0, written.indexOf('```'))).not.toContain('\r');
	});

	it('settles for Unix when neither the body nor the block has an ending to give', () => {
		// The bounded gap, asserted rather than left to be discovered: a block
		// has interior line endings only if it holds two or more keys, so a
		// one-key CRLF note whose body has no line ending either has nothing
		// left to ask, and renaming it rewrites its four lines as `\n`. Closing
		// this means carrying the ending the fences had, which only
		// `splitFrontmatter` sees and nothing stores.
		expect(
			serializePassageFile({ frontmatter: 'id: x', body: 'Hello', metadata: { title: 'B' } })
		).toBe('---\nid: x\ntitle: B\n---\nHello');
	});

	it('keeps a Windows note Windows when its body has no line ending to ask', () => {
		// A one-line body with no trailing newline, and an empty one. Asking the
		// body alone answers `\n` for both, which silently converts the whole
		// block of a file that arrived CRLF.
		for (const body of ['Hello', '']) {
			expect(
				serializePassageFile({
					frontmatter: 'id: x\r\ntitle: A',
					body,
					metadata: { title: 'B' },
				})
			).toBe(`---\r\nid: x\r\ntitle: B\r\n---\r\n${body}`);
		}
	});

	it('follows the body once an editor has rewritten it, not the old block', () => {
		// The other direction, and why the body is asked first: a Windows note
		// edited in either editor comes back `\n`, and the block has to follow
		// it or the saved file mixes the two for ever after.
		expect(
			serializePassageFile({
				frontmatter: 'id: x\r\ntitle: A',
				body: '\nedited\n',
				metadata: {},
			})
		).toBe('---\nid: x\ntitle: A\n---\n\nedited\n');
	});

	it('leaves a body with no frontmatter and nothing to write completely alone', () => {
		// `yaml === ''` returns early. A Windows note with no metadata to add
		// must come back untouched rather than folded on the way past.
		expect(serializePassageFile({ frontmatter: null, body: 'a\r\nb\r\n', metadata: {} })).toBe(
			'a\r\nb\r\n'
		);
	});

	it('does not give a note that already had frontmatter an extra blank line', () => {
		// The separator is only for a file gaining a block for the first time.
		// A note that had one keeps whatever separator its body already carries,
		// and rewriting it on every save would walk the body down the file.
		expect(
			serializePassageFile({ frontmatter: 'id: x', body: 'no blank line\n', metadata: {} })
		).toBe('---\nid: x\n---\nno blank line\n');
	});
});

describe('the helpers themselves', () => {
	it('folds every spelling of a line ending', () => {
		expect(toLf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
	});

	it('reports the first ending in the text, not whichever appears somewhere', () => {
		expect(firstLineEnding('a\nb\r\nc')).toBe('\n');
		expect(firstLineEnding('a\r\nb\nc')).toBe('\r\n');
		expect(firstLineEnding('a\rb\nc')).toBe('\r');
	});

	it('has no answer for a text with no line ending', () => {
		expect(firstLineEnding('one line')).toBeUndefined();
		expect(firstLineEnding('')).toBeUndefined();
	});

	it('rewrites endings whatever the text used before', () => {
		expect(withLineEnding('a\nb\r\nc', '\r\n')).toBe('a\r\nb\r\nc');
		expect(withLineEnding('a\r\nb\nc', '\n')).toBe('a\nb\nc');
		expect(withLineEnding('a\r\nb\nc', '\r')).toBe('a\rb\rc');
	});
});
