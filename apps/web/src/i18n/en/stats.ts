/** The Progress screen: the streak, practice by the day, what is learnt, and badges. */
export const stats = {
	title: 'Progress',
	streak: {
		title: 'Streak',
		days: {
			one: '{count} day in a row',
			other: '{count} days in a row',
		},
		none: 'Practise on any day to start a streak.',
		best: {
			one: 'Your longest: {count} day.',
			other: 'Your longest: {count} days.',
		},
		freezes: {
			one: '{count} freeze held.',
			other: '{count} freezes held.',
		},
		freezesHint:
			'A freeze keeps your streak going on a day you miss. You earn one for every 7 days in a row, and can hold 2.',
		rest: 'Your rest day neither counts nor breaks it.',
	},
	heat: {
		title: 'Practice',
		/** The whole map, for a screen reader. */
		label: {
			one: 'Practice over the last {weeks} weeks: {count} day practised.',
			other: 'Practice over the last {weeks} weeks: {count} days practised.',
		},
		day: {
			one: '{date}: {count} word typed',
			other: '{date}: {count} words typed',
		},
		freeze: '{date}: kept by a freeze',
		repair: '{date}: mended by a long day after',
		rest: '{date}: rest day',
		less: 'Less',
		more: 'More',
	},
	totals: {
		title: 'So far',
		words: {
			one: '{count} word learnt',
			other: '{count} words learnt',
		},
		passages: {
			one: '{count} passage learnt',
			other: '{count} passages learnt',
		},
		minutes: {
			one: '{count} minute of practice',
			other: '{count} minutes of practice',
		},
		passes: {
			one: '{count} pass typed',
			other: '{count} passes typed',
		},
	},
	passages: {
		title: 'Passages',
		mastery: '{percent}% learnt',
		health: 'Recall now: about {percent}%',
		none: 'Add a passage to see how well you know it.',
	},
	badges: {
		title: 'Badges',
		earned: 'Earned on {date}',
		notYet: 'Not yet earned',
		/** The notice when one is earned. */
		new: 'New badge: {name}',
		see: 'See your badges',
		close: 'Close',
	},
} as const;
