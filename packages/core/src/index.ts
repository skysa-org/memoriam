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
