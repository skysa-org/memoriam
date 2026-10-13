import { chunkPassage, CURRENT_CHUNKER, parsePassageFile } from '@memoriam/core';
import { useMemo } from 'react';

import { t } from '../i18n/t.js';
import { passageText } from '../store/passages.js';
import { lineText, shownPassage } from './shownPassage.js';

/**
 * A passage's words, as they are learnt: each section under its label, and
 * each chunk set apart from the next. For a passage cut by a chunker this
 * build does not have, the words as written.
 */
export const ChunkedText = ({ source }: Readonly<{ source: string }>) => {
	const chunked = useMemo(() => {
		const { body, chunker } = parsePassageFile(source);
		return chunkPassage(body, chunker ?? CURRENT_CHUNKER);
	}, [source]);
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
									<span key={l} className="passage-line">
										{lineText(line)}
									</span>
								))}
							</div>
						))}
					</section>
				))}
			</article>
		</>
	);
};
