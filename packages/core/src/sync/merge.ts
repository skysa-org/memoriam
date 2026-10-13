import { PASSAGE_EXTENSION } from '../config.js';
import { foldName } from '../markdown/slug.js';
import { isHidden } from '../paths.js';
import { mergePassage } from '../progress/merge.js';
import {
	activityIsReadable,
	isActivityPath,
	mergeActivity,
	readActivity,
} from '../rewards/activity.js';
import { type MergeInput } from './engine.js';

/**
 * Memoriam's `SyncEngineOptions.merge` (docs/ARCHITECTURE.md §10, "Merge
 * before a conflict copy"): a passage practised on two devices, and a year's
 * activity both added to, made one file. Anything else, or either of those
 * where the words, the details or the YAML differ past what can be merged
 * without guessing, is none, and the engine keeps both files.
 */
export const mergeFile = ({ path, local, remote }: MergeInput): string | undefined => {
	if (isActivityPath(path)) {
		// The remote's read as no days at all would merge as nothing to add, and
		// the push would then write this device's file over it.
		if (!activityIsReadable(remote)) return undefined;
		const merged = mergeActivity(local, readActivity(remote));
		return merged.ok ? merged.text : undefined;
	}
	if (isHidden(path) || !foldName(path).endsWith(PASSAGE_EXTENSION)) return undefined;
	const merged = mergePassage(local, remote);
	if (merged.kind === 'same') return local;
	return merged.kind === 'merged' ? merged.text : undefined;
};
