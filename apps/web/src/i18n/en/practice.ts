/** Practising a passage: learning its chunks up the fade ladder. */
export const practice = {
	stop: 'Stop practising',
	back: 'Back to the passage',
	part: 'Part {at} of {count}',
	level: 'Level {level} of {top}',
	chunk: 'The words to type',
	capture: 'Type the first letter of each word',
	how: 'Type the first letter of each word. Words are hidden as you learn them.',
	start: 'Start',
	hint: 'Hint',
	continue: 'Continue',
	recalled: {
		one: 'You recalled {recalled} of {count} word.',
		other: 'You recalled {recalled} of {count} words.',
	},
	harder: 'Next time, more words are hidden.',
	again: 'Next time, the same share of words is hidden, and the ones you missed are shown once.',
	easier: 'Next time, more words are shown.',
	learnt: 'Learnt. This part comes up for review tomorrow.',
	allLearnt: 'Every part of this passage is learnt. Each comes up for review when it is due.',
	nothing: 'This passage has no words to practise.',
	unsaved: {
		missing: 'That pass was not saved, because the passage has been deleted.',
		changed: 'That pass was not saved, because the passage’s words were changed meanwhile.',
		unreadable:
			'That pass was not saved, because the top of this passage’s file has a formatting problem. Fix it in a text editor.',
		refused:
			'That pass was not saved, because the top of this passage’s file is written in a way the app does not change. Fix it in a text editor.',
	},
	noActivity:
		'Today’s practice was not added to your activity record, because its file has a formatting problem.',
} as const;
