/** The first screen: what there is to practise today. */
export const today = {
	title: 'Today',
	/** Before any passage has been added. */
	empty: 'Nothing to learn yet. Add a passage to your library to begin.',
	add: 'Add a passage',
	reviews: {
		one: '{count} part to review.',
		other: '{count} parts to review.',
	},
	newWords: {
		one: '{count} new word to learn.',
		other: '{count} new words to learn.',
	},
	start: 'Start',
	done: 'You are done for today. Each part you have learnt comes back for review when it is due.',
	more: 'To learn more today, open a passage in your library and practise it.',
	open: 'Open the library',
} as const;
