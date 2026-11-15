import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Code cites the design by section (`docs/ARCHITECTURE.md §10, "Push timing"`,
 * `docs/research.md` §2.1), and nothing else notices when one stops leading
 * anywhere. Beside `docComments.test.ts`, for the reason it gives.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const under = (path: string): readonly string[] =>
	readdirSync(join(ROOT, path), { recursive: true, encoding: 'utf8' }).map((file) =>
		join(path, file)
	);

type Doc = 'ARCHITECTURE' | 'research';
const DOCS: Readonly<Record<string, Doc>> = {
	'docs/ARCHITECTURE.md': 'ARCHITECTURE',
	'docs/research.md': 'research',
};

const CITING = [
	...[
		'apps/web/src',
		'apps/web/tests',
		'apps/api/src',
		'apps/api/tests',
		'packages/core/src',
		'packages/core/tests',
	]
		.flatMap(under)
		.filter((file) => /\.(?:tsx?|css|mjs)$/u.test(file)),
	'apps/web/brand.ts',
	'apps/web/pwa.ts',
	'apps/web/vite.config.ts',
	'apps/web/public/_headers',
	'apps/api/wrangler.toml',
	'eslint.config.js',
	'CLAUDE.md',
	'CONTRIBUTING.md',
	'README.md',
	'docs/self-hosting.md',
	...Object.keys(DOCS),
];

/** A comment's or a paragraph's words, with its line breaks and margins taken out. */
const unwrapped = (text: string): string =>
	text.replace(/\s*\n\s*(?:\*\s|\/\/\s|>\s|#\s)?\s*/gu, ' ');
const withoutFences = (text: string): string => text.replace(/^```[\s\S]*?^```/gmu, '');

/** A section by its number, and the names under it: headings, and the bold words a paragraph or an item opens with. */
type Entry = Readonly<{ number: string; name: string }>;

const entriesOf = (text: string): readonly Entry[] =>
	withoutFences(text)
		.split('\n')
		.reduce<Readonly<{ at: readonly string[]; found: readonly Entry[] }>>(
			({ at, found }, line) => {
				const numbered = /^#{2,3} (\d+(?:\.\d+)*)\.? (.*)$/u.exec(line);
				if (numbered) {
					const number = String(numbered[1]);
					const top = number.split('.')[0] ?? number;
					const here = number === top ? [top] : [top, number];
					const name = String(numbered[2]).toLowerCase();
					return {
						at: here,
						found: [...found, ...here.map((n) => ({ number: n, name }))],
					};
				}
				const named =
					/^#{2,3} (.*)$/u.exec(line) ??
					/^\s*(?:(?:[-+*]|\d+\.)\s+)?\*\*([^*\n]+)\*\*/u.exec(line);
				if (!named) return { at, found };
				const name = String(named[1]).toLowerCase();
				return { at, found: [...found, ...at.map((number) => ({ number, name }))] };
			},
			{ at: [], found: [] }
		).found;

const ENTRIES: Readonly<Record<Doc, readonly Entry[]>> = {
	ARCHITECTURE: entriesOf(read('docs/ARCHITECTURE.md')),
	research: entriesOf(read('docs/research.md')),
};

const architecture = read('docs/ARCHITECTURE.md');
const anchors = [...architecture.matchAll(/<a id="([^"]+)"><\/a>/gu)].map(([, id]) => String(id));

/** Whether a doc has a section by this number: ARCHITECTURE's by its anchor, `s10`. */
const hasNumber = (doc: Doc, number: string): boolean =>
	doc === 'ARCHITECTURE'
		? anchors.includes(`s${number.replaceAll('.', '-')}`)
		: ENTRIES.research.some((entry) => entry.number === number);

/** Whether a name is how a heading or a lead-in of that section begins, a whole word at its end. */
const hasName = (doc: Doc, number: string, name: string): boolean =>
	ENTRIES[doc].some(
		(entry) =>
			entry.number === number &&
			entry.name.startsWith(name.toLowerCase()) &&
			!/\w/u.test(entry.name.charAt(name.length))
	);

/**
 * What names the document a `§` is in: this repo's two, or another (skysa-notes',
 * an RFC, the ZIP format's note), whose sections are not this test's to check.
 */
const MARKER =
	/(?:skysa-notes'\s*`?(?:docs\/)?ARCHITECTURE\.md`?|`?(?:docs\/)?(ARCHITECTURE|research)\.md`?|RFC \d+|OpenID Connect Core|APPNOTE\.TXT|skysa-notes')[,(]?\s*/gu;
const docOf = (word: string | undefined): Doc | undefined =>
	word === 'ARCHITECTURE' || word === 'research' ? word : undefined;

/** `exact` when its document is named right before it, so its number can be held to account. */
type Citation = Readonly<{ doc: Doc; number: string; name?: string; exact: boolean }>;

/**
 * Each `§` in a text, with what it cites. One right after a document's name is
 * that document's. One standing alone is its own document's in the docs, and in
 * code the last document named above it, which is this repo's ARCHITECTURE when
 * none is: its number is too loose to check there, and only its name is.
 */
const citations = (file: string, text: string): readonly Citation[] => {
	const flat = unwrapped(text);
	const markers = [...flat.matchAll(MARKER)].map((match) => ({
		end: match.index + match[0].length,
		doc: docOf(match[1]),
	}));
	return [...flat.matchAll(/§(\d+(?:\.\d+)*)(?:,? ["“]([^"”]{3,80})["”])?/gu)].flatMap(
		(match) => {
			const adjacent = markers.find((marker) => marker.end === match.index);
			const nearest = markers.filter((marker) => marker.end <= match.index).at(-1);
			const own = DOCS[file];
			const doc = adjacent ? adjacent.doc : (own ?? (nearest ? nearest.doc : 'ARCHITECTURE'));
			if (doc === undefined) return [];
			const name = match[2]?.replace(/[.,]$/u, '');
			return [
				{
					doc,
					number: String(match[1]),
					...(name === undefined ? {} : { name }),
					exact: adjacent !== undefined || own !== undefined,
				},
			];
		}
	);
};

const citedAnchors = (text: string): readonly string[] =>
	[...text.matchAll(/ARCHITECTURE\.md#([a-z0-9-]+)/gu)].map(([, id]) => String(id));

/** Each `[…](path)` in a markdown text, outside its code, that points at another file. */
const links = (text: string): readonly string[] =>
	[...text.replace(/```[\s\S]*?```|`[^`\n]*`/gu, '').matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/gu)]
		.map(([, target]) => String(target))
		.filter((target) => !/^[a-z]+:/u.test(target));

/**
 * The paths §11 names, each under the directories its row is indented below.
 * A row is a path or several in its first 23 columns, and then what they are.
 */
const NAMES_WIDTH = 23;
const layoutPaths = (text: string): readonly string[] => {
	const section = text.slice(text.indexOf('<a id="repository-layout">'));
	const open = section.indexOf('```') + 3;
	const block = section.slice(open, section.indexOf('```', open));
	return block
		.split('\n')
		.reduce<Readonly<{ above: readonly string[]; found: readonly string[] }>>(
			({ above, found }, row) => {
				const names = row.slice(0, NAMES_WIDTH).trim().split(/\s+/u).filter(Boolean);
				const first = names[0];
				if (first === undefined) return { above, found };
				const parents = above.slice(0, (row.length - row.trimStart().length) / 2);
				return {
					above: first.endsWith('/') ? [...parents, first.slice(0, -1)] : parents,
					found: [
						...found,
						...names.map((name) => [...parents, name.replace(/\/$/u, '')].join('/')),
					],
				};
			},
			{ above: [], found: [] }
		).found;
};

describe('the docs', () => {
	const cited = CITING.flatMap((file) =>
		citations(file, read(file)).map((citation) => ({ file, ...citation }))
	);

	it('finds what it is meant to look at', () => {
		expect(cited.filter(({ doc }) => doc === 'ARCHITECTURE').length).toBeGreaterThan(150);
		expect(cited.filter(({ doc }) => doc === 'research').length).toBeGreaterThan(20);
		expect(cited.filter(({ name }) => name !== undefined).length).toBeGreaterThan(50);
		expect(layoutPaths(architecture)).toContain('packages/core/src/sync');
	});

	it('reads a citation across the lines of a comment', () => {
		expect(citations('a.ts', ' * docs/ARCHITECTURE.md §10,\n * "Push timing").')).toEqual([
			{ doc: 'ARCHITECTURE', number: '10', name: 'Push timing', exact: true },
		]);
		expect(citations('a.ts', '(`docs/research.md` §2.1)')).toEqual([
			{ doc: 'research', number: '2.1', exact: true },
		]);
		expect(citations('a.ts', `skysa-notes' docs/ARCHITECTURE.md §7, "Pushing files"`)).toEqual(
			[]
		);
		expect(citations('a.ts', 'RFC 9110 §10.2.3, which says')).toEqual([]);
	});

	it('has every citation by number lead to a section', () => {
		const lost = cited
			.filter(({ exact, doc, number }) => exact && !hasNumber(doc, number))
			.map(({ file, doc, number }) => `${file}: ${doc} §${number}`);
		expect(lost).toEqual([]);
	});

	it('has every citation by name lead to that section', () => {
		const lost = cited.flatMap(({ file, doc, number, name }) =>
			name === undefined || hasName(doc, number, name)
				? []
				: [`${file}: ${doc} §${number}, "${name}"`]
		);
		expect(lost).toEqual([]);
	});

	it('has every citation by anchor lead to one', () => {
		const lost = CITING.flatMap((file) =>
			citedAnchors(read(file))
				.filter((id) => !anchors.includes(id))
				.map((id) => `${file}: #${id}`)
		);
		expect(lost).toEqual([]);
	});

	it('cites a phase where the phases are', () => {
		const stale = CITING.filter((file) =>
			/ARCHITECTURE\.md`?,? (?:the )?Phase \d/u.test(unwrapped(read(file)))
		);
		expect(stale).toEqual([]);
	});

	it('has an anchor, its own and its number, on every section', () => {
		const lines = withoutFences(architecture).split('\n');
		const bare = lines.filter(
			(line, at) =>
				/^## (\d+)\./u.test(line) &&
				!(lines[at - 1] ?? '').endsWith(`<a id="s${line.slice(3, line.indexOf('.'))}"></a>`)
		);
		expect(bare).toEqual([]);
		expect(anchors.filter((id, at) => anchors.indexOf(id) !== at)).toEqual([]);
	});

	it('links only to files that are there', () => {
		const dead = CITING.filter((file) => file.endsWith('.md')).flatMap((file) =>
			links(read(file))
				.filter((target) => !existsSync(join(ROOT, dirname(file), target)))
				.map((target) => `${file}: ${target}`)
		);
		expect(dead).toEqual([]);
	});

	describe('§11, the repository layout', () => {
		const paths = layoutPaths(architecture);

		it('names only paths that are there', () => {
			expect(paths.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
		});

		it.each(['apps/web/src', 'apps/api/src', 'packages/core/src'])(
			'has a row for each directory at the top of %s',
			(source) => {
				const directories = readdirSync(join(ROOT, source), { withFileTypes: true })
					.filter((entry) => entry.isDirectory())
					.map((entry) => join(source, entry.name));
				expect(directories.filter((directory) => !paths.includes(directory))).toEqual([]);
			}
		);
	});
});
