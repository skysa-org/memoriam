import { ENTITLEMENT_CODES, type EntitlementCode } from '@skysa/protocol';
import { cell } from '@skysa/storage';

/**
 * The way back from connecting a storage account (docs/ARCHITECTURE.md §10,
 * "Connecting"). The server's callback sends the browser to the path the app
 * started from with the outcome in its query — `/?connect=ok` — and nothing in
 * the hash, which it never sees (`safeReturnTo` in the kit's server). Where the app
 * is lives in the hash, so the outcome is read out of the real query before the
 * router reads the address, the query is put back as it was without it, and the
 * app opens at Settings, where connecting began and where the outcome is shown.
 *
 * Read once and taken out, so a reload, or the back button, does not say it
 * again. It is held here until Settings has shown it.
 */

/**
 * What the callback can redirect with: `Outcome` in the kit's server
 * (`@skysa/server`). `refused` is an operator's entitlement policy saying no,
 * with the kind of no it gave in `&code=` (`EntitlementCode`); a URL carries
 * no free text, so the policy's own reason is not among it.
 */
const CONNECT_OUTCOMES = ['ok', 'denied', 'failed', 'partial', 'refused', 'expired'] as const;

export type ConnectOutcome = (typeof CONNECT_OUTCOMES)[number];

/** How a connect went, and for a refusal, the kind of no where the policy gave one. */
export type Returned = Readonly<{ outcome: ConnectOutcome; code?: EntitlementCode }>;

const PARAM = 'connect';
const CODE = 'code';

/** Where the app opens once it has come back. */
const SETTINGS_HASH = '#/settings';

/**
 * The outcome an address carries, and the address without it, at Settings.
 * Nothing for an address that carries none. One that carries something else
 * — a hand-typed `?connect=yes` — is taken out all the same, and says nothing;
 * so is a `code` that is not one of the policy's kinds, which leaves the
 * refusal said without one.
 */
export const readConnectReturn = (
	href: string
): Readonly<{ returned: Returned | undefined; href: string }> | undefined => {
	const url = new URL(href);
	if (!url.searchParams.has(PARAM)) return undefined;
	const value = url.searchParams.get(PARAM);
	const code = ENTITLEMENT_CODES.find((kind) => kind === url.searchParams.get(CODE));
	const outcome = CONNECT_OUTCOMES.find((each) => each === value);
	const rest = new URLSearchParams(
		[...url.searchParams].filter(([key]) => key !== PARAM && key !== CODE)
	).toString();
	return {
		returned:
			outcome === undefined
				? undefined
				: { outcome, ...(outcome === 'refused' && code !== undefined ? { code } : {}) },
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
	readonly peek: () => Returned | undefined;
	/** It has been shown. */
	readonly forget: () => void;
}

export const createConnectReturn = (): ConnectReturn => {
	const held = cell<Returned | undefined>(undefined);
	return {
		take: (location, history) => {
			const read = readConnectReturn(location.href);
			if (read === undefined) return;
			history.replaceState(null, '', read.href);
			if (read.returned !== undefined) held.current = read.returned;
		},
		peek: () => held.current,
		forget: () => {
			held.current = undefined;
		},
	};
};

/** The page's own. */
export const connectReturn = createConnectReturn();
