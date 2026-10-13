import { PASSAGE_EXTENSION } from '../config.js';
import { foldName } from './slug.js';

/**
 * A passage's title is frontmatter `title`, else its filename, else
 * `UNTITLED_TITLE`. Not its first heading, as a note's would be: a `#` line in
 * a passage labels a section (docs/ARCHITECTURE.md §2), and the first one is
 * seldom the name of the whole.
 */
export interface DeriveTitleInput {
	frontmatterTitle?: string | undefined;
	/** Filename with extension. */
	filename?: string | undefined;
}

/**
 * The title of a passage with nothing to take a name from: kept, and compared,
 * as it is, in every language. An app shows it in the user's
 * (docs/ARCHITECTURE.md §7, "The app's words"); as a name it is `UNTITLED_SLUG`.
 */
export const UNTITLED_TITLE = 'Untitled';

/** Strip the extension and turn slug separators back into spaces. */
export const titleFromFilename = (filename: string): string => {
	const withoutExtension = foldName(filename).endsWith(PASSAGE_EXTENSION)
		? filename.slice(0, -PASSAGE_EXTENSION.length)
		: filename;
	return withoutExtension.replace(/[-_]+/g, ' ').trim();
};

export const deriveTitle = (input: DeriveTitleInput): string => {
	const fromFrontmatter = input.frontmatterTitle?.trim();
	if (fromFrontmatter) return fromFrontmatter;

	const fromFilename = input.filename === undefined ? '' : titleFromFilename(input.filename);
	return fromFilename || UNTITLED_TITLE;
};
