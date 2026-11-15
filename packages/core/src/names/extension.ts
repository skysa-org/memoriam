import { foldName } from './fold.js';

/**
 * Where a name's extension starts — at its dot — or the name's length where it
 * has none: a dot and up to sixteen characters with no dot, space or
 * separator, at the end, and not at the start, where the dot makes a hidden
 * file (`.env`) rather than an extension with no stem. Bounded, so the stem is
 * always what gives way to fit a name: another tool's
 * `minutes.2026-01-01 with the board` has no extension, only a stem with a dot
 * in it.
 */
export const extensionAt = (name: string): number => {
	const match = /\.[^./\\\s]{1,16}$/u.exec(name);
	return match === null || match.index === 0 ? name.length : match.index;
};

/**
 * A file's extension, folded, without its dot: `Photo.PNG` is `png`. Empty
 * where there is none, a hidden file's leading dot included.
 */
export const extensionOf = (name: string): string =>
	foldName(name.slice(extensionAt(name)).slice(1));
