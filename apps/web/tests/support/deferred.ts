/** A promise the test settles when it says. */
export const deferred = () => {
	const box = new Map<'resolve', () => void>();
	const promise = new Promise<void>((resolve) => {
		box.set('resolve', resolve);
	});
	return { promise, resolve: () => box.get('resolve')?.() };
};
