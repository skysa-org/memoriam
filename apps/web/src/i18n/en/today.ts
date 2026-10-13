/** The first screen: what there is to practise today. */
export const today = {
	title: 'Today',
	/** Before any passage has been added. */
	empty: 'Nothing to learn yet. Add a passage to your library to begin.',
	add: 'Add a passage',
	/** Before practice is scheduled: what there is, and where to find it. */
	ready: {
		one: 'You have {count} passage in your library.',
		other: 'You have {count} passages in your library.',
	},
	open: 'Open the library',
} as const;
