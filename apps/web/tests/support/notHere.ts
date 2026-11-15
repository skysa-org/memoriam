import { beforeEach, expect, it, type RunnerTestSuite } from 'vitest';

/**
 * Why a test of the kit's client suites (`@skysa/client/testing`) does not
 * run over this app's device: it needs what Memoriam does not have. Until the
 * kit can be told what a device has (skysa-org/skysa-kit#21), the tests are
 * named here, each with one of these.
 */
export const ONE_LIBRARY =
	'Memoriam’s library is bound to one connection at a time (`bindLibrary`), so it shows no other.';
export const NEVER_DETACHED =
	'Memoriam keeps no source detached: the library is cut loose when let go (`unbindLibrary`).';
export const NO_RESUME = 'Memoriam keeps no source detached, so has none to resume and check.';
export const NO_FIRST_IMPORT =
	'Memoriam has no first import: binding queues the whole library (`bindLibrary`).';
export const NO_HOLD_UP = 'Memoriam does not follow another tab’s transactions (`heldUp`).';

/** Every test title under `suite`, at any depth. */
const titlesIn = (suite: RunnerTestSuite): string[] =>
	suite.tasks.flatMap((task) => (task.type === 'suite' ? titlesIn(task) : [task.name]));

/**
 * Skip the tests of a kit suite this file runs that `titles` names, each said
 * to be skipped with why. Every title named must be the title of exactly one of
 * the file's tests, so that a test the kit renames or drops is not left here
 * skipping nothing, and one that shares its title is not skipped with it.
 */
export const notHere = (titles: Readonly<Record<string, string>>): void => {
	const why = new Map(Object.entries(titles));
	beforeEach(({ task, skip }) => {
		const reason = why.get(task.name);
		if (reason !== undefined) skip(reason);
	});
	it('skips only tests the kit’s suite has, one a title', ({ task }) => {
		const all = titlesIn(task.file);
		const times = (title: string) => all.filter((each) => each === title).length;
		expect([...why.keys()].filter((title) => times(title) !== 1)).toEqual([]);
	});
};
