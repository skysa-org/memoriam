import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * How much room there is, asked of the browser rather than worked out.
 *
 * The window decides one thing: whether it is compact, which changes what is
 * *rendered* — the library's collections as a dropdown rather than a column.
 * That lives here and not in the stylesheet, because a width decided twice is
 * two answers that can disagree by a pixel. What only changes how something
 * looks is a media or container query in the stylesheet.
 *
 * Every query is phrased as the *smaller* case, so that a browser with no
 * `matchMedia` — jsdom, in every test — answers "no" and gets the wide layout.
 */

/** Narrow enough that the library's collections and passages do not fit side by side. */
export const COMPACT = '(max-width: 48rem)';

/** A finger rather than a mouse: where typing raises an on-screen keyboard. */
export const COARSE_POINTER = '(pointer: coarse)';

const noSubscription = () => () => undefined;

/**
 * Whether `query` matches now, for code outside React that asks each time it
 * needs to know rather than following the answer.
 */
export const mediaMatches = (query: string): boolean =>
	typeof window !== 'undefined' &&
	typeof window.matchMedia === 'function' &&
	window.matchMedia(query).matches;

/**
 * Whether `query` matches, and a re-render whenever that changes.
 *
 * Read synchronously on the first render, so the first frame is already the
 * right layout rather than the wide one corrected a frame later.
 */
export const useMediaQuery = (query: string): boolean => {
	// One list per query, not per render: `matchMedia` hands back a new object
	// every time it is called, and a new object would be a new subscription.
	const media = useMemo(
		() =>
			typeof window === 'undefined' || typeof window.matchMedia !== 'function'
				? undefined
				: window.matchMedia(query),
		[query]
	);

	const subscribe = useCallback(
		(changed: () => void) => {
			if (media === undefined) return noSubscription();
			media.addEventListener('change', changed);
			return () => {
				media.removeEventListener('change', changed);
			};
		},
		[media]
	);

	const matches = useCallback(() => media?.matches ?? false, [media]);

	return useSyncExternalStore(subscribe, matches);
};
