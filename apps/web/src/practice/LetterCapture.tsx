import { type RefObject, useRef } from 'react';

import { typedBetween } from './capture.js';

/**
 * The one input practice is typed into: hidden, and kept focused, so a phone
 * keeps its keyboard up from the first tap on Start to the end of the session
 * (docs/ARCHITECTURE.md §4, "Typing"). Nothing it is given is corrected,
 * capitalised or suggested, and its type is at least 16px, or iOS zooms the
 * page on focus.
 *
 * Its value is emptied after each read, but not while a keyboard is composing
 * a word in it: emptied then, the keyboard puts its word back.
 */
export const LetterCapture = ({
	inputRef,
	label,
	onKeys,
	onEnter,
}: Readonly<{
	inputRef: RefObject<HTMLInputElement | null>;
	label: string;
	onKeys: (keys: readonly string[], at: number) => void;
	onEnter: () => void;
}>) => {
	const seen = useRef('');
	const composing = useRef(false);

	const read = (input: HTMLInputElement) => {
		const keys = typedBetween(seen.current, input.value);
		seen.current = input.value;
		if (!composing.current) {
			input.value = '';
			seen.current = '';
		}
		if (keys.length > 0) onKeys(keys, performance.now());
	};

	return (
		<input
			ref={inputRef}
			className="letter-capture"
			type="text"
			aria-label={label}
			autoComplete="off"
			autoCorrect="off"
			autoCapitalize="off"
			spellCheck={false}
			enterKeyHint="next"
			onInput={(event) => {
				read(event.currentTarget);
			}}
			onCompositionStart={() => {
				composing.current = true;
			}}
			onCompositionEnd={(event) => {
				composing.current = false;
				read(event.currentTarget);
			}}
			onKeyDown={(event) => {
				if (event.key !== 'Enter') return;
				event.preventDefault();
				onEnter();
			}}
		/>
	);
};
