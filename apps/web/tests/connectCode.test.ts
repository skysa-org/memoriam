import {
	type ApiClient,
	connectCodeAskedAt,
	dropConnectCode,
	heldConnectCode,
	heldConnectCodeShown,
	holdAcceptedCode,
	holdConnectCode,
	type InstanceConfig,
} from '@skysa/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { askAgain, codeWasRefused } from '../src/sync/connectCode.js';

/**
 * The code an operator's gate asks for: what the app asks the policy about it
 * as it loads, and when a refused connect is said to be about it. Asking about
 * a typed code is the gate's, in syncScreens.test.tsx.
 */

const HOUR = 60 * 60_000;
const YEAR_S = 365 * 24 * 60 * 60;

const GATED: InstanceConfig = {
	providers: ['dropbox'],
	connectGate: {
		message: 'Sync is for members of the reading group.',
		action: { label: 'Join the group', url: 'https://operator.example/join' },
		connectCode: { label: 'Invite code' },
	},
};

const server = (config: InstanceConfig = GATED) => {
	const asked = {
		config: vi.fn<ApiClient['config']>(() => Promise.resolve(config)),
		checkConnectCode: vi.fn<ApiClient['checkConnectCode']>(() =>
			Promise.resolve({ ok: true, value: { accepted: true, expiresIn: YEAR_S } })
		),
	};
	return asked;
};

/** A pass the policy gave this device for a typed code, `ago` ms back. */
const passFrom = (ago: number) => {
	const at = Date.now() - ago;
	holdAcceptedCode('INVITE-7', { expiresIn: YEAR_S, hold: 'PASS-1' }, at);
	return at;
};

afterEach(() => {
	dropConnectCode();
});

describe('asking again as the app loads', () => {
	it('asks nothing while nothing is held, or what is held was typed', async () => {
		const client = server();
		await askAgain(client);
		holdConnectCode('INVITE-7', 600);
		await askAgain(client, { refused: true });

		expect(client.config).not.toHaveBeenCalled();
		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(heldConnectCode()).toBe('INVITE-7');
	});

	it('asks about a pass once its hour is up, and at once after a refused connect', async () => {
		const client = server();
		const at = passFrom(30 * 60_000);
		await askAgain(client);
		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(connectCodeAskedAt()).toBe(at);

		await askAgain(client, { refused: true });
		expect(client.checkConnectCode).toHaveBeenCalledWith('PASS-1');
		expect(connectCodeAskedAt()).toBeGreaterThan(at);

		dropConnectCode();
		passFrom(HOUR + 1);
		await askAgain(client);
		expect(client.checkConnectCode).toHaveBeenCalledTimes(2);
	});

	it('holds what the policy gives in its place, still out of sight', async () => {
		const client = server();
		client.checkConnectCode.mockResolvedValue({
			ok: true,
			value: { accepted: true, expiresIn: YEAR_S, hold: 'PASS-2' },
		});
		passFrom(2 * HOUR);
		await askAgain(client);

		expect(heldConnectCode()).toBe('PASS-2');
		expect(heldConnectCodeShown()).toBe(false);
	});

	it('lets go of a pass the policy no longer takes', async () => {
		const client = server();
		client.checkConnectCode.mockResolvedValue({ ok: true, value: { accepted: false } });
		passFrom(2 * HOUR);
		await askAgain(client);

		expect(heldConnectCode()).toBeUndefined();
	});

	it('keeps a pass it could not ask about, or got no answer about', async () => {
		const client = server();
		passFrom(2 * HOUR);
		client.checkConnectCode.mockResolvedValueOnce({ ok: false, refusal: 'forbidden_origin' });
		await askAgain(client);
		client.checkConnectCode.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await askAgain(client);
		client.config.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await askAgain(client);

		expect(client.checkConnectCode).toHaveBeenCalledTimes(2);
		expect(heldConnectCode()).toBe('PASS-1');
	});

	it('asks nothing where the gate no longer takes a code', async () => {
		const client = server({ providers: ['dropbox'] });
		passFrom(2 * HOUR);
		await askAgain(client);

		expect(client.config).toHaveBeenCalledOnce();
		expect(client.checkConnectCode).not.toHaveBeenCalled();
		expect(heldConnectCode()).toBe('PASS-1');
	});

	it('changes nothing with an answer about a value no longer held', async () => {
		const client = server();
		client.checkConnectCode.mockImplementation(() => {
			// A new code typed while the policy was being asked about the pass.
			holdConnectCode('INVITE-8', 600);
			return Promise.resolve({ ok: true, value: { accepted: false } });
		});
		passFrom(2 * HOUR);
		await askAgain(client);

		expect(heldConnectCode()).toBe('INVITE-8');
	});
});

describe('a refused connect', () => {
	it('is about the code typed into the gate where the policy said a plain no', () => {
		holdConnectCode('INVITE-7', 600);

		expect(codeWasRefused(undefined)).toBe(true);
		expect(codeWasRefused('not_allowed')).toBe(true);
		expect(codeWasRefused('lapsed')).toBe(false);
		expect(codeWasRefused('limit_reached')).toBe(false);
	});

	it('is not about a pass the policy gave, or about nothing held', () => {
		expect(codeWasRefused(undefined)).toBe(false);
		passFrom(0);
		expect(codeWasRefused('not_allowed')).toBe(false);
	});
});
