/** How practice is scheduled and typed, as set on this device. */
export const settings = {
	title: 'Settings',
	device: 'These settings are kept on this device.',
	retention: {
		label: 'Recall to aim for',
		hint: 'How likely you should be to remember a part when it comes up for review. Aiming higher brings more reviews.',
		choice: '{percent}%',
		recommended: '{percent}% (recommended)',
	},
	newWords: {
		label: 'New words a day',
		hint: 'How many words of new parts a day’s practice begins, at most. Practising a passage from its own page can always learn more.',
		choice: {
			one: '{count} word',
			other: '{count} words',
		},
	},
	maxInterval: {
		label: 'Longest wait between reviews',
		hint: 'However well you know a part, it comes up for review at least this often.',
		choice: {
			one: '{count} day',
			other: '{count} days',
		},
	},
	slips: {
		label: 'Forgive slips of the finger',
		hint: 'On a touch keyboard, a key next to the right one is not counted as a miss.',
	},
	restDay: {
		label: 'Rest day',
		none: 'None',
		hint: 'A day of the week that neither counts toward your streak nor breaks it.',
	},
} as const;
