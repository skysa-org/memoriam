import { describe, expect, it } from 'vitest';

import { deriveTitle, UNTITLED_TITLE } from '../../src/markdown/title.js';

describe('deriveTitle', () => {
	it('prefers the frontmatter title', () => {
		expect(deriveTitle({ frontmatterTitle: 'Psalm 23', filename: 'psalm.md' })).toBe(
			'Psalm 23'
		);
	});

	it('falls back to the filename', () => {
		expect(deriveTitle({ filename: 'the-raven.md' })).toBe('the raven');
	});

	it('ignores an empty frontmatter title', () => {
		expect(deriveTitle({ frontmatterTitle: '   ', filename: 'ozymandias.md' })).toBe(
			'ozymandias'
		);
	});

	it('has a last resort', () => {
		expect(deriveTitle({})).toBe(UNTITLED_TITLE);
		expect(deriveTitle({ filename: '---.md' })).toBe(UNTITLED_TITLE);
	});
});
