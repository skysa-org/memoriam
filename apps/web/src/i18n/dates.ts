import { LOCALE } from './t.js';

/**
 * Days and weekdays in the user's language. The names come from the browser's
 * own locale data (`Intl`), not the catalog: they are the language's, not the
 * app's words.
 */

const FORMATS = {
	/** "Thursday" */
	weekday: new Intl.DateTimeFormat(LOCALE, { weekday: 'long' }),
	/** "13 Oct 2026" */
	medium: new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' }),
	/** "Tue 13 Oct" */
	short: new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' }),
} as const;

/** Noon on a day, `YYYY-MM-DD`, in local time: the same day whatever the clocks do. */
const noonOf = (day: string): Date => {
	const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
	return new Date(year, month - 1, date, 12);
};

export const formatDay = (day: string, style: keyof typeof FORMATS): string =>
	FORMATS[style].format(noonOf(day));

/** A day of the week by number, 0 for Sunday, as the language names it. */
export const weekdayName = (weekday: number): string =>
	// 4 January 1970 was a Sunday.
	FORMATS.weekday.format(new Date(1970, 0, 4 + weekday, 12));
