/**
 * Line endings, which CommonMark says are interchangeable.
 *
 * The spec defines a line ending as `\n`, `\r\n` or `\r` and draws no
 * distinction between them, so two files differing only in how their lines end
 * are the same passage: the same lines, the same sections, the same chunks and
 * so the same chunk keys. A passage written on Windows, or arriving through a
 * provider that stores CRLF, is read as `\n` (`toLf`) before anything counts
 * its lines, and written back the way it came (`withLineEnding`), so a file is
 * never given a second style it did not have.
 *
 * See docs/ARCHITECTURE.md §3. https://spec.commonmark.org/0.31.2/#line-ending
 */

/** The three spellings, which are one thing to a reader and three to a writer. */
export type LineEnding = '\r\n' | '\n' | '\r';

/** CRLF first, or the alternation would match its `\r` and leave the `\n`. */
const ANY_ENDING = /\r\n|\n|\r/;

/** Every line ending as `\n`, so a document is read the way the spec reads it. */
export const toLf = (text: string): string => text.replace(/\r\n|\r/g, '\n');

/**
 * The ending `text` uses, taken from the **first** one in it, or `undefined`
 * when it has none.
 *
 * Deliberately the first, and not "whichever appears anywhere". A line ending
 * pasted from somewhere else is content that arrived with it, and a document
 * is not CRLF because one pasted line is — asking "does it contain a `\r\n`"
 * lets a single byte decide how the rest of the file gets written. The first ending is the one between the document's own
 * first two lines, which is as close to "how is this file written" as a string
 * can answer.
 */
export const firstLineEnding = (text: string): LineEnding | undefined => {
	const found = ANY_ENDING.exec(text);
	return found === null ? undefined : (found[0] as LineEnding);
};

/** `text` rewritten to end its lines the given way, whatever it used before. */
export const withLineEnding = (text: string, ending: LineEnding): string =>
	ending === '\n' ? toLf(text) : toLf(text).replaceAll('\n', ending);
