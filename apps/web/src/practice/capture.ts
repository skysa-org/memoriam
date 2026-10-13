/**
 * What was typed into the capture input, worked out from its value before and
 * after (docs/ARCHITECTURE.md §4, "Typing"). Keys are not read from `keydown`:
 * Android's keyboards send every letter there as key 229, "Unidentified", and
 * only the input's value says what it was. A keyboard composing a word changes
 * the value it has so far rather than adding to it, so what is new is what
 * follows the part both values share.
 */

/** How many code units two strings share from the start, whole characters only. */
const sharedStart = (a: string, b: string): number => {
	const chars = Array.from(a);
	const differs = chars.findIndex((char, at) => Array.from(b)[at] !== char);
	return (differs === -1 ? chars : chars.slice(0, differs)).join('').length;
};

/** The characters typed between two values of the input; none for a deletion. */
export const typedBetween = (before: string, after: string): string[] =>
	Array.from(after.slice(sharedStart(before, after)));
