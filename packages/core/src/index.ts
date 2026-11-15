/**
 * What the apps may use of core, by name. A name is here because something in
 * `apps/` imports it, in its source or its tests (which assert with core's real
 * errors and functions). One nothing outside core needs stays in its module,
 * so the surface is chosen rather than whatever a module happens to export.
 * `tests/exports.test.ts` lists the values and the types, so a change to this
 * list is a change a reviewer sees. The test doubles are the kit's
 * (`@skysa/storage/testing`, `@skysa/sync/testing`).
 */

export { CURRENT_CHUNKER, MARKER_FILE, MEMORIAM_FOLDER, PASSAGE_EXTENSION } from './config.js';

export { syncsHidden } from './appFolder.js';

export { mergeFile } from './sync/merge.js';

export { sanitizeFolderName, uniqueFilename } from './names/slug.js';

export { conflictPath } from './names/passages.js';

export { conflictContent } from './sync/conflicts.js';

export { frontmatterIsEditable, splitFrontmatter } from './markdown/frontmatter/index.js';

export { PASSAGE_FORMAT } from './markdown/format.js';

export { toLf } from './markdown/lineEndings.js';

export {
	type ParsedPassageFile,
	parsePassageFile,
	serializePassageFile,
} from './markdown/passage.js';

export { UNTITLED_TITLE } from './markdown/title.js';

export {
	type ChunkProgress,
	MAX_LEVEL,
	NO_PROGRESS,
	type Progress,
	readProgress,
	writeProgress,
} from './progress/codec.js';

export { type ChunkedPassage, chunkPassage } from './passage/chunk.js';

export { editedProgress, fillGaps } from './passage/remap.js';

export type { PassageLine, PassageWord } from './passage/text.js';

export { fade, type Faded } from './practice/fade.js';

export { grade, type Grade } from './practice/grade.js';

export { hideWords, type PastPass, type Shown } from './practice/hide.js';

export { QWERTY } from './practice/keyboard.js';

export { type PassSummary, summarize } from './practice/pass.js';

export { randoms } from './practice/random.js';

export {
	hesitationThreshold,
	isTyped,
	startTyping,
	type Typing,
	typing,
	type TypingEvent,
	type WordResult,
} from './practice/typing.js';

export { addDays, daysBetween, localDay } from './day.js';

export { isLearnt, learningPass } from './practice/learn.js';

export {
	type ActivityWrite,
	activityIsReadable,
	activityPath,
	addBadges,
	addToDay,
	type DayActivity,
	dayKey,
	dayTotals,
	isActivityPath,
	mergeActivity,
	readActivity,
	recordedBadges,
} from './rewards/activity.js';

export { type Badge, BADGES, earnedBadges, isBadge } from './rewards/badges.js';

export { heatmap } from './rewards/heatmap.js';

export { mergePassage, sameApartFromProgress } from './progress/merge.js';

export { type Measure, measure } from './rewards/mastery.js';

export { type Kept, type Streak, streakOf } from './rewards/streak.js';

export {
	DEFAULT_RETENTION,
	LAPSE_LEVEL,
	MAX_INTERVAL,
	type Retention,
	RETENTIONS,
	reviewed,
} from './schedule/fsrs.js';

export {
	DEFAULT_NEW_WORDS,
	linkSpan,
	planDay,
	type PlanPassage,
	RUN_WORDS,
	runSpan,
	type Span,
	type Step,
} from './schedule/session.js';
