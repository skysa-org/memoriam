import { describe, expect, it, vi } from 'vitest';

import { createConnectReturn, readConnectReturn } from '../src/sync/connectReturn.js';

/**
 * The way back from the provider's consent screen: the outcome is in the real
 * query, where the router never looks, so it is read out before the router is
 * made and the app opens at Settings.
 */

describe('reading the way back', () => {
	it('takes the outcome out of the query and opens Settings', () => {
		expect(readConnectReturn('https://app.example/?connect=ok')).toEqual({
			returned: { outcome: 'ok' },
			href: 'https://app.example/#/settings',
		});
	});

	it('keeps the rest of the query, and the path', () => {
		expect(readConnectReturn('https://app.example/memoriam/?a=1&connect=denied&b=2')).toEqual({
			returned: { outcome: 'denied' },
			href: 'https://app.example/memoriam/?a=1&b=2#/settings',
		});
	});

	it('takes a refusal with the kind of no the policy gave, and the kind out of the query', () => {
		expect(
			readConnectReturn('https://app.example/?connect=refused&code=limit_reached&a=1')
		).toEqual({
			returned: { outcome: 'refused', code: 'limit_reached' },
			href: 'https://app.example/?a=1#/settings',
		});
	});

	it('takes a refusal with a kind the policy has none of as one without a kind', () => {
		expect(readConnectReturn('https://app.example/?connect=refused&code=banned')).toEqual({
			returned: { outcome: 'refused' },
			href: 'https://app.example/#/settings',
		});
	});

	it('takes out an outcome the server never sends, and says nothing of it', () => {
		expect(readConnectReturn('https://app.example/?connect=signin#/library')).toEqual({
			returned: undefined,
			href: 'https://app.example/#/settings',
		});
	});

	it('leaves an address with no outcome alone', () => {
		expect(readConnectReturn('https://app.example/?a=1#/library')).toBeUndefined();
	});
});

describe('holding the outcome until it is shown', () => {
	it('replaces the address in place, and holds the outcome until forgotten', () => {
		const held = createConnectReturn();
		const replaceState = vi.fn();

		held.take({ href: 'https://app.example/?connect=partial' }, { replaceState });

		expect(replaceState).toHaveBeenCalledWith(null, '', 'https://app.example/#/settings');
		expect(held.peek()).toEqual({ outcome: 'partial' });
		expect(held.peek()).toEqual({ outcome: 'partial' });
		held.forget();
		expect(held.peek()).toBeUndefined();
	});

	it('touches nothing when there is nothing to take', () => {
		const held = createConnectReturn();
		const replaceState = vi.fn();

		held.take({ href: 'https://app.example/#/today' }, { replaceState });

		expect(replaceState).not.toHaveBeenCalled();
		expect(held.peek()).toBeUndefined();
	});
});
