import {
	type ChunkedPassage,
	chunkPassage,
	CURRENT_CHUNKER,
	parsePassageFile,
	readProgress,
} from '@memoriam/core';
import { Fragment, useMemo } from 'react';

import { t } from '../i18n/t.js';
import { passageText } from '../store/passages.js';
import { type ShownLine, shownPassage } from './shownPassage.js';

/**
 * A passage's words, as they are learnt: each section under its label, and
 * each chunk set apart from the next, with the words most often missed marked
 * (docs/ARCHITECTURE.md §6, "Heat maps"). For a passage cut by a chunker this
 * build does not have, the words as written.
 */

/** How strongly a word is marked, by how often it has been missed. */
const heatOf = (misses: number): number => {
	if (misses >= 4) return 3;
	return misses >= 2 ? 2 : 1;
};

/** Each word's misses over all time, by its place in the passage. */
const missesOf = (chunked: ChunkedPassage, source: string): ReadonlyMap<number, number> => {
	const progress = readProgress(parsePassageFile(source).progress);
	return new Map(
		chunked.chunks.flatMap((chunk) =>
			(progress.chunks.get(chunk.key)?.misses ?? []).flatMap((count, at) =>
				count > 0 ? [[chunk.start + at, count] as const] : []
			)
		)
	);
};

const Line = ({
	line,
	misses,
}: Readonly<{ line: ShownLine; misses: ReadonlyMap<number, number> }>) => (
	<span className="passage-line">
		{line.lead}
		{line.words.map((word) => {
			const count = misses.get(word.index);
			return (
				<Fragment key={word.index}>
					{count === undefined ? (
						word.text
					) : (
						<span
							className={`passage-missed heat-${String(heatOf(count))}`}
							title={t('passage.missed', { count })}
						>
							{word.text}
						</span>
					)}
					{word.after}
				</Fragment>
			);
		})}
	</span>
);

export const ChunkedText = ({ source }: Readonly<{ source: string }>) => {
	const chunked = useMemo(() => {
		const { body, chunker } = parsePassageFile(source);
		return chunkPassage(body, chunker ?? CURRENT_CHUNKER);
	}, [source]);
	const misses = useMemo(
		() => (chunked === undefined ? new Map<number, number>() : missesOf(chunked, source)),
		[chunked, source]
	);
	const sections = useMemo(
		() => (chunked === undefined ? undefined : shownPassage(chunked)),
		[chunked]
	);

	if (chunked === undefined || sections === undefined) {
		return <article className="passage-text">{passageText(source)}</article>;
	}

	return (
		<>
			<p className="passage-size">
				{t('passage.words', { count: chunked.words.length })}
				{' · '}
				{t('passage.parts', { count: chunked.chunks.length })}
			</p>
			{misses.size > 0 && (
				<p className="field-hint passage-missed-hint">{t('passage.missedHint')}</p>
			)}
			<article className="passage-text">
				{sections.map((section, at) => (
					<section key={at} className="passage-section">
						{section.label !== undefined && (
							<h2 className="passage-label">{section.label}</h2>
						)}
						{section.chunks.map((chunk, n) => (
							<div
								key={chunk.key ?? `lead-${String(n)}`}
								className={
									chunk.key === undefined ? 'passage-lines' : 'passage-chunk'
								}
							>
								{chunk.lines.map((line, l) => (
									<Line key={l} line={line} misses={misses} />
								))}
							</div>
						))}
					</section>
				))}
			</article>
		</>
	);
};
