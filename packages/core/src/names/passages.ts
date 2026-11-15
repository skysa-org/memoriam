import { documentNames } from '@skysa/storage';

import { PASSAGE_EXTENSION } from '../config.js';

/**
 * A passage's names: one ends `.md` (`PASSAGE_FORMAT`), folded as the kit's
 * `foldName` folds, so `Psalm-23.MD` from a Windows tool is one, and a copy of
 * one keeps it. For the app's own code; the engine and the providers are
 * handed the format and ask it instead (skysa-notes' record 0018).
 */
export const { isDocumentName: isPassageName, conflictPath } = documentNames(PASSAGE_EXTENSION);
