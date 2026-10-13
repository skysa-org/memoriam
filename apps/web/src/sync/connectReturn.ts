/**
 * The way back from connecting a storage account (docs/ARCHITECTURE.md §10,
 * "Connecting"). The server's callback sends the browser to the path the app
 * started from with the outcome in its query — `/?connect=ok` — and nothing in
 * the hash, which it never sees (`safeReturnTo` in `apps/api`). Where the app
 * is lives in the hash, so the outcome is read out of the real query before the
 * router reads the address, the query is put back as it was without it, and the
 * app opens at Settings, where connecting began and where the outcome is shown.
 *
 * Read once and taken out, so a reload, or the back button, does not say it
 * again. It is held here until Settings has shown it.
 */

/** Exactly what the callback can redirect with: `Outcome` in `apps/api/src/routes/connect.ts`. */
export const CONNECT_OUTCOMES = ['ok', 'denied', 'failed', 'partial', 'expired'] as const;

export type ConnectOutcome = (typeof CONNECT_OUTCOMES)[number];

const PARAM = 'connect';

/** Where the app opens once it has come back. */
export const SETTINGS_HASH = '#/settings';

/**
 * The outcome an address carries, and the address without it, at Settings.
 * Nothing for an address that carries none. One that carries something else
 * — a hand-typed `?connect=yes` — is taken out all the same, and says nothing.
 */
export const readConnectReturn = (
	href: string
): Readonly<{ outcome: ConnectOutcome | undefined; href: string }> | undefined => {
	const url = new URL(href);
	if (!url.searchParams.has(PARAM)) return undefined;
	const value = url.searchParams.get(PARAM);
	const rest = new URLSearchParams(
		[...url.searchParams].filter(([key]) => key !== PARAM)
	).toString();
	return {
		outcome: CONNECT_OUTCOMES.find((outcome) => outcome === value),
		href: `${url.origin}${url.pathname}${rest === '' ? '' : `?${rest}`}${SETTINGS_HASH}`,
	};
};

export interface ConnectReturn {
	/**
	 * Read the outcome out of the address and take it out, in place: no entry is
	 * added to the history. Before the router is made.
	 */
	readonly take: (
		location: Pick<Location, 'href'>,
		history: Pick<History, 'replaceState'>
	) => void;
	/** The outcome waiting to be shown, if any. */
	readonly peek: () => ConnectOutcome | undefined;
	/** It has been shown. */
	readonly forget: () => void;
}

export const createConnectReturn = (): ConnectReturn => {
	const held = new Map<'outcome', ConnectOutcome>();
	return {
		take: (location, history) => {
			const read = readConnectReturn(location.href);
			if (read === undefined) return;
			history.replaceState(null, '', read.href);
			if (read.outcome !== undefined) held.set('outcome', read.outcome);
		},
		peek: () => held.get('outcome'),
		forget: () => {
			held.delete('outcome');
		},
	};
};

/** The page's own. */
export const connectReturn = createConnectReturn();
