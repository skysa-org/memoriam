/**
 * The app's icons, drawn here rather than installed.
 *
 * An icon package would be a dependency for a dozen shapes, and the shapes are
 * the conventional ones. All of them are paths on a 24-unit grid, stroked in
 * `currentColor`, so a button's own colour and the dark theme reach them
 * without a second rule.
 */

/** Every name `Icon` will draw, and the path that draws it. */
const PATHS = {
	close: 'M6 6l12 12M18 6 6 18',
	plus: 'M12 5v14M5 12h14',
	check: 'm5 12.5 4.5 4.5L19 7.5',
	chevron: 'm6 9.5 6 6 6-6',
	back: 'm14.5 6-6 6 6 6',
	search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
	trash: 'M4 7h16M10 4h4M6.5 7 7.5 20h9l1-13M10 11v5M14 11v5',
	edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
	play: 'M8 5.5v13l10.5-6.5z',
	// Today: a sun rising over the horizon.
	today: 'M3 18h18M7 18a5 5 0 0 1 10 0M12 6v2M5.6 9.6 7 11M18.4 9.6 17 11',
	// The library: books on a shelf.
	library: 'M5 4v16M9 4v16M13.5 4.5l4.5 15M3 20h18',
	// Progress: a rising bar chart.
	stats: 'M5 20v-6M10 20V9M15 20v-9M20 20V5',
	settings:
		'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
	// A streak: a flame.
	flame: 'M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-1.5-2-1.5-3C7 10 6 12.5 6 15a6 6 0 0 0 6 6z',
	// A hint: a light bulb.
	hint: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
	download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
	upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
	folder: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
	more: 'M5 12h.01M12 12h.01M19 12h.01',
} as const;

export type IconName = keyof typeof PATHS;

export const Icon = ({ name, size = 18 }: { name: IconName; size?: number }) => (
	<svg
		className="icon-glyph"
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth={2}
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
		focusable="false"
	>
		<path d={PATHS[name]} />
	</svg>
);
