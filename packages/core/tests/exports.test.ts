import { describe, expect, expectTypeOf, it } from 'vitest';

import type * as Core from '../src/index.js';
import * as core from '../src/index.js';

/**
 * Every value core's main entry offers the apps, in order. Here so a name
 * added to or taken out of `src/index.ts` shows in review as a line in this
 * list: the surface is chosen, not whatever a module exports.
 */
const SURFACE = [
	'BADGES',
	'CURRENT_CHUNKER',
	'DEFAULT_NEW_WORDS',
	'DEFAULT_RETENTION',
	'LAPSE_LEVEL',
	'MARKER_FILE',
	'MAX_INTERVAL',
	'MAX_LEVEL',
	'MEMORIAM_FOLDER',
	'NO_PROGRESS',
	'PASSAGE_EXTENSION',
	'PASSAGE_FORMAT',
	'QWERTY',
	'RETENTIONS',
	'RUN_WORDS',
	'UNTITLED_TITLE',
	'activityIsReadable',
	'activityPath',
	'addBadges',
	'addDays',
	'addToDay',
	'chunkPassage',
	'conflictContent',
	'conflictPath',
	'dayKey',
	'dayTotals',
	'daysBetween',
	'earnedBadges',
	'editedProgress',
	'fade',
	'fillGaps',
	'frontmatterIsEditable',
	'grade',
	'heatmap',
	'hesitationThreshold',
	'hideWords',
	'isActivityPath',
	'isBadge',
	'isLearnt',
	'isTyped',
	'learningPass',
	'linkSpan',
	'localDay',
	'measure',
	'mergeActivity',
	'mergeFile',
	'mergePassage',
	'parsePassageFile',
	'planDay',
	'randoms',
	'readActivity',
	'readProgress',
	'recordedBadges',
	'reviewed',
	'runSpan',
	'sameApartFromProgress',
	'sanitizeFolderName',
	'serializePassageFile',
	'splitFrontmatter',
	'startTyping',
	'streakOf',
	'summarize',
	'syncsHidden',
	'toLf',
	'typing',
	'uniqueFilename',
	'writeProgress',
];

/** Every type the entry offers; see the last test. */
type Types = [
	Core.ActivityWrite,
	Core.Badge,
	Core.ChunkedPassage,
	Core.ChunkProgress,
	Core.DayActivity,
	Core.Faded,
	Core.Grade,
	Core.Kept,
	Core.Measure,
	Core.ParsedPassageFile,
	Core.PassageLine,
	Core.PassageWord,
	Core.PassSummary,
	Core.PastPass,
	Core.PlanPassage,
	Core.Progress,
	Core.Retention,
	Core.Shown,
	Core.Span,
	Core.Step,
	Core.Streak,
	Core.Typing,
	Core.TypingEvent,
	Core.WordResult,
];

describe('core’s main entry', () => {
	it('offers these values and no others', () => {
		expect(Object.keys(core).sort()).toEqual(SURFACE);
	});

	it('offers these types', () => {
		// Types leave nothing at run time to list, so these are named instead:
		// one taken out of the entry fails typecheck here, whether or not an app
		// uses it.
		expectTypeOf<Types>().not.toBeNever();
	});
});
