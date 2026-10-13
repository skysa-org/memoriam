/**
 * The frame around everything: what it says when the app itself is in trouble,
 * the navigation between its screens, and the command palette.
 */
export const shell = {
	error: {
		title: 'Something went wrong',
		text: 'The app hit an error it could not recover from by itself. The passages and progress saved on this device have not been touched.',
		details: 'What the error said',
	},
	update: {
		available: 'A new version is available.',
	},
	/** The notice a delete leaves: the only way back from it, so it waits while held. */
	undo: {
		action: 'Undo',
		failed: 'That could not be undone. Reload and look again: nothing else was changed.',
	},
	staleTab: {
		title: 'This tab is out of date',
		text: 'A newer version of the app is open in another tab, and this one can no longer save. Reload to carry on here.',
		copyFirst: 'Copy my text first',
		cannotSave: 'This tab is out of date and cannot save. Copy what you need, then reload.',
		waiting:
			'Waiting for an older tab of this app to finish. If this does not go away, close the other tabs.',
	},
	/** The bar of screens: across the bottom of a phone, down the side of a wider window. */
	nav: {
		label: 'Screens',
		today: 'Today',
		library: 'Library',
		stats: 'Progress',
		settings: 'Settings',
	},
	palette: {
		search: 'Search commands',
		placeholder: 'Type a command',
		list: 'Commands',
		noMatch: 'Nothing matches “{query}”.',
	},
	/**
	 * Keys as a shortcut is printed in the palette, joined by `+`: `Ctrl+Shift+F`.
	 * On an Apple keyboard the modifiers are its symbols (⌘ ⌥ ⇧) instead, and the
	 * arrows and Enter are symbols everywhere; those are not words.
	 */
	keys: {
		ctrl: 'Ctrl',
		alt: 'Alt',
		shift: 'Shift',
		/** The Escape key. */
		escape: 'Esc',
		/** The space bar. */
		space: 'Space',
	},
	/** What the palette lists that the screen as a whole can do. */
	commands: {
		/** The palette's groups, shown beside each command and searched with it. */
		group: {
			app: 'App',
			passage: 'Passage',
			practice: 'Practice',
		},
		palette: 'Show all commands',
	},
} as const;
