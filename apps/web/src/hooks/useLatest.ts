import { useEffect, useRef } from 'react';

/**
 * A ref that holds the last `value` rendered, for a callback or a value read
 * later — in a handler, a timer, an effect that must not re-run on it —
 * without being stale. Written after the render that brought it.
 *
 * Read `.current` where it is used, never once at render: what a render reads
 * is the value before it.
 */
export const useLatest = <T>(value: T): Readonly<{ current: T }> => {
	const latest = useRef(value);
	useEffect(() => {
		latest.current = value;
	}, [value]);
	return latest;
};
