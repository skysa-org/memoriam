export {
	APP_DATA_FOLDER,
	APP_FOLDER_NAME,
	APP_NAME,
	CURRENT_CHUNKER,
	HIDDEN_PREFIX,
	MARKER_FILE,
	PASSAGE_EXTENSION,
} from './config.js';

export { contentHash, cyrb53, SHORT_KEY_LENGTH, shortKey } from './hash.js';

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

export {
	frontmatterHasDeclinedId,
	frontmatterIsEditable,
	joinFrontmatter,
	type PassageFrontmatter,
	type PassageTimes,
	type ProgressBlock,
	readFrontmatter,
	readPassageTimes,
	splitFrontmatter,
	type SplitDocument,
	writeFrontmatter,
} from './markdown/frontmatter.js';

export { firstLineEnding, type LineEnding, toLf, withLineEnding } from './markdown/lineEndings.js';

export {
	type ParsedPassageFile,
	parsePassageFile,
	type ParsePassageFileOptions,
	serializePassageFile,
	type SerializePassageFileInput,
} from './markdown/passage.js';

export {
	clusters,
	fitBytes,
	foldName,
	MAX_NAME_BYTES,
	normalizeTag,
	passageFilename,
	sanitizeFolderName,
	slugify,
	uniqueFilename,
	UNTITLED_SLUG,
	utf8Length,
} from './markdown/slug.js';

export { readTime } from './markdown/time.js';

export {
	deriveTitle,
	type DeriveTitleInput,
	titleFromFilename,
	UNTITLED_TITLE,
} from './markdown/title.js';

export {
	type ChunkProgress,
	MAX_LEVEL,
	NO_PROGRESS,
	type Progress,
	progressBlock,
	type ProgressRefusal,
	type ProgressWrite,
	readProgress,
	writeProgress,
} from './progress/codec.js';

export {
	type Chunk,
	type ChunkedPassage,
	chunkKeys,
	chunkPassage,
	keyText,
	knowsChunker,
} from './passage/chunk.js';

export {
	chunksWithWords,
	commonWords,
	type EditedProgress,
	editedProgress,
	fillGaps,
	KEEPS_PROGRESS,
	type NewChunk,
	type OldChunk,
	remapProgress,
} from './passage/remap.js';

export {
	type PassageLine,
	type PassageText,
	type PassageWord,
	readPassage,
	type Section,
} from './passage/text.js';

export { firstKey, foldKey, type LineWords, tokenizeLine, type Word } from './passage/tokenize.js';

export { fade, type Faded, STAY_SHARE, UP_SHARE } from './practice/fade.js';

export { AGAIN_SHARE, grade, type Grade, type GradeOptions } from './practice/grade.js';

export {
	HIDDEN_SHARE,
	type HideInput,
	hideWords,
	type PastPass,
	type Shown,
} from './practice/hide.js';

export { isNeighbour, type Neighbours, QWERTY } from './practice/keyboard.js';

export { median, type PassSummary, summarize, tallyMisses } from './practice/pass.js';

export { randoms } from './practice/random.js';

export {
	type Effect,
	HESITATION_FACTOR,
	HESITATION_FLOOR_MS,
	hesitationThreshold,
	type Hint,
	isTyped,
	OUTLINE_AFTER_MS,
	startTyping,
	type Typing,
	typing,
	type TypingEvent,
	type TypingOptions,
	WORD_AFTER_MS,
	type WordResult,
} from './practice/typing.js';

export { addDays, instant, localDay } from './day.js';

export { isLearnt, type LearnedPass, learningPass } from './practice/learn.js';

export {
	type Activity,
	type ActivityWrite,
	activityPath,
	addToDay,
	type DayActivity,
	dayKey,
	NO_DAY,
	readActivity,
} from './rewards/activity.js';
