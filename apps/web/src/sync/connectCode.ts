import {
	type ApiClient,
	ApiError,
	connectCodeAskedAt,
	dropConnectCode,
	heldConnectCode,
	heldConnectCodeShown,
	holdAcceptedCode,
} from '@skysa/client';
import type { EntitlementCode } from '@skysa/protocol';

import { t } from '../i18n/t.js';

/**
 * The code an operator's gate asks for before connecting (docs/ARCHITECTURE.md
 * §10, "The gate"). What is held, and for how long, is the kit's client's
 * (`holdAcceptedCode`, kept where every tab reads it); this is when the
 * operator's policy is asked about it, and what is said when it says no.
 */

/**
 * Asks the policy about a code typed into the gate, and holds it — or what the
 * policy gave in its place — for as long as the policy says. Otherwise, what
 * to say under the field: the policy's reason, or this app's words for a
 * refusal without one, a limit reached, or no answer at all.
 */
export const askAbout = async (
	client: Pick<ApiClient, 'checkConnectCode'>,
	code: string
): Promise<string | undefined> => {
	const notChecked = () => t('sync.gate.code.notChecked');
	try {
		const result = await client.checkConnectCode(code);
		if (!result.ok) return notChecked();
		if (!result.value.accepted) return result.value.reason ?? t('sync.gate.code.notAccepted');
		holdAcceptedCode(code, result.value);
		return undefined;
	} catch (error) {
		return error instanceof ApiError && error.status === 429
			? t('sync.gate.code.tooMany')
			: notChecked();
	}
};

/** How long the policy's word on a held value stands before the app asks again as it loads. */
const ASK_AGAIN_MS = 60 * 60_000;

/**
 * What the policy gave to hold in place of a code, asked about again as the
 * app loads where the instance's gate asks for a code: at most once an hour
 * since the policy last answered, and at once after a refused connect. As
 * skysa-notes asks, and for its reasons: a typed code is good for the minutes
 * the policy said and is not asked about again, since each asking spends a
 * guess the instance allows the address. One the policy no longer takes is let
 * go of, so the gate asks for a code before a consent screen rather than after
 * one; not asked, or not answered, it is kept, since the callback still
 * decides. An answer about a value no longer held changes nothing.
 */
export const askAgain = async (
	client: Pick<ApiClient, 'config' | 'checkConnectCode'>,
	{ refused = false, now = Date.now() }: Readonly<{ refused?: boolean; now?: number }> = {}
): Promise<void> => {
	const held = heldConnectCode(now);
	if (held === undefined || heldConnectCodeShown(now)) return;
	if (!refused && now - (connectCodeAskedAt(now) ?? 0) < ASK_AGAIN_MS) return;
	try {
		const config = await client.config();
		if (config.connectGate?.connectCode === undefined) return;
		const result = await client.checkConnectCode(held);
		if (!result.ok || heldConnectCode() !== held) return;
		if (result.value.accepted) holdAcceptedCode(held, result.value);
		else dropConnectCode();
	} catch {
		// A limit reached or no answer at all: kept, as it was.
	}
};

/**
 * Whether a refused connect is the policy turning down the code typed into its
 * gate: a plain no — `not_allowed`, or no code at all — to a connect made while
 * this device held a code the person typed. That is what they can put right, so
 * it is said to be about the code, and let go of so the field is empty for the
 * next. A `lapsed` or a `limit_reached` is about the account or the server, and
 * a value the policy gave to hold is asked about again instead (`askAgain`).
 */
export const codeWasRefused = (code: EntitlementCode | undefined): boolean =>
	(code === undefined || code === 'not_allowed') &&
	heldConnectCode() !== undefined &&
	heldConnectCodeShown();
