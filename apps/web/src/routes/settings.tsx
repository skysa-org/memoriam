import { DEFAULT_RETENTION, RETENTIONS } from '@memoriam/core';
import { createFileRoute } from '@tanstack/react-router';
import { useId } from 'react';

import { ErrorScreen } from '../components/ErrorScreen.js';
import { weekdayName } from '../i18n/dates.js';
import { t } from '../i18n/t.js';
import { db } from '../store/db.js';
import {
	INTERVAL_CHOICES,
	NEW_WORD_CHOICES,
	saveSetting,
	type Settings,
	useSettings,
	WEEKDAYS,
} from '../store/settings.js';

/** How practice is scheduled and typed, on this device (docs/ARCHITECTURE.md §5). */

/** The choice whose value is `value`, if it is one. */
const pick = <T extends number>(choices: readonly T[], value: string): T | undefined =>
	choices.find((choice) => String(choice) === value);

const save = <K extends keyof Settings>(key: K, value: Settings[K] | undefined) => {
	if (value !== undefined) void saveSetting(db, key, value);
};

const SettingsScreen = () => {
	const settings = useSettings();
	const id = useId();
	if (settings === undefined) return <main className="screen" aria-busy="true" />;
	const ids = {
		retention: `${id}-retention`,
		newWords: `${id}-new-words`,
		maxInterval: `${id}-max-interval`,
		slips: `${id}-slips`,
		restDay: `${id}-rest-day`,
	};
	const hints = {
		retention: `${id}-retention-hint`,
		newWords: `${id}-new-words-hint`,
		maxInterval: `${id}-max-interval-hint`,
		slips: `${id}-slips-hint`,
		restDay: `${id}-rest-day-hint`,
	};
	return (
		<main className="screen">
			<header className="screen-header">
				<h1>{t('settings.title')}</h1>
			</header>
			<p className="empty">{t('settings.device')}</p>
			<div className="field-row">
				<label htmlFor={ids.retention}>{t('settings.retention.label')}</label>
				<select
					id={ids.retention}
					className="field"
					aria-describedby={hints.retention}
					value={String(settings.retention)}
					onChange={(event) => {
						save('retention', pick(RETENTIONS, event.target.value));
					}}
				>
					{RETENTIONS.map((choice) => (
						<option key={choice} value={String(choice)}>
							{t(
								choice === DEFAULT_RETENTION
									? 'settings.retention.recommended'
									: 'settings.retention.choice',
								{ percent: Math.round(choice * 100) }
							)}
						</option>
					))}
				</select>
				<p id={hints.retention} className="field-hint">
					{t('settings.retention.hint')}
				</p>
			</div>
			<div className="field-row">
				<label htmlFor={ids.newWords}>{t('settings.newWords.label')}</label>
				<select
					id={ids.newWords}
					className="field"
					aria-describedby={hints.newWords}
					value={String(settings.newWords)}
					onChange={(event) => {
						save('newWords', pick(NEW_WORD_CHOICES, event.target.value));
					}}
				>
					{NEW_WORD_CHOICES.map((choice) => (
						<option key={choice} value={String(choice)}>
							{t('settings.newWords.choice', { count: choice })}
						</option>
					))}
				</select>
				<p id={hints.newWords} className="field-hint">
					{t('settings.newWords.hint')}
				</p>
			</div>
			<div className="field-row">
				<label htmlFor={ids.maxInterval}>{t('settings.maxInterval.label')}</label>
				<select
					id={ids.maxInterval}
					className="field"
					aria-describedby={hints.maxInterval}
					value={String(settings.maxInterval)}
					onChange={(event) => {
						save('maxInterval', pick(INTERVAL_CHOICES, event.target.value));
					}}
				>
					{INTERVAL_CHOICES.map((choice) => (
						<option key={choice} value={String(choice)}>
							{t('settings.maxInterval.choice', { count: choice })}
						</option>
					))}
				</select>
				<p id={hints.maxInterval} className="field-hint">
					{t('settings.maxInterval.hint')}
				</p>
			</div>
			<div className="field-row">
				<div className="field-check">
					<input
						id={ids.slips}
						type="checkbox"
						aria-describedby={hints.slips}
						checked={settings.slips}
						onChange={(event) => {
							save('slips', event.target.checked);
						}}
					/>
					<label htmlFor={ids.slips}>{t('settings.slips.label')}</label>
				</div>
				<p id={hints.slips} className="field-hint">
					{t('settings.slips.hint')}
				</p>
			</div>
			<div className="field-row">
				<label htmlFor={ids.restDay}>{t('settings.restDay.label')}</label>
				<select
					id={ids.restDay}
					className="field"
					aria-describedby={hints.restDay}
					value={settings.restDay === undefined ? '' : String(settings.restDay)}
					onChange={(event) => {
						void saveSetting(db, 'restDay', pick(WEEKDAYS, event.target.value));
					}}
				>
					<option value="">{t('settings.restDay.none')}</option>
					{WEEKDAYS.map((day) => (
						<option key={day} value={String(day)}>
							{weekdayName(day)}
						</option>
					))}
				</select>
				<p id={hints.restDay} className="field-hint">
					{t('settings.restDay.hint')}
				</p>
			</div>
		</main>
	);
};

export const Route = createFileRoute('/settings')({
	component: SettingsScreen,
	errorComponent: ErrorScreen,
});
