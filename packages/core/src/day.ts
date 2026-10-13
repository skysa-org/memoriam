/**
 * Days as the app counts them: the user's own, in local time, spelt
 * `YYYY-MM-DD`. A chunk is due on a day, and practice is counted by the day,
 * wherever midnight falls in UTC.
 */

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** The local day a moment falls on. */
export const localDay = (date: Date): string =>
	`${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The day `count` days after `day` (before, for a negative count). */
export const addDays = (day: string, count: number): string => {
	const [year = 0, month = 1, date = 1] = day.split('-').map(Number);
	// Noon, so no change of clocks moves it onto another day.
	return localDay(new Date(year, month - 1, date + count, 12));
};

/** A moment as the frontmatter keeps it: UTC, to the second (`2026-10-13T14:03:02Z`). */
export const instant = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;
