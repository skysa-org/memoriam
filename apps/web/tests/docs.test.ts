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
	'apps/web/pwaApp.ts',
	'apps/web/vite.config.ts',
	'apps/web/public/_headers',
	'apps/api/wrangler.toml',
	'eslint.config.js',
	'CLAUDE.md',
	'CONTRIBUTING.md',
	'README.md',
	'docs/self-hosting.md',
	'SECURITY.md',
	'apps/web/brand/README.md',
	...Object.keys(DOCS),
];

/** A comment's or a paragraph's words, with its line breaks and margins taken out. */
const unwrapped = (text: string): string =>
	text.replace(/\s*\n\s*(?:\*\s|\/\/\s|>\s|#\s)?\s*/gu, ' ');
const withoutFences = (text: string): string => text.replace(/^```[\s\S]*?^```/gmu, '');

/** The section a number is in, at the top: §10 for §10.2. */
const topOf = (number: string): string => number.split('.')[0] ?? number;

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
					const top = topOf(number);
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

/** Whether a name is how an entry's name begins, a whole word at its end. */
const begins = (entry: string, name: string): boolean =>
	entry.startsWith(name.toLowerCase()) && !/\w/u.test(entry.charAt(name.length));

/** Whether a name is how a heading or a lead-in of that section begins. */
const hasName = (doc: Doc, number: string, name: string): boolean =>
	ENTRIES[doc].some((entry) => entry.number === number && begins(entry.name, name));

/**
 * What names the document a `§` is in: this repo's two, skysa-notes', or
 * another (the shared kit's, an RFC, the ZIP format's note), whose sections are
 * not this test's to check. skysa-notes' are checked only for what moved to the
 * kit ("cites the kit, not skysa-notes"). skysa-notes' name without its
 * ARCHITECTURE's is often its code's ("as skysa-notes' (§10)" is this repo's
 * §10), so it names the document only of a `§` right after it, with no `(` or
 * `:` between.
 */
const MARKER =
	/(?:([Ss]kysa-notes(?:['’]s?)?)(\s*(?:own\s+)?`?(?:docs\/)?ARCHITECTURE(?:\.md)?`?)?|`?(?:docs\/)?(ARCHITECTURE|research)\.md`?|RFC \d+|OpenID Connect Core|APPNOTE\.TXT|\[kit|\b(?:skysa-)?kit(?:['’]s)?\s*(?:own\s+)?`?(?:docs\/)?ARCHITECTURE\.md`?)\s*[,(:]?\s*/gu;
type Cited = Doc | 'skysa-notes';
const docOf = (notes: string | undefined, word: string | undefined): Cited | undefined => {
	if (notes !== undefined) return 'skysa-notes';
	return word === 'ARCHITECTURE' || word === 'research' ? word : undefined;
};

/** `exact` when its document is named right before it, so its number can be held to account. */
type Citation = Readonly<{ doc: Cited; number: string; name?: string; exact: boolean }>;

/**
 * Each `§` in a text, with what it cites. One right after a document's name is
 * that document's. One standing alone is its own document's in the docs, and in
 * code the last of this repo's documents named above it, ARCHITECTURE when none
 * is: its number is too loose to check there, and only its name is. Another
 * document's name is that of the `§` right after it and no other, so a file
 * that cites one does not hide what it cites of this repo's after it.
 */
const citations = (file: string, text: string): readonly Citation[] => {
	const flat = unwrapped(text);
	const markers = [...flat.matchAll(MARKER)].flatMap((match) =>
		match[1] !== undefined && match[2] === undefined && /[(:]\s*$/u.test(match[0])
			? []
			: [{ end: match.index + match[0].length, doc: docOf(match[1], match[3]) }]
	);
	return [...flat.matchAll(/§(\d+(?:\.\d+)*)(?:,? ["“]([^"”]{3,80})["”])?/gu)].flatMap(
		(match) => {
			const adjacent = markers.find((marker) => marker.end === match.index);
			const nearest = markers
				.filter(
					(marker) =>
						marker.end <= match.index &&
						(marker.doc === 'ARCHITECTURE' || marker.doc === 'research')
				)
				.at(-1);
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

/**
 * Whether a citation of skysa-notes' ARCHITECTURE may be of design that moved
 * to the shared kit, which this repo cites at the kit now (skysa-notes' record
 * 0018, step 5). Most of its sections hold some of each, and its names for the
 * kit's parts have changed since this repo was ported from it, so a list of
 * those would miss the older ones. What is listed instead is the parts that
 * stayed skysa-notes' own and that this repo cites, by section, as its
 * headings name them. One is added here once skysa-notes' document is checked
 * for it; any other citation of it by section fails.
 */
const NOTES_OWN: Readonly<Record<string, readonly string[]>> = {
	'7': ['IndexedDB schema (Dexie)'],
};
const unlisted = ({ doc, number, name, exact }: Citation): boolean =>
	doc === 'skysa-notes' &&
	exact &&
	(name === undefined ||
		!(NOTES_OWN[topOf(number)] ?? []).some((part) => begins(part.toLowerCase(), name)));

/**
 * skysa-notes' name and its ARCHITECTURE, and a section's mark, as the
 * examples here write them, so that an example is not a citation in this file
 * of its own.
 */
const NAME = "skysa-notes'";
const NOTES = `${NAME} docs/ARCHITECTURE.md`;
const AT = '§';

/** Each anchor of this repo's ARCHITECTURE a text links to: not the shared kit's, which is its own. */
const citedAnchors = (text: string): readonly string[] =>
	[...text.matchAll(/(?<!skysa-kit\/blob\/[^/\s)]+\/docs\/)ARCHITECTURE\.md#([a-z0-9-]+)/gu)].map(
		([, id]) => String(id)
	);

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
	const ours = cited.filter(
		(citation): citation is typeof citation & Readonly<{ doc: Doc }> =>
			citation.doc !== 'skysa-notes'
	);

	it('finds what it is meant to look at', () => {
		expect(ours.filter(({ doc }) => doc === 'ARCHITECTURE').length).toBeGreaterThan(150);
		expect(ours.filter(({ doc }) => doc === 'research').length).toBeGreaterThan(20);
		expect(ours.filter(({ name }) => name !== undefined).length).toBeGreaterThan(50);
		expect(cited.filter(({ doc, exact }) => doc === 'skysa-notes' && exact)).not.toEqual([]);
		expect(layoutPaths(architecture)).toContain('packages/core/src/sync');
	});

	it('reads a citation across the lines of a comment', () => {
		expect(citations('a.ts', ' * docs/ARCHITECTURE.md §10,\n * "Push timing").')).toEqual([
			{ doc: 'ARCHITECTURE', number: '10', name: 'Push timing', exact: true },
		]);
		expect(citations('a.ts', '(`docs/research.md` §2.1)')).toEqual([
			{ doc: 'research', number: '2.1', exact: true },
		]);
		expect(citations('a.ts', `${NOTES} ${AT}7, "Pushing files"`)).toEqual([
			{ doc: 'skysa-notes', number: '7', name: 'Pushing files', exact: true },
		]);
		expect(citations('a.ts', `as ${NAME} ${AT}6`)).toEqual([
			{ doc: 'skysa-notes', number: '6', exact: true },
		]);
		expect(citations('a.ts', `rows as ${NAME} (\`Row\`)\n * (${AT}10, "Files")`)).toEqual([
			{ doc: 'ARCHITECTURE', number: '10', name: 'Files', exact: false },
		]);
		expect(citations('a.ts', '`docs/ARCHITECTURE.md` (§3)')).toEqual([
			{ doc: 'ARCHITECTURE', number: '3', exact: true },
		]);
		expect(citations('a.ts', 'RFC 9110 §10.2.3, which says')).toEqual([]);
		expect(
			citations(
				'docs/ARCHITECTURE.md',
				'([kit §6, "Backend"](https://github.com/skysa-org/skysa-kit/blob/main/docs/ARCHITECTURE.md#backend))'
			)
		).toEqual([]);
		expect(citations('a.ts', `the kit's docs/ARCHITECTURE.md §7, "Sync engine"`)).toEqual([]);
		expect(citations('a.ts', 'the kit’s docs/ARCHITECTURE.md §7')).toEqual([]);
		expect(
			citations('a.ts', `the shared kit's docs/ARCHITECTURE.md §7, "Sync engine"`)
		).toEqual([]);
		expect(citations('a.ts', "skysa-kit's docs/ARCHITECTURE.md §7")).toEqual([]);
		expect(citations('a.ts', "The kit's docs/ARCHITECTURE.md §6")).toEqual([]);
		expect(citations('a.ts', "the kit's own docs/ARCHITECTURE.md §6")).toEqual([]);
		expect(citations('a.ts', 'skysa-kit `docs/ARCHITECTURE.md` §6')).toEqual([]);
		expect(
			citations('a.ts', `the kit's docs/ARCHITECTURE.md §7.\n * Then §10, "Push timing"`)
		).toEqual([{ doc: 'ARCHITECTURE', number: '10', name: 'Push timing', exact: false }]);
		expect(citations('a.ts', `as ${NAME} (${AT}10, "Push timing")`)).toEqual([
			{ doc: 'ARCHITECTURE', number: '10', name: 'Push timing', exact: false },
		]);
		expect(citations('a.ts', `the kit's server; see §10, "Push timing"`)).toEqual([
			{ doc: 'ARCHITECTURE', number: '10', name: 'Push timing', exact: false },
		]);
		expect(
			citedAnchors(
				'(https://github.com/skysa-org/skysa-kit/blob/main/docs/ARCHITECTURE.md#backend)' +
					' (https://github.com/skysa-org/skysa-kit/blob/v1.1.0/docs/ARCHITECTURE.md#backend)'
			)
		).toEqual([]);
	});

	it('has every citation by number lead to a section', () => {
		const lost = ours
			.filter(({ exact, doc, number }) => exact && !hasNumber(doc, number))
			.map(({ file, doc, number }) => `${file}: ${doc} §${number}`);
		expect(lost).toEqual([]);
	});

	it('has every citation by name lead to that section', () => {
		const lost = ours.flatMap(({ file, doc, number, name }) =>
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

	it('cites the kit, not skysa-notes, for the design that moved to it', () => {
		const flagged = (text: string) => citations('a.ts', text).filter(unlisted).length;
		expect(flagged(`${NOTES} ${AT}6, "Backend"`)).toBe(1);
		expect(flagged(` * (${NOTES}\n * ${AT}7): the copy`)).toBe(1);
		expect(flagged(`(${NOTES} ${AT}5.1)`)).toBe(1);
		expect(flagged(`${NOTES} (${AT}7)`)).toBe(1);
		expect(flagged(`${NOTES}: ${AT}7`)).toBe(1);
		expect(flagged(`as each provider in ${NAME} ${AT}5.`)).toBe(1);
		expect(flagged(`${NOTES} ${AT}7, "Pulling files"`)).toBe(1);
		expect(flagged(`${NOTES} ${AT}7, "When a push goes"`)).toBe(1);
		expect(flagged(`${NOTES} ${AT}15`)).toBe(1);
		expect(flagged(`skysa-notes \`docs/ARCHITECTURE.md\` ${AT}6`)).toBe(1);
		expect(flagged(`skysa-notes's docs/ARCHITECTURE.md ${AT}6`)).toBe(1);
		expect(flagged(`${NAME} own docs/ARCHITECTURE.md ${AT}6`)).toBe(1);
		expect(flagged(`${NAME} ARCHITECTURE ${AT}7`)).toBe(1);
		expect(flagged(`${NOTES} ${AT}7, "IndexedDB schema (Dexie)"`)).toBe(0);
		expect(flagged(`${NOTES} ${AT}7, "IndexedDB schema"`)).toBe(0);
		expect(flagged(`${NOTES} ${AT}7, "IndexedDB schemata"`)).toBe(1);
		expect(flagged(`${NOTES} ${AT}8, "IndexedDB schema (Dexie)"`)).toBe(1);
		expect(flagged(`${NAME} sync/account.ts, as ${AT}10, "Connecting"`)).toBe(0);
		expect(flagged(`${NOTES} has more.\n * Then ${AT}10`)).toBe(0);

		const stale = cited
			.filter(unlisted)
			.map(({ file, number, name }) => `${file}: §${number}${name ? `, "${name}"` : ''}`);
		expect(stale).toEqual([]);
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
