import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { usePressOutside } from '../src/components/ui/usePressOutside.js';

/** A press on the page around a dialog, begun and let go there, as its way out. */

const Asking = ({ onClose, busy }: { onClose: () => void; busy?: boolean }) => {
	const backdrop = useRef<HTMLDivElement>(null);
	usePressOutside(backdrop, onClose, busy);
	return (
		<div ref={backdrop} data-testid="backdrop">
			<div role="dialog">It goes for good.</div>
		</div>
	);
};

describe('a press outside', () => {
	it('is one begun and let go on the page around it', async () => {
		const onClose = vi.fn();
		render(<Asking onClose={onClose} />);

		await userEvent.click(screen.getByTestId('backdrop'));

		expect(onClose).toHaveBeenCalledOnce();
	});

	it('is not one begun outside and let go in the dialog, nor the other way', async () => {
		const onClose = vi.fn();
		const user = userEvent.setup();
		render(<Asking onClose={onClose} />);
		const backdrop = screen.getByTestId('backdrop');
		const dialog = screen.getByRole('dialog');

		await user.pointer([
			{ keys: '[MouseLeft>]', target: backdrop },
			{ target: dialog },
			{ keys: '[/MouseLeft]' },
		]);
		await user.pointer([
			{ keys: '[MouseLeft>]', target: dialog },
			{ target: backdrop },
			{ keys: '[/MouseLeft]' },
		]);

		expect(onClose).not.toHaveBeenCalled();
	});

	it('is one still when the page draws again while it is held', () => {
		const first = vi.fn();
		const onClose = vi.fn();
		const { rerender } = render(<Asking onClose={first} />);
		const backdrop = screen.getByTestId('backdrop');

		fireEvent.pointerDown(backdrop);
		// A handler made anew, as an inline one is on every draw.
		rerender(<Asking onClose={onClose} />);
		fireEvent.pointerUp(backdrop);
		fireEvent.click(backdrop);

		expect(onClose).toHaveBeenCalledOnce();
		expect(first).not.toHaveBeenCalled();
	});

	it('waits while the dialog is busy', async () => {
		const onClose = vi.fn();
		render(<Asking onClose={onClose} busy />);

		await userEvent.click(screen.getByTestId('backdrop'));

		expect(onClose).not.toHaveBeenCalled();
	});
});
