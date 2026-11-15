import { type ApiClient, connectCodeHeldUntil, watchConnectCode } from '@skysa/client';
import { type ConnectGate, MAX_CONNECT_CODE } from '@skysa/protocol';
import { type ReactNode, type RefObject, useEffect, useId, useRef, useState } from 'react';

import { formatMoment } from '../i18n/dates.js';
import { t } from '../i18n/t.js';
import { askAbout } from '../sync/connectCode.js';

/**
 * An operator's gate, where the connect buttons are (docs/ARCHITECTURE.md
 * §10, "The gate"): their message and their one link, before a provider's
 * consent screen ends in a refusal. Where the gate asks for a code, a field
 * for it, and the buttons once the operator's policy has taken one; where it
 * does not require one, "Already have access?" shows the buttons as they are.
 * Showing them grants nothing: the policy decides at the callback. Each step
 * takes the focus with it, as skysa-notes' does: the control pressed is gone
 * once the step changes, and a focus left on nothing starts again at the top.
 * Beside Connect again, where a library must be connected again, the field
 * alone, never in front of it (`CodeBeside`).
 */

type Client = Pick<ApiClient, 'checkConnectCode'>;

/** The longest delay `setTimeout` takes as meant; one longer fires at once. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/**
 * Until when this device holds a code the gate took, read at every render:
 * another tab can take or drop one, and the hold ends by the clock, each with
 * a render. A hold may run a year, longer than a timer can count, so the timer
 * wakes at its longest and is set again from there.
 */
const useHeldUntil = (): number | undefined => {
	const until = connectCodeHeldUntil();
	const [woken, setWoken] = useState(0);
	useEffect(
		() =>
			watchConnectCode(() => {
				setWoken((n) => n + 1);
			}),
		[]
	);
	useEffect(() => {
		if (until === undefined) return;
		const timer = setTimeout(
			() => {
				setWoken((n) => n + 1);
			},
			Math.min(Math.max(0, until - Date.now()) + 50, LONGEST_TIMER_MS)
		);
		return () => {
			clearTimeout(timer);
		};
	}, [until, woken]);
	return until;
};

/**
 * The field under the operator's label, and the button that asks their policy
 * whether the code will do before anything is connected. Taken as typed, with
 * nothing capitalised or corrected: whether case matters is the policy's to
 * say. Under it, after a refusal, why, in the policy's words where it gave
 * some: a live region, since the answer comes after the press. The button
 * stays pressable while the policy is asked, as skysa-notes' does: one
 * disabled under the press takes the focus with it. The field, though, is
 * read-only meanwhile, and Cancel not to be had: the answer is about the code
 * asked about, and is held as it comes.
 */
const CodeForm = ({
	label,
	client,
	onAccepted,
	onCancel,
	focused,
}: Readonly<{
	label: string;
	client: Client;
	onAccepted: () => void;
	/** Back to the step the field was opened from, where there is one to go back to. */
	onCancel: (() => void) | undefined;
	/** Whether the field takes the focus as it opens: asked for, not there from the first. */
	focused: boolean;
}>) => {
	const id = useId();
	const field = useRef<HTMLInputElement>(null);
	useEffect(() => {
		if (focused) field.current?.focus();
	}, [focused]);
	const [code, setCode] = useState('');
	const [checking, setChecking] = useState(false);
	const [problem, setProblem] = useState<string | undefined>(undefined);
	const blank = code.trim() === '';
	return (
		<form
			className="field-row"
			onSubmit={(event) => {
				event.preventDefault();
				if (blank || checking) return;
				setChecking(true);
				setProblem(undefined);
				void askAbout(client, code).then((said) => {
					setChecking(false);
					setProblem(said);
					if (said === undefined) {
						setCode('');
						onAccepted();
					}
				});
			}}
		>
			<label htmlFor={id}>{label}</label>
			<input
				id={id}
				ref={field}
				className="field"
				value={code}
				readOnly={checking}
				maxLength={MAX_CONNECT_CODE}
				autoComplete="one-time-code"
				autoCapitalize="off"
				autoCorrect="off"
				spellCheck={false}
				aria-invalid={problem === undefined ? undefined : true}
				aria-describedby={`${id}-said`}
				onChange={(event) => {
					setCode(event.target.value);
					// What was said was about the code before this one.
					setProblem(undefined);
				}}
			/>
			<div className="form-actions">
				<button type="submit" className="button" disabled={blank}>
					{checking ? t('sync.gate.code.checking') : t('sync.gate.code.use')}
				</button>
				{onCancel !== undefined && (
					<button
						type="button"
						className="button ghost"
						disabled={checking}
						onClick={onCancel}
					>
						{t('common.cancel')}
					</button>
				)}
			</div>
			<p
				id={`${id}-said`}
				className={problem === undefined ? undefined : 'field-problem'}
				role="status"
			>
				{problem}
			</p>
		</form>
	);
};

/**
 * Where the focus goes once a step has changed: a new object each time, so the
 * same place twice moves it twice. `opener` is the button the field was opened
 * from, which Cancel goes back to.
 */
type FocusTo = Readonly<{ to: 'buttons' | 'field' | 'opener' }>;

/** Moves the focus to where a step said, once the step is drawn. */
const useStepFocus = (
	focus: FocusTo | undefined,
	buttons: RefObject<HTMLDivElement | null>,
	opener: RefObject<HTMLButtonElement | null>
): void => {
	useEffect(() => {
		if (focus?.to === 'buttons') {
			// The container, where there is nothing in it to press: not the top of the page.
			(
				buttons.current?.querySelector<HTMLElement>('button:not(:disabled), a') ??
				buttons.current
			)?.focus();
		}
		if (focus?.to === 'opener') opener.current?.focus();
	}, [focus, buttons, opener]);
};

/**
 * The code this device holds, under the operator's label and until when, and
 * the button that asks for another; where none is held, "Have a code? Enter
 * it". One button either way, so a hold that ends by the clock, or one another
 * tab takes or drops, leaves the focus where it was.
 */
const CodeLine = ({
	label,
	until,
	opener,
	onClick,
}: Readonly<{
	label: string;
	until: number | undefined;
	/** The button Cancel brings the focus back to, where there is one. */
	opener?: RefObject<HTMLButtonElement | null>;
	onClick: () => void;
}>) => (
	<p className="field-hint">
		{until !== undefined && (
			<>{t('sync.gate.code.accepted', { label, time: formatMoment(until) })} </>
		)}
		<button
			ref={opener}
			type="button"
			className="button ghost"
			aria-label={
				until === undefined ? undefined : t('sync.gate.code.changeLabel', { label })
			}
			onClick={onClick}
		>
			{until === undefined ? t('sync.gate.code.enter') : t('sync.gate.code.change')}
		</button>
	</p>
);

/**
 * The field and the buttons are never both open, as in skysa-notes' gate: a
 * connect sends the code held, never what is in the field, so buttons beside
 * a field would connect with a code other than the one on screen.
 */

/** The operator's gate in front of `children`, the connect buttons; the buttons as they are where there is none. */
export const SyncGate = ({
	gate,
	client,
	children,
}: Readonly<{
	gate: ConnectGate | undefined;
	client: Client;
	children: ReactNode;
}>) => {
	const asked = gate?.connectCode;
	const until = useHeldUntil();
	const [shown, setShown] = useState(false);
	const [changing, setChanging] = useState(false);
	const [focus, setFocus] = useState<FocusTo | undefined>(undefined);
	const buttons = useRef<HTMLDivElement>(null);
	const change = useRef<HTMLButtonElement>(null);
	useStepFocus(focus, buttons, change);
	if (gate === undefined) return children;
	const held = asked !== undefined && until !== undefined;
	const required = asked?.required === true;
	// Open while another code is asked for, and where none is held until the
	// buttons are asked for instead ("Already have access?", never where required).
	const fieldOpen = asked !== undefined && (changing || (!held && !shown));
	const showing = !fieldOpen && (held || shown);
	const step = (): ReactNode => {
		if (asked === undefined) return null;
		if (held && !changing) {
			return (
				<CodeLine
					label={asked.label}
					until={until}
					opener={change}
					onClick={() => {
						setChanging(true);
						setShown(false);
						setFocus({ to: 'field' });
					}}
				/>
			);
		}
		if (fieldOpen) {
			return (
				<CodeForm
					label={asked.label}
					client={client}
					onAccepted={() => {
						setChanging(false);
						setFocus({ to: 'buttons' });
					}}
					onCancel={
						changing
							? () => {
									setChanging(false);
									setFocus({ to: 'opener' });
								}
							: undefined
					}
					focused={focus?.to === 'field'}
				/>
			);
		}
		return (
			<CodeLine
				label={asked.label}
				until={undefined}
				onClick={() => {
					setShown(false);
					setFocus({ to: 'field' });
				}}
			/>
		);
	};
	return (
		<>
			<p>{gate.message}</p>
			{/* In this window, as skysa-notes' gate link is. */}
			<p>
				<a href={gate.action.url} rel="noreferrer">
					{gate.action.label}
				</a>
			</p>
			{step()}
			{showing ? (
				<div ref={buttons} tabIndex={-1}>
					{children}
				</div>
			) : (
				!required &&
				!changing && (
					<div className="form-actions">
						<button
							type="button"
							className="button ghost"
							onClick={() => {
								setShown(true);
								setFocus({ to: 'buttons' });
							}}
						>
							{t('sync.gate.alreadyHave')}
						</button>
					</div>
				)
			)}
		</>
	);
};

/**
 * The operator's code beside `children`, Connect again, where the library must
 * be connected again (docs/ARCHITECTURE.md §10, "Connecting"): offered, never
 * asked for first, even where the gate requires one, since connecting again
 * stays out from behind the gate. It is how a policy that let the account in
 * by one code is given another without disconnecting first. No message and no
 * link: the account was let in once. Closed until asked for, with Cancel back
 * to where it was opened from; Connect again is hidden while it is open, as
 * the gate hides its buttons, since a connect sends the code held. Where no
 * code is asked for, or `/config` has not answered, Connect again alone, in
 * the same place, so it is not drawn again under the focus as the answer
 * comes.
 */
export const CodeBeside = ({
	asked,
	client,
	children,
}: Readonly<{
	asked: ConnectGate['connectCode'];
	client: Client;
	children: ReactNode;
}>) => {
	const until = useHeldUntil();
	const [open, setOpen] = useState(false);
	const [focus, setFocus] = useState<FocusTo | undefined>(undefined);
	const buttons = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLButtonElement>(null);
	useStepFocus(focus, buttons, opener);
	const ask = () => {
		setOpen(true);
		setFocus({ to: 'field' });
	};
	const step = (code: NonNullable<ConnectGate['connectCode']>): ReactNode => {
		if (open) {
			return (
				<CodeForm
					label={code.label}
					client={client}
					onAccepted={() => {
						setOpen(false);
						setFocus({ to: 'buttons' });
					}}
					onCancel={() => {
						setOpen(false);
						setFocus({ to: 'opener' });
					}}
					focused={focus?.to === 'field'}
				/>
			);
		}
		return <CodeLine label={code.label} until={until} opener={opener} onClick={ask} />;
	};
	return (
		<>
			{asked !== undefined && step(asked)}
			{!open && (
				<div ref={buttons} tabIndex={-1}>
					{children}
				</div>
			)}
		</>
	);
};
