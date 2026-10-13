/** The Library: every passage, in its collection. */
export const library = {
	title: 'Library',
	newPassage: 'New passage',
	newCollection: 'New collection',
	/** Before anything has been added. */
	empty: 'Your library is empty. Add a passage you want to learn by heart: a poem, a speech, a verse, anything.',
	/** The passages in no collection, listed first. */
	unfiled: 'Not in a collection',
	collectionEmpty: 'Nothing in this collection yet.',
	passages: { one: '{count} passage', other: '{count} passages' },
	/** What a collection given no usable name is called. */
	unnamedCollection: 'Untitled',
	/** Each collection's buttons, read out with the collection's name. */
	addTo: 'Add a passage to {name}',
	rename: 'Rename {name}',
	delete: 'Delete {name}',
	create: {
		title: 'New collection',
		text: 'A collection keeps passages together: a book, a poet, a season.',
		label: 'Name',
		confirm: 'Create',
	},
	renaming: {
		title: 'Rename collection',
		text: 'The passages in it stay in it.',
		label: 'New name',
		confirm: 'Rename',
	},
	exists: 'There is already a collection called “{name}”.',
	deleting: {
		title: 'Delete “{name}”?',
		text: {
			one: 'The collection and the passage in it will be deleted, with its progress.',
			other: 'The collection and the {count} passages in it will be deleted, with their progress.',
		},
		confirm: 'Delete',
	},
	/** The notice a delete leaves, with its way back. */
	deleted: '“{name}” deleted.',
} as const;
