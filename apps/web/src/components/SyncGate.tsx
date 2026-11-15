import { type ApiClient, connectCodeHeldUntil, watchConnectCode } from '@skysa/client';
import { type ConnectGate, MAX_CONNECT_CODE } from '@skysa/protocol';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

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
 * disabled under the press takes the focus with it.
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
	/** Back to the code already held, where there is one. */
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
					<button type="button" className="button ghost" onClick={onCancel}>
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

/** Where the focus goes once a step has changed: a new object each time, so the same place twice moves it twice. */
type FocusTo = Readonly<{ to: 'buttons' | 'field' | 'change' }>;

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
	useEffect(() => {
		if (focus?.to === 'buttons') {
			buttons.current?.querySelector<HTMLElement>('button:not(:disabled), a')?.focus();
		}
		if (focus?.to === 'change') change.current?.focus();
	}, [focus]);
	if (gate === undefined) return children;
	const holding = asked !== undefined && until !== undefined && !changing;
	const required = asked?.required === true;
	return (
		<>
			<p>{gate.message}</p>
			{/* In this window, as skysa-notes' gate link is. */}
			<p>
				<a href={gate.action.url} rel="noreferrer">
					{gate.action.label}
				</a>
			</p>
			{asked !== undefined &&
				(holding ? (
					<p className="field-hint">
						{t('sync.gate.code.accepted', {
							label: asked.label,
							time: formatMoment(until),
						})}{' '}
						<button
							ref={change}
							type="button"
							className="button ghost"
							aria-label={t('sync.gate.code.changeLabel', { label: asked.label })}
							onClick={() => {
								setChanging(true);
								// Hidden again until a code is taken or let be, where they were shown.
								setShown(false);
								setFocus({ to: 'field' });
							}}
						>
							{t('sync.gate.code.change')}
						</button>
					</p>
				) : (
					<CodeForm
						label={asked.label}
						client={client}
						onAccepted={() => {
							setChanging(false);
							setFocus({ to: 'buttons' });
						}}
						onCancel={
							until === undefined
								? undefined
								: () => {
										setChanging(false);
										setFocus({ to: 'change' });
									}
						}
						focused={focus?.to === 'field'}
					/>
				))}
			{holding || (!required && shown) ? (
				<div ref={buttons}>{children}</div>
			) : (
				!required && (
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
