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
	backup: {
		title: 'Backup',
		hint: 'Your passages and progress are kept in this browser, on this device. Export a backup now and then, and keep it somewhere safe.',
		export: 'Export a backup',
		exporting: 'Exporting…',
		exported: 'Saved as {name}.',
		tooLarge: 'The library is too large to put in one archive.',
		import: 'Import',
		importing: 'Importing…',
		importHint:
			'Markdown or text files, or a backup’s .zip. A passage you already have keeps its words, and the progress made on both is merged.',
		/** A passage imported beside one it differs from. */
		copyTitle: '{title} (imported)',
		added: {
			one: '{count} passage added.',
			other: '{count} passages added.',
		},
		merged: {
			one: 'Progress merged into {count} passage.',
			other: 'Progress merged into {count} passages.',
		},
		unchanged: {
			one: '{count} passage was already up to date.',
			other: '{count} passages were already up to date.',
		},
		copied: {
			one: '{count} passage differed from yours, and was added beside it as a copy.',
			other: '{count} passages differed from yours, and were added beside them as copies.',
		},
		records: 'Your practice records were brought in.',
		skipped: {
			one: '{count} file was not a passage, and was left out.',
			other: '{count} files were not passages, and were left out.',
		},
		unreadable: 'These could not be read, and were left out: {names}.',
		nothing: 'There was nothing to import.',
		/** Whether the browser has agreed to keep the library (`navigator.storage.persist()`). */
		kept: 'This browser has agreed to keep your library until you clear it yourself.',
		unkept: 'This browser may clear your library if the device runs short of space, or, in Safari, after a week without use. Installing the app helps it stay.',
		keep: 'Ask the browser to keep it',
		refused:
			'The browser has not agreed yet. Installing the app, or using it more often, may change its answer.',
	},
	restDay: {
		label: 'Rest day',
		none: 'None',
		hint: 'A day of the week that neither counts toward your streak nor breaks it.',
	},
} as const;
