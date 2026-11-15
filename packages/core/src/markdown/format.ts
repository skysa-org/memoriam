import type { DocumentFormat } from '@skysa/storage';

import { PASSAGE_EXTENSION } from '../config.js';
import { conflictContent } from '../sync/conflicts.js';
import { parsePassageFile } from './passage.js';

/**
 * This app's documents, as the sync engine and the adapters are handed them
 * (skysa-notes' record 0018): markdown files, each claiming its id in
 * frontmatter (docs/ARCHITECTURE.md §3), and a conflict copy claiming a fresh
 * one. A year's activity is one too, under the app's own folder. Any text is
 * a passage, so it says nothing of `isDocumentText`: a file that will not
 * decode as UTF-8 is unreadable already.
 */
export const PASSAGE_FORMAT: DocumentFormat = {
	extension: PASSAGE_EXTENSION,
	mediaType: 'text/markdown',
	claimedId: (content) => parsePassageFile(content).id,
	conflictContent,
};
