import { useEffect, useRef, useState } from 'react';

import { t } from '../i18n/t.js';

/**
 * How long a delete can be taken back from here. Long enough to notice what has
 * gone and reach for the button.
 */
export const UNDO_WINDOW_MS = 10_000;

/** How soon after a touch a `mouseenter` is the touch's own, and not a mouse. */
const TOUCH_ECHO_MS = 1000;

export interface UndoNoticeProps {
	/** What was done: `“Psalm 23” deleted.` */
	message: string;
	onUndo: () => void;
	onDismiss: () => void;
}

/**
 * What was just deleted, with the way back. Deleting a passage is one click and
 * asks nothing first, so this is the whole of its safety. Ported from
 * skysa-notes' `DeletedNotice`.
 *
 * A status, not an alert, and it takes no focus: the user deleted on purpose and
 * is already doing the next thing. It is in the tab order for whoever wants it,
 * and the clock stops while it holds the pointer or the focus — a button that
 * vanishes as it is reached for is worse than none.
 *
 * The two are kept apart, since either can end while the other goes on: focus
 * tabbing out must not start the clock under a pointer still resting there. And
 * a touch is not a pointer resting anywhere — it sends a `mouseenter` and never
 * the `mouseleave`, which held the notice up for good.
 */
export const UndoNotice = ({ message, onUndo, onDismiss }: UndoNoticeProps) => {
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const touchedAt = useRef(0);
	const held = hovered || focused;
	useEffect(() => {
		if (held) return undefined;
		const timer = setTimeout(onDismiss, UNDO_WINDOW_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [held, onDismiss]);

	return (
		<div
			className="toast"
			role="status"
			onTouchStart={() => {
				touchedAt.current = Date.now();
			}}
			onMouseEnter={() => {
				// The one a touch sends follows it at once; a mouse on the same
				// device, later, is a pointer that does rest here.
				if (Date.now() - touchedAt.current > TOUCH_ECHO_MS) setHovered(true);
			}}
			onMouseLeave={() => {
				setHovered(false);
			}}
			onFocus={() => {
				setFocused(true);
			}}
			onBlur={() => {
				setFocused(false);
			}}
		>
			<span>{message}</span>
			<button type="button" onClick={onUndo}>
				{t('shell.undo.action')}
			</button>
			<button type="button" className="ghost" onClick={onDismiss}>
				{t('common.dismiss')}
			</button>
		</div>
	);
};
