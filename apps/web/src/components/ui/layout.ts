import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * What the window is, asked of the browser rather than worked out.
 *
 * A query lives here when its answer changes what is *rendered*: a practice
 * session on a touch screen, or the install banner in a browser tab. A width
 * or a pointer decided in code and again in the stylesheet is two answers that
 * can disagree by a pixel, so what only changes how something looks is a media
 * or container query in the stylesheet.
 *
 * A browser with no `matchMedia` (jsdom, in every test) answers "no" to every
 * query.
 */

/** A finger rather than a mouse: where typing raises an on-screen keyboard. */
export const COARSE_POINTER = '(pointer: coarse)';

const noSubscription = () => () => undefined;

/**
 * Whether `query` matches, and a re-render whenever that changes.
 *
 * Read synchronously on the first render, so the first frame is already the
 * right layout rather than the default one corrected a frame later.
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
