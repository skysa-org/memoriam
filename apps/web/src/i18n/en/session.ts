/** A session of practice: the day's, or a passage's, task after task. */
export const session = {
	stop: 'Stop the session',
	/** What the pass on screen is for, and the part it is, if it is one. */
	where: {
		learn: 'Learning · Part {at} of {count}',
		relearn: 'Learning again · Part {at} of {count}',
		review: 'Review · Part {at} of {count}',
		link: 'Joining two parts',
		run: 'Running through',
	},
	left: {
		one: '{count} step left',
		other: '{count} steps left',
	},
	forgot: 'This part comes back after your reviews, to be learnt again.',
	relearnt: 'Learnt again. This part comes up for review when it is due.',
	nextReview: {
		one: 'Next review in {count} day.',
		other: 'Next review in {count} days.',
	},
	/** The end of a session. */
	done: 'That is all for now.',
	reviewed: {
		one: 'You reviewed {count} part.',
		other: 'You reviewed {count} parts.',
	},
	learnt: {
		one: 'You learnt {count} new part.',
		other: 'You learnt {count} new parts.',
	},
	nothing: 'There is nothing to practise right now.',
	back: 'Back to Today',
	/** A passage learnt through: practised whole, section by section. */
	runThrough: 'Run through it',
	perfect: 'Word perfect: you ran through the whole passage without a miss.',
} as const;
