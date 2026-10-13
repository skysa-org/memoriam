/** Each badge: its name, and how it is earned. */
export const badges = {
	'first-learnt': {
		name: 'First passage learnt',
		how: 'Learn every part of a passage.',
	},
	'first-mastered': {
		name: 'First passage mastered',
		how: 'Hold every part of a passage well enough to keep it three weeks between reviews.',
	},
	'words-100': {
		name: '100 words',
		how: 'Learn 100 words across your library.',
	},
	'words-500': {
		name: '500 words',
		how: 'Learn 500 words across your library.',
	},
	'words-1000': {
		name: '1,000 words',
		how: 'Learn 1,000 words across your library.',
	},
	'words-5000': {
		name: '5,000 words',
		how: 'Learn 5,000 words across your library.',
	},
	'streak-7': {
		name: 'A week in a row',
		how: 'Practise 7 days in a row.',
	},
	'streak-30': {
		name: 'A month in a row',
		how: 'Practise 30 days in a row.',
	},
	'streak-100': {
		name: '100 days in a row',
		how: 'Practise 100 days in a row.',
	},
	'streak-365': {
		name: 'A year in a row',
		how: 'Practise 365 days in a row.',
	},
	'held-30': {
		name: 'Held for a month',
		how: 'Keep a whole passage learnt and its reviews up to date for 30 days.',
	},
	'held-90': {
		name: 'Held for a season',
		how: 'Keep a whole passage learnt and its reviews up to date for 90 days.',
	},
	'held-365': {
		name: 'Held for a year',
		how: 'Keep a whole passage learnt and its reviews up to date for a year.',
	},
	'clean-run': {
		name: 'Word perfect',
		how: 'Run through a whole passage without a miss.',
	},
	comeback: {
		name: 'Welcome back',
		how: 'Come back to practice after a week or more away.',
	},
} as const;
