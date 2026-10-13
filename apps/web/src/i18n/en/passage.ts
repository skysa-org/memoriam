/** One passage: reading it, and adding or editing one. */
export const passage = {
	back: 'Back to the library',
	edit: 'Edit',
	delete: 'Delete',
	deleted: '“{title}” deleted.',
	/** A link to a passage that is no longer there, or an address typed wrong. */
	missing: {
		title: 'Not in your library',
		text: 'This passage may have been deleted, here or in another tab.',
		action: 'Go to the library',
	},
	editor: {
		newTitle: 'New passage',
		editTitle: 'Edit passage',
		title: 'Title',
		titleHint: 'Leave it empty to use the first words.',
		reference: 'Source',
		referenceHint: 'Where the words are from, such as “Psalm 23 (ESV)” or a poet’s name.',
		collection: 'Collection',
		noCollection: 'None',
		text: 'Text',
		textHint:
			'Keep the line breaks it has. Leave a blank line between stanzas or paragraphs, and start a line with # to name a section.',
		save: 'Save',
		add: 'Add to library',
		unreadable:
			'The details of this passage cannot be changed here, because the top of its file has a formatting problem. Fix it in a text editor, or change only the words.',
		discard: {
			title: 'Discard your changes?',
			text: 'What you typed here has not been saved.',
			confirm: 'Discard',
		},
	},
} as const;
