import { type PassageWord, type Shown, type Typing } from '@memoriam/core';

import { type ShownLine } from '../components/shownPassage.js';

/**
 * A chunk being typed: each word as far as the pass has got (docs/ARCHITECTURE.md
 * §4). Typed words are shown, a missed one marked; the word to type shows its
 * hint, or in red after a wrong key; the rest are shown, hidden as
 * placeholders the length of the word, or, at the top level, not there at
 * all until they are typed.
 */

type State = 'typed' | 'missed' | 'wrong' | 'hint' | 'outline' | Shown;

const stateOf = (typing: Typing, shown: Shown, at: number): State => {
	const result = typing.results[at];
	if (result !== undefined) return result.missed ? 'missed' : 'typed';
	if (at !== typing.results.length) return shown;
	if (typing.wrong !== undefined) return 'wrong';
	if (typing.hint === 'word') return 'hint';
	return typing.hint === 'outline' ? 'outline' : shown;
};

/** Whether a word's text can be read: everything but a placeholder and the bare top level. */
const legible = (state: State): boolean => state !== 'placeholder' && state !== 'bare';

export const ChunkView = ({
	lines,
	start,
	shown,
	typing,
	label,
	onTap,
}: Readonly<{
	lines: readonly ShownLine[];
	/** The chunk's first word's index in the passage. */
	start: number;
	shown: readonly Shown[];
	typing: Typing;
	label: string;
	onTap: () => void;
}>) => (
	<div
		className="chunk-view"
		role="group"
		aria-label={label}
		onPointerDown={(event) => {
			// Keep the focus in the capture input, and with it the keyboard.
			event.preventDefault();
			onTap();
		}}
	>
		{lines.map((line) => {
			const at = (word: PassageWord) => word.index - start;
			const states = line.words.map((word) =>
				stateOf(typing, shown[at(word)] ?? 'word', at(word))
			);
			const first = line.words[0];
			// At the top level a line is not there until its first word is reached.
			if (
				first === undefined ||
				(states[0] === 'bare' && at(first) > typing.results.length)
			) {
				return null;
			}
			return (
				<span key={first.index} className="chunk-line">
					{line.lead}
					{line.words.map((word, n) => {
						const state = states[n] ?? 'word';
						const current = at(word) === typing.results.length;
						if (state === 'bare') {
							return current ? (
								<span key={word.index} className="chunk-caret" aria-hidden="true" />
							) : null;
						}
						return (
							<span key={word.index}>
								<span
									className={`chunk-word ${state}${current ? ' current' : ''}`}
									aria-hidden={legible(state) ? undefined : true}
								>
									{word.text}
								</span>
								{word.after}
							</span>
						);
					})}
				</span>
			);
		})}
	</div>
);
