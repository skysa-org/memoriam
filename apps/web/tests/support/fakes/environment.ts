import type { SchedulerEnvironment, SchedulerEvent } from '../../../src/sync/scheduler.js';

/**
 * The browser, as the sync scheduler sees it: a clock, the events it listens
 * for, timers and locks, all moved by the test.
 */
export const fakeEnvironment = () => {
	const state = { now: 1_000_000, online: true, visible: true, nextId: 0 };
	const handlers = new Map<SchedulerEvent, Set<() => void>>();
	const timers = new Map<number, { at: number; callback: () => void }>();
	/** Each lock's tail: the next holder waits for it. */
	const locks = new Map<string, Promise<void>>();

	const environment: SchedulerEnvironment = {
		now: () => state.now,
		isOnline: () => state.online,
		isVisible: () => state.visible,
		listen: (event, handler) => {
			const set = handlers.get(event) ?? new Set();
			set.add(handler);
			handlers.set(event, set);
			return () => {
				set.delete(handler);
			};
		},
		setTimer: (callback, ms) => {
			state.nextId += 1;
			const id = state.nextId;
			timers.set(id, { at: state.now + ms, callback });
			return () => {
				timers.delete(id);
			};
		},
		withLock: <T>(name: string, work: () => Promise<T>): Promise<T> => {
			const held = (locks.get(name) ?? Promise.resolve()).then(work);
			locks.set(
				name,
				held.then(
					() => undefined,
					() => undefined
				)
			);
			return held;
		},
	};

	return {
		environment,
		state,
		fire: (event: SchedulerEvent) => {
			handlers.get(event)?.forEach((handler) => {
				handler();
			});
		},
		/** Move the clock on, running every timer that comes due on the way. */
		advance: (ms: number) => {
			state.now += ms;
			[...timers.entries()]
				.filter(([, timer]) => timer.at <= state.now)
				.sort(([, a], [, b]) => a.at - b.at)
				.forEach(([id, timer]) => {
					timers.delete(id);
					timer.callback();
				});
		},
		/** How far away each pending timer is. */
		pending: () =>
			[...timers.values()].map((timer) => timer.at - state.now).sort((a, b) => a - b),
	};
};
