/**
 * What the apps may use of core, by name. A name is here because something in
 * `apps/` imports it, in its source or its tests (which assert with core's real
 * errors and functions). One nothing outside core needs stays in its module,
 * so the surface is chosen rather than whatever a module happens to export.
 * `tests/exports.test.ts` lists the values and the types, so a change to this
 * list is a change a reviewer sees. The test doubles are
 * `@memoriam/core/testing`.
 */

export {
	CURRENT_CHUNKER,
	MARKER_FILE,
	PASSAGE_EXTENSION,
	PROVIDER_KINDS,
	type ProviderKind,
} from './config.js';

export {
	AuthError,
	isAuthError,
	isRateLimitError,
	RateLimitError,
	type RemoteEntry,
	type StorageProvider,
} from './providers/types.js';

export { createDropboxProvider, type FetchLike } from './providers/dropbox.js';

export { createGDriveProvider } from './providers/gdrive.js';

export { createOneDriveProvider } from './providers/onedrive.js';

export { mergeFile } from './sync/merge.js';

export { conflictPath } from './names/conflicts.js';

export { foldName } from './names/fold.js';

export { sanitizeFolderName, uniqueFilename } from './names/slug.js';

export { conflictContent } from './sync/conflicts.js';

export {
	createSyncEngine,
	type SyncEngine,
	type SyncOutcome,
	type SyncProgress,
} from './sync/engine.js';

export type {
	ConflictResolution,
	OpOutcome,
	PullBatch,
	PullChange,
	SyncFile,
	SyncFolder,
	SyncNote,
	SyncOp,
	SyncStore,
	UnreadableFile,
} from './sync/store.js';

export { contentHash } from './hash.js';

export {
	ancestorPaths,
	basename,
	isHidden,
	isWithin,
	joinPath,
	normalizePath,
	parentPath,
	pathSegments,
	rebasePath,
	replaceBasename,
	ROOT,
	SEPARATOR,
} from './paths.js';

export { frontmatterIsEditable, splitFrontmatter } from './markdown/frontmatter/index.js';

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
