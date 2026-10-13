/** Passages changed in two places at once, and choosing between their versions. */
export const conflicts = {
	title: 'Changed in two places',
	hint: 'These passages were changed on two devices before either change had reached the other. Both versions are kept until you choose.',
	none: 'Nothing to choose between: every passage has one version.',
	original: 'Kept in place',
	/** `when` is when sync made the copy: a time today, or a day and a time. */
	copy: 'Kept as a copy ({when})',
	keepThis: 'Keep this version',
	keepBoth: 'Keep both, as two passages',
	/** The title the copy is given when both are kept. */
	otherTitle: '{title} (other version)',
	orphan: 'The passage this copy was made from is no longer in your library.',
	keepOrphan: 'Keep it',
	deleteOrphan: 'Delete it',
	kept: 'Kept one version of {title}.',
	deleted: 'Deleted the copy of {title}.',
	missing: 'This passage has changed meanwhile. Look again.',
	unreadable: 'This copy’s details cannot be read safely, so its title was not changed.',
	differs: 'Lines that differ are marked.',
} as const;
