/**
 * The work the screens are holding, which the store cannot see.
 *
 * The passage editor keeps what was typed until it is saved, and the practice
 * screen keeps a pass until it is finished. None of that is in a row. So
 * anything about to close the database — a tab giving way to a newer build
 * (`store/staleTab.ts`) — has them write first.
 *
 * A registry rather than a call into the screens, because `store/` knows
 * nothing of React and a screen comes and goes: each registers its own flush
 * while it is mounted.
 */

/** Write what is held, now. It should resolve whether or not the write went through. */
export type HeldEditsFlush = () => Promise<unknown>;

const unfinished = new Set<HeldEditsFlush>();

/** Register work to be finished first. Answers how to withdraw it. */
export const beforeClosing = (finish: HeldEditsFlush): (() => void) => {
	unfinished.add(finish);
	return () => {
		unfinished.delete(finish);
	};
};

/**
 * Start every registered flush, there and then, and answer one promise for
 * each. None of them rejects. Empty when nothing is held, so a caller with
 * nothing to wait for can tell without waiting.
 */
export const flushEditors = (): Promise<void>[] =>
	[...unfinished].map((finish) =>
		// Inside the executor, so a `finish` that throws is one that settled.
		new Promise<unknown>((resolve) => {
			resolve(finish());
		}).then(
			() => undefined,
			() => undefined
		)
	);
