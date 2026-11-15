import {
	answer,
	api as appApi,
	type ApiClient,
	type Asked,
	dropConnectCode,
	type InstanceConfig,
	isLongRun,
	type SchedulerStatus,
	type SyncScheduler,
	useInstanceConfig,
} from '@skysa/client';
import type { EntitlementCode, ProviderKind } from '@skysa/protocol';
import type { SyncProgress } from '@skysa/sync';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import { formatMoment } from '../i18n/dates.js';
import { t } from '../i18n/t.js';
import { boundConnection } from '../store/connection.js';
import { useDb } from '../store/database.js';
import type { SyncStateRecord } from '../store/db.js';
import {
	CONNECTABLE,
	disconnectAccount,
	PROVIDER_LABELS,
	startConnecting,
	stopSyncingHere,
} from '../sync/account.js';
import { codeWasRefused } from '../sync/connectCode.js';
import { connectReturn as appConnectReturn, type Returned } from '../sync/connectReturn.js';
import { syncScheduler, useSyncStatus } from '../sync/runtime.js';
import { needsReconnect } from '../sync/status.js';
import { ConflictsBanner } from './ConflictsBanner.js';
import { Icon } from './Icon.js';
import { CodeBeside, SyncGate } from './SyncGate.js';
import { ConfirmDialog } from './ui/ConfirmDialog.js';
import { RunProgress } from './ui/RunProgress.js';

/**
 * Sync, in Settings (docs/ARCHITECTURE.md §10, "Connecting"): connecting a
 * storage account, how syncing with it stands, and letting it go.
 *
 * Connecting leaves the app for the provider's consent screen, and the server
 * sends the browser back here with how it went (`sync/connectReturn.ts`),
 * which is said once. Disconnecting asks the server first; where it will not
 * or cannot answer, the way out is to stop syncing on this device alone.
 */

type Client = Pick<ApiClient, 'config' | 'startConnect' | 'withCredential' | 'checkConnectCode'>;

/** What the server offers to connect: still asking, its providers, or no answer. */
type Offer =
	| Readonly<{ kind: 'asking' }>
	| Readonly<{ kind: 'ready'; providers: readonly ProviderKind[] }>
	| Readonly<{ kind: 'unavailable' }>;

/**
 * A refusal by the server's policy, by the kind of no it gave: on the way back
 * from a connect (`returned`), or as the status of an account it later stops
 * minting tokens for.
 */
const REFUSED: Readonly<
	Record<'returned' | 'status', Readonly<Record<EntitlementCode | 'unspecified', () => string>>>
> = {
	returned: {
		not_allowed: () => t('sync.returned.refused.notAllowed'),
		lapsed: () => t('sync.returned.refused.lapsed'),
		limit_reached: () => t('sync.returned.refused.limitReached'),
		unspecified: () => t('sync.returned.refused.unspecified'),
	},
	status: {
		not_allowed: () => t('sync.status.refused.notAllowed'),
		lapsed: () => t('sync.status.refused.lapsed'),
		limit_reached: () => t('sync.status.refused.limitReached'),
		unspecified: () => t('sync.status.refused.unspecified'),
	},
};

const refusedWords = (kind: 'returned' | 'status', code: EntitlementCode | undefined): string =>
	REFUSED[kind][code ?? 'unspecified']();

/**
 * How a connect went. A plain no to one made with a code typed into the
 * gate is said to be about the code (`codeWasRefused`).
 */
const returnedWords = ({ outcome, code }: Returned, codeRefused: boolean): string => {
	switch (outcome) {
		case 'refused':
			return codeRefused ? t('sync.returned.refused.code') : refusedWords('returned', code);
		case 'ok':
			return t('sync.returned.ok');
		case 'denied':
			return t('sync.returned.denied');
		case 'failed':
			return t('sync.returned.failed');
		case 'partial':
			return t('sync.returned.partial');
		case 'expired':
			return t('sync.returned.expired');
	}
};

/** The providers the server offers that this build can sync with. */
const offerOf = (asked: Asked<InstanceConfig>): Offer => {
	switch (asked.kind) {
		case 'asking':
			return { kind: 'asking' };
		case 'unreachable':
			return { kind: 'unavailable' };
		case 'answered':
			return {
				kind: 'ready',
				providers: CONNECTABLE.filter((kind) => asked.value.providers.includes(kind)),
			};
	}
};

/** How far a long run has got, in a sentence (`isLongRun`). */
const countLine = (progress: SyncProgress, provider: string): string => {
	switch (progress.stage) {
		case 'scanning':
			return progress.listing
				? t('sync.status.looking', { provider, count: progress.found })
				: t('sync.status.receiving', {
						provider,
						done: progress.done,
						total: progress.found,
					});
		case 'receiving':
			return progress.listing
				? t('sync.status.checkingFound', { provider, count: progress.total })
				: t('sync.status.receiving', {
						provider,
						done: progress.done,
						total: progress.total,
					});
		case 'uploading':
			return t('sync.status.sending', {
				provider,
				done: progress.done,
				total: progress.total,
			});
	}
};

/**
 * What a run still reading the provider's pages says, before it has found
 * enough to count: the pages of what changed, or of a re-scan. Said from the
 * first, since that can take minutes after another device moved many
 * passages, and "Syncing…" alone said nothing of why.
 */
const listingLine = (progress: SyncProgress | undefined, provider: string): string | undefined => {
	if (progress?.stage === 'receiving' && progress.listing) {
		return t('sync.status.checking', { provider });
	}
	if (progress?.stage === 'scanning' && progress.listing) {
		return t('sync.status.lookingStart', { provider });
	}
	return undefined;
};

/** What a sync under way is doing: how far a long run has got, or what it is reading. */
const syncingLine = (progress: SyncProgress | undefined, provider: string): string => {
	const count = isLongRun(progress) ? countLine(progress, provider) : undefined;
	return count ?? listingLine(progress, provider) ?? t('sync.status.syncing');
};

/**
 * How syncing stands, in a sentence. A library bound to a provider this app
 * has no adapter for (`syncable` false, `CONNECTABLE`) is one the kit's
 * scheduler gives its attention without an error of its own: this app says why.
 */
const statusLine = (
	status: SchedulerStatus,
	provider: string,
	syncable: boolean,
	now: number
): string => {
	const error = status.error ?? t('sync.failed');
	switch (status.phase) {
		case 'local':
		case 'idle':
			return status.lastSyncAt === undefined
				? t('sync.status.idle')
				: t('sync.status.idleSince', { time: formatMoment(status.lastSyncAt, now) });
		case 'syncing':
			return status.waiting === true
				? t('sync.status.waiting')
				: syncingLine(status.progress, provider);
		case 'offline':
			return t('sync.status.offline');
		case 'paused':
			return t('sync.status.paused', { provider });
		case 'retrying':
			return t('sync.status.retrying', { error });
		case 'attention':
			if (needsReconnect(status)) return t('sync.status.reconnect', { provider });
			if (!syncable) return t('sync.unsupported');
			if (status.refusal === 'not_entitled')
				return refusedWords('status', status.denial?.code);
			return status.stuck === undefined
				? t('sync.status.attention', { error })
				: t('sync.status.stuck', {
						path: status.stuck.path,
						error: status.stuck.error ?? error,
					});
	}
};

/**
 * What stands until something is done about it: the account must be connected
 * again (`needsReconnect`), or the server's policy refused it, with its reason.
 */
type Standing =
	Readonly<{ kind: 'reconnect' }> | Readonly<{ kind: 'refused'; reason: string | undefined }>;

const standingOf = (status: SchedulerStatus, syncable: boolean): Standing | undefined => {
	if (needsReconnect(status)) return { kind: 'reconnect' };
	if (syncable && status.phase === 'attention' && status.refusal === 'not_entitled') {
		return { kind: 'refused', reason: status.denial?.reason };
	}
	return undefined;
};

const reasonOf = (standing: Standing): string | undefined =>
	standing.kind === 'refused' ? standing.reason : undefined;

/**
 * What stands (`standingOf`), kept through the runs that go on meanwhile, each
 * of which starts as `syncing` and says nothing of it: the kit's scheduler
 * still starts one on focus and on edits, clearing the refusal as it starts,
 * so what is shown under it would go with each, and a code half typed with it.
 * Let go once a run ends any other way. The line says how syncing stands as it
 * is. Until the kit keeps a refusal itself (skysa-org/skysa-kit#22), which will
 * also do what this cannot: a run that fails on the network lets it go, and one
 * that gets through keeps it until it ends. Followed in render, as React has
 * state follow a prop; `Connected` is keyed by its connection, so another
 * starts with nothing kept.
 */
const useStanding = (status: SchedulerStatus, syncable: boolean): Standing | undefined => {
	const now = standingOf(status, syncable);
	const [kept, setKept] = useState<Standing | undefined>(undefined);
	if (
		now !== undefined &&
		(kept === undefined || kept.kind !== now.kind || reasonOf(kept) !== reasonOf(now))
	) {
		setKept(now);
	}
	if (now === undefined && status.phase !== 'syncing' && kept !== undefined) setKept(undefined);
	return now ?? kept;
};

/** Connect again, in a row of its own under what the line says. */
const ConnectAgain = ({ connect, busy }: Readonly<{ connect: () => void; busy: boolean }>) => (
	<div className="form-actions">
		<button type="button" className="button primary" disabled={busy} onClick={connect}>
			{t('sync.settings.connectAgain')}
		</button>
	</div>
);

interface Props {
	client?: Client;
	scheduler?: Pick<SyncScheduler, 'status' | 'subscribe' | 'syncNow' | 'pause'>;
	connectReturn?: Pick<typeof appConnectReturn, 'peek' | 'forget'>;
	/** Where the browser goes to consent. */
	leave?: (url: string) => void;
	now?: () => number;
}

/** Why a disconnect did not happen: the server said no, or did not answer. */
type Held = 'refused' | 'unreachable';

/**
 * Under a refusal by the server's policy: what it said of its own, where it
 * gave anything — the one place the policy's own words reach, since a refused
 * connect comes back in a URL, which carries none — and a way to connect the
 * account again, which takes it to the policy at the callback. Behind the
 * operator's gate where there is one, with the code it asks for: a policy that
 * let the account in by a code may need another to let it in again, and
 * `/token` never carries one.
 */
const Refused = ({
	reason,
	config,
	client,
	connect,
	busy,
}: Readonly<{
	reason: string | undefined;
	/** Asked before Connect again is offered, so a gate that requires a code is not stepped round. */
	config: Asked<InstanceConfig>;
	client: Client;
	connect: () => void;
	busy: boolean;
}>) => (
	<>
		{reason !== undefined && <p className="field-hint">{reason}</p>}
		{config.kind !== 'asking' && (
			<SyncGate gate={answer(config)?.connectGate} client={client}>
				<ConnectAgain connect={connect} busy={busy} />
			</SyncGate>
		)}
	</>
);

const Connected = ({
	bound,
	kind,
	client,
	config,
	scheduler,
	connect,
	busy,
	now,
	tell,
}: Readonly<{
	bound: SyncStateRecord;
	kind: ProviderKind;
	client: Client;
	config: Asked<InstanceConfig>;
	scheduler: NonNullable<Props['scheduler']>;
	connect: (provider: ProviderKind) => void;
	busy: boolean;
	now: number;
	/** Say something under the section, once this part of it may be gone. */
	tell: (said: string) => void;
}>) => {
	const db = useDb();
	const status = useSyncStatus(scheduler);
	const syncable = CONNECTABLE.includes(kind);
	const standing = useStanding(status, syncable);
	const reconnect = standing?.kind === 'reconnect';
	const [asking, setAsking] = useState(false);
	const [held, setHeld] = useState<Held | undefined>(undefined);
	const provider = PROVIDER_LABELS[kind];

	const disconnect = async () => {
		setAsking(false);
		const outcome = await disconnectAccount(db, client, bound.connectionId).catch(
			() => undefined
		);
		if (outcome === undefined) {
			setHeld('unreachable');
			return;
		}
		if (!outcome.ok) {
			setHeld('refused');
			return;
		}
		tell(t('sync.disconnect.done'));
	};

	return (
		<>
			<p>
				{bound.displayName === undefined
					? t('sync.settings.syncsWith', { provider })
					: t('sync.settings.syncsWithAccount', { provider, account: bound.displayName })}
			</p>
			{/* Sync has stopped until the account is connected again: said in the
			    colour of an error. */}
			<p
				className={needsReconnect(status) ? 'field-hint sync-problem' : 'field-hint'}
				role="status"
			>
				{statusLine(status, provider, syncable, now)}
			</p>
			{standing?.kind === 'refused' && (
				<Refused
					reason={standing.reason}
					config={config}
					client={client}
					connect={() => {
						connect(kind);
					}}
					busy={busy}
				/>
			)}
			{/* With the operator's code beside it, where their gate asks for one. */}
			{reconnect && (
				<CodeBeside asked={answer(config)?.connectGate?.connectCode} client={client}>
					<ConnectAgain
						connect={() => {
							connect(kind);
						}}
						busy={busy}
					/>
				</CodeBeside>
			)}
			{/* A run long enough to count: its bar, and the file it is on. A
			    few passages' sync is over before a bar could be read. */}
			{status.phase === 'syncing' && isLongRun(status.progress) && (
				<RunProgress status={status} label={t('sync.settings.progress')} />
			)}
			<div className="form-actions">
				{/* Paused, Sync now is what resumes it, and says so. */}
				<button
					type="button"
					className="button"
					disabled={status.phase === 'syncing'}
					onClick={() => {
						void scheduler.syncNow();
					}}
				>
					<Icon name="sync" />
					{status.phase === 'paused'
						? t('sync.settings.resume')
						: t('sync.settings.syncNow')}
				</button>
				{status.phase === 'syncing' && (
					<button
						type="button"
						className="button"
						title={t('sync.settings.pauseHint')}
						onClick={() => {
							scheduler.pause();
						}}
					>
						{t('sync.settings.pause')}
					</button>
				)}
				<button
					type="button"
					className="button"
					onClick={() => {
						setHeld(undefined);
						setAsking(true);
					}}
				>
					{t('sync.settings.disconnect')}
				</button>
			</div>
			{held !== undefined && (
				<div className="settings-said" role="alert">
					<p>
						{held === 'refused'
							? t('sync.disconnect.refused')
							: t('sync.disconnect.unreachable')}
					</p>
					<div className="form-actions">
						<button
							type="button"
							className="button"
							onClick={() => {
								void stopSyncingHere(db, bound.connectionId).then(() => {
									tell(t('sync.disconnect.done'));
								});
							}}
						>
							{t('sync.disconnect.here')}
						</button>
					</div>
				</div>
			)}
			{asking && (
				<ConfirmDialog
					title={t('sync.disconnect.title', { provider })}
					confirmLabel={t('sync.disconnect.confirm')}
					tone="primary"
					onConfirm={() => {
						void disconnect();
					}}
					onCancel={() => {
						setAsking(false);
					}}
				>
					{t('sync.disconnect.body', { provider })}
				</ConfirmDialog>
			)}
		</>
	);
};

const Offered = ({
	offer,
	connect,
	busy,
}: Readonly<{
	offer: Offer;
	connect: (provider: ProviderKind) => void;
	busy: ProviderKind | undefined;
}>) => {
	if (offer.kind === 'asking') return <p className="field-hint" aria-busy="true" />;
	if (offer.kind === 'unavailable') {
		return <p className="field-hint">{t('sync.settings.unavailable')}</p>;
	}
	if (offer.providers.length === 0)
		return <p className="field-hint">{t('sync.settings.none')}</p>;
	return (
		<div className="form-actions">
			{offer.providers.map((kind) => (
				<button
					key={kind}
					type="button"
					className="button"
					disabled={busy !== undefined}
					onClick={() => {
						connect(kind);
					}}
				>
					{busy === kind
						? t('sync.settings.connecting', { provider: PROVIDER_LABELS[kind] })
						: t('sync.settings.connect', { provider: PROVIDER_LABELS[kind] })}
				</button>
			))}
		</div>
	);
};

export const SyncSettings = ({
	client = appApi,
	scheduler = syncScheduler,
	connectReturn = appConnectReturn,
	leave = (url) => {
		window.location.assign(url);
	},
	now = Date.now,
}: Readonly<Props>) => {
	const db = useDb();
	// `null` once read and there is none, so the screen can tell that from reading.
	const bound = useLiveQuery(async () => (await boundConnection(db)) ?? null, [db]);
	const config = useInstanceConfig(client);
	const offer = offerOf(config);
	const gate = answer(config)?.connectGate;
	const [returned] = useState(() => connectReturn.peek());
	const [codeRefused] = useState(
		() => returned?.outcome === 'refused' && codeWasRefused(returned.code)
	);
	const [busy, setBusy] = useState<ProviderKind | undefined>(undefined);
	const [said, setSaid] = useState<string | undefined>(undefined);

	// Said once: shown for as long as the screen is, and not again.
	useEffect(() => {
		connectReturn.forget();
	}, [connectReturn]);
	// The code just turned down is let go of, so the field is empty for the next.
	useEffect(() => {
		if (codeRefused) dropConnectCode();
	}, [codeRefused]);

	const connect = (provider: ProviderKind) => {
		setBusy(provider);
		setSaid(undefined);
		void startConnecting(db, client, provider, window.location.pathname)
			.then((started) => {
				if (started.ok) {
					leave(started.value);
					return;
				}
				setBusy(undefined);
				setSaid(t('sync.settings.refused', { provider: PROVIDER_LABELS[provider] }));
			})
			.catch(() => {
				setBusy(undefined);
				setSaid(t('sync.settings.startFailed'));
			});
	};

	return (
		<section className="settings-section" aria-labelledby="settings-sync">
			<h2 id="settings-sync">{t('sync.settings.title')}</h2>
			{returned !== undefined && (
				<p className="settings-said" role="status">
					{returnedWords(returned, codeRefused)}
				</p>
			)}
			{/* A binding with no provider is one this app never writes
			    (`bindLibrary` names it), and connecting again replaces it. */}
			{bound === undefined ? null : bound === null || bound.provider === undefined ? (
				<>
					<p className="field-hint">{t('sync.settings.hint')}</p>
					<SyncGate gate={gate} client={client}>
						<Offered offer={offer} connect={connect} busy={busy} />
					</SyncGate>
				</>
			) : (
				<Connected
					key={bound.connectionId}
					bound={bound}
					kind={bound.provider}
					client={client}
					config={config}
					scheduler={scheduler}
					connect={connect}
					busy={busy !== undefined}
					now={now()}
					tell={setSaid}
				/>
			)}
			{said !== undefined && (
				<p className="settings-said" role="status">
					{said}
				</p>
			)}
			<ConflictsBanner />
		</section>
	);
};
