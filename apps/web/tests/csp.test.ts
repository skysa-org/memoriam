import '../src/jitless.js';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * The Content-Security-Policy in `public/_headers` (docs/ARCHITECTURE.md §9).
 *
 * The browser enforces it silently: a loosened `script-src` shows up as
 * nothing at all. These are the rules it must keep.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string): string => readFileSync(join(root, file), 'utf8');

/** The headers `_headers` sets for one path pattern, by lower-cased name. */
const headersFor = (text: string, pattern: string): ReadonlyMap<string, string> => {
	const lines = text.split('\n').filter((line) => line.trim() !== '' && !line.startsWith('#'));
	const start = lines.indexOf(pattern);
	expect(start, `no ${pattern} rule`).toBeGreaterThanOrEqual(0);
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => !/^\s/.test(line));
	return new Map(
		rest.slice(0, end === -1 ? rest.length : end).map((line) => {
			const colon = line.indexOf(':');
			return [line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()];
		})
	);
};

const policy = (): ReadonlyMap<string, readonly string[]> => {
	const value = headersFor(read('public/_headers'), '/*').get('content-security-policy');
	expect(value, 'no Content-Security-Policy for /*').toBeDefined();
	return new Map(
		(value ?? '')
			.split(';')
			.map((directive) => directive.trim().split(/\s+/))
			.filter(([name]) => name !== undefined && name !== '')
			.map(([name = '', ...sources]) => [name, sources])
	);
};

describe('Content-Security-Policy', () => {
	it('is set once for every path, as one header', () => {
		const text = read('public/_headers');
		expect(text.match(/^\s*Content-Security-Policy:/gim)).toHaveLength(1);
		// Cloudflare ignores a line of `_headers` over 2,000 characters.
		expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThanOrEqual(2000);
	});

	it('runs only this origin’s scripts', () => {
		const directives = policy();
		expect(directives.get('default-src')).toEqual(["'self'"]);
		// A hard requirement, not a good default: once sync arrives this shell
		// holds a long-lived credential in IndexedDB (docs/ARCHITECTURE.md §9),
		// and script this policy lets run could read it and post it anywhere.
		// Nothing may be added to this list.
		expect(directives.get('script-src')).toEqual(["'self'"]);
		expect(directives.get('worker-src')).toEqual(["'self'"]);
		expect(directives.get('object-src')).toEqual(["'none'"]);
		expect(directives.get('base-uri')).toEqual(["'self'"]);
	});

	it('refuses to be reached over plain http again', () => {
		const value = headersFor(read('public/_headers'), '/*').get('strict-transport-security');
		const directives = new Map(
			(value ?? '').split(';').map((part) => {
				const [name = '', argument] = part.trim().split('=');
				return [name.toLowerCase(), argument];
			})
		);

		// Two years is the usual floor for a policy meant to be relied on.
		expect(Number(directives.get('max-age'))).toBeGreaterThanOrEqual(63072000);
		// Both are commitments on behalf of whoever hosts this — from an apex
		// domain the first takes in every subdomain they own — and they are
		// theirs to make, not this repo's.
		expect(directives.has('includesubdomains')).toBe(false);
		expect(directives.has('preload')).toBe(false);
	});

	it('is not framed and posts forms only here', () => {
		const directives = policy();
		expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
		expect(directives.get('form-action')).toEqual(["'self'"]);
	});

	it('connects to this origin and the storage providers sync talks to, and nowhere else', () => {
		expect(policy().get('connect-src')).toEqual([
			"'self'",
			'https://*.dropboxapi.com',
			'https://graph.microsoft.com',
			'https://*.files.1drv.com',
			'https://my.microsoftpersonalcontent.com',
			'https://*.sharepoint.com',
			'https://www.googleapis.com',
		]);
	});

	it('has no inline script in the page for it to block', () => {
		const html = read('index.html');
		expect(html.match(/<script\b[^>]*>/g)?.every((tag) => /\bsrc=/.test(tag))).toBe(true);
	});
});

describe('zod under the policy', () => {
	it('is told not to probe for `new Function`, before anything else loads', () => {
		const imports = read('src/main.tsx').match(/^import .*$/gm) ?? [];
		expect(imports[0]).toBe("import './jitless.js';");
		expect(z.config().jitless).toBe(true);
	});
});
