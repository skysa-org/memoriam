/** The first screen: what there is to practise today. */
export const today = {
	title: 'Today',
	/** Before any passage has been added. */
	empty: 'Nothing to learn yet. Add a passage to your library to begin.',
	add: 'Add a passage',
	streak: {
		one: '{count}-day streak',
		other: '{count}-day streak',
	},
	freezes: {
		one: '{count} freeze held',
		other: '{count} freezes held',
	},
	/** A day missed with no freeze: the way to keep the streak, never a scolding. */
	repair: {
		one: 'Your streak can carry on: type {count} word by the end of {day}.',
		other: 'Your streak can carry on: type {count} words by the end of {day}.',
	},
	goal: 'Today’s goal',
	reviews: {
		one: '{done} of {count} review',
		other: '{done} of {count} reviews',
	},
	newWords: {
		one: '{done} of {count} new word',
		other: '{done} of {count} new words',
	},
	goalDone: 'Today’s goal is done.',
	start: 'Start',
	done: 'You are done for today. Each part you have learnt comes back for review when it is due.',
	beyond: 'To learn more today, open a passage in your library and practise it.',
	open: 'Open the library',
	/** A reminder to export a backup, while the library is kept only in this browser. */
	backup: {
		label: 'Backup',
		never: 'Your passages and progress are kept only in this browser. Export a backup, and keep it somewhere safe.',
		since: {
			one: 'Your last backup was {count} day ago, and your library has changed since.',
			other: 'Your last backup was {count} days ago, and your library has changed since.',
		},
		later: 'Not now',
	},
} as const;
