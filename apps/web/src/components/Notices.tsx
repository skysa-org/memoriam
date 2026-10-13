import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';

import { t } from '../i18n/t.js';
import { UndoNotice } from './UndoNotice.js';

/**
 * The notices over the app: what was just deleted, with its undo, and what
 * went wrong. Held above the screens rather than in one, because the screen a
 * delete was made on is often the one it takes away — a passage deleted from
 * its own page is read about from the Library.
 */

/** A change that can be taken back from a notice. */
export interface Undoable {
	/** What was done, as the notice says it. */
	readonly message: string;
	readonly undo: () => Promise<unknown>;
}

export interface Notices {
	/** Offer the way back from what was just done, in place of any offered before. */
	readonly offerUndo: (undoable: Undoable) => void;
	/** Say what went wrong, until it is dismissed. */
	readonly tell: (problem: string) => void;
}

const NoticesContext = createContext<Notices | undefined>(undefined);

export const useNotices = (): Notices => {
	const notices = useContext(NoticesContext);
	if (notices === undefined) throw new Error('useNotices needs a NoticesProvider above it');
	return notices;
};

interface Offered extends Undoable {
	/** A second delete is a new notice with a new clock, not the first one's running on. */
	readonly key: number;
}

export const NoticesProvider = ({ children }: { children: ReactNode }) => {
	const [offered, setOffered] = useState<Offered | null>(null);
	const [problem, setProblem] = useState<string | null>(null);

	const notices = useMemo<Notices>(
		() => ({
			offerUndo: (undoable) => {
				setOffered({ ...undoable, key: Date.now() });
			},
			tell: setProblem,
		}),
		[]
	);

	const dismissOffered = useCallback(() => {
		setOffered(null);
	}, []);
	const dismissProblem = useCallback(() => {
		setProblem(null);
	}, []);

	return (
		<NoticesContext.Provider value={notices}>
			{children}
			<div className="toast-stack">
				{offered !== null && (
					<UndoNotice
						key={offered.key}
						message={offered.message}
						onUndo={() => {
							setOffered(null);
							offered.undo().catch(() => {
								setProblem(t('shell.undo.failed'));
							});
						}}
						onDismiss={dismissOffered}
					/>
				)}
				{problem !== null && (
					<div className="toast toast-error" role="alert">
						<span>{problem}</span>
						<button type="button" className="ghost" onClick={dismissProblem}>
							{t('common.dismiss')}
						</button>
					</div>
				)}
			</div>
		</NoticesContext.Provider>
	);
};
