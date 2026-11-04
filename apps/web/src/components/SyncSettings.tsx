import type { ProviderKind, SyncProgress } from '@memoriam/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';

import { api as appApi, type ApiClient } from '../api/client.js';
import { formatMoment } from '../i18n/dates.js';
import { t } from '../i18n/t.js';
import { boundConnection } from '../store/connection.js';
import { db as appDatabase, type MemoriamDatabase, type SyncStateRecord } from '../store/db.js';
import {
	CONNECTABLE,
	disconnectAccount,
	PROVIDER_LABELS,
	startConnecting,
	stopSyncingHere,
} from '../sync/account.js';
import { type ConnectOutcome, connectReturn as appConnectReturn } from '../sync/connectReturn.js';
import { isLongRun } from '../sync/progress.js';
import { syncScheduler, useSyncStatus } from '../sync/runtime.js';
import type { SchedulerStatus, SyncScheduler } from '../sync/scheduler.js';
import { needsReconnect } from '../sync/status.js';
import { ConflictsBanner } from './ConflictsBanner.js';
import { Icon } from './Icon.js';
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

type Client = Pick<ApiClient, 'config' | 'startConnect' | 'withCredential'>;

/** What the server offers to connect: still asking, its providers, or no answer. */
type Offer =
	| Readonly<{ kind: 'asking' }>
	| Readonly<{ kind: 'ready'; providers: readonly ProviderKind[] }>
	| Readonly<{ kind: 'unavailable' }>;

const RETURNED: Readonly<Record<ConnectOutcome, () => string>> = {
	ok: () => t('sync.returned.ok'),
	denied: () => t('sync.returned.denied'),
	failed: () => t('sync.returned.failed'),
	partial: () => t('sync.returned.partial'),
	expired: () => t('sync.returned.expired'),
};

/** The providers the server offers that this build can sync with, asked once. */
const useOffer = (client: Pick<ApiClient, 'config'>): Offer => {
	const [offer, setOffer] = useState<Offer>({ kind: 'asking' });
	useEffect(() => {
		const gone = new AbortController();
		void client
			.config()
			.then((config) => ({
				kind: 'ready' as const,
				providers: CONNECTABLE.filter((kind) => config.providers.includes(kind)),
			}))
			.catch(() => ({ kind: 'unavailable' as const }))
			.then((next) => {
				if (!gone.signal.aborted) setOffer(next);
			});
		return () => {
			gone.abort();
		};
	}, [client]);
	return offer;
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

/** How syncing stands, in a sentence. */
const statusLine = (status: SchedulerStatus, provider: string, now: number): string => {
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
			return status.stuck === undefined
				? t('sync.status.attention', { error })
				: t('sync.status.stuck', {
						path: status.stuck.path,
						error: status.stuck.error ?? error,
					});
	}
};

interface Props {
	database?: MemoriamDatabase;
	client?: Client;
	scheduler?: Pick<SyncScheduler, 'status' | 'subscribe' | 'syncNow' | 'pause'>;
	connectReturn?: Pick<typeof appConnectReturn, 'peek' | 'forget'>;
	/** Where the browser goes to consent. */
	leave?: (url: string) => void;
	now?: () => number;
}

/** Why a disconnect did not happen: the server said no, or did not answer. */
type Held = 'refused' | 'unreachable';

const Connected = ({
	bound,
	kind,
	database,
	client,
	scheduler,
	connect,
	busy,
	now,
	tell,
}: Readonly<{
	bound: SyncStateRecord;
	kind: ProviderKind;
	database: MemoriamDatabase;
	client: Client;
	scheduler: NonNullable<Props['scheduler']>;
	connect: (provider: ProviderKind) => void;
	busy: boolean;
	now: number;
	/** Say something under the section, once this part of it may be gone. */
	tell: (said: string) => void;
}>) => {
	const status = useSyncStatus(scheduler);
	const reconnect = needsReconnect(status);
	const [asking, setAsking] = useState(false);
	const [held, setHeld] = useState<Held | undefined>(undefined);
	const provider = PROVIDER_LABELS[kind];

	const disconnect = async () => {
		setAsking(false);
		const outcome = await disconnectAccount(database, client, bound.connectionId).catch(
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
			<p className={reconnect ? 'field-hint sync-problem' : 'field-hint'} role="status">
				{statusLine(status, provider, now)}
			</p>
			{/* A run long enough to count: its bar, and the file it is on. A
			    few passages' sync is over before a bar could be read. */}
			{status.phase === 'syncing' && isLongRun(status.progress) && (
				<RunProgress status={status} label={t('sync.settings.progress')} />
			)}
			<div className="form-actions">
				{reconnect && (
					<button
						type="button"
						className="button primary"
						disabled={busy}
						onClick={() => {
							connect(kind);
						}}
					>
						{t('sync.settings.connectAgain')}
					</button>
				)}
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
								void stopSyncingHere(database, bound.connectionId).then(() => {
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
	database = appDatabase,
	client = appApi,
	scheduler = syncScheduler,
	connectReturn = appConnectReturn,
	leave = (url) => {
		window.location.assign(url);
	},
	now = Date.now,
}: Readonly<Props>) => {
	// `null` once read and there is none, so the screen can tell that from reading.
	const bound = useLiveQuery(async () => (await boundConnection(database)) ?? null, [database]);
	const offer = useOffer(client);
	const [returned] = useState(() => connectReturn.peek());
	const [busy, setBusy] = useState<ProviderKind | undefined>(undefined);
	const [said, setSaid] = useState<string | undefined>(undefined);

	// Said once: shown for as long as the screen is, and not again.
	useEffect(() => {
		connectReturn.forget();
	}, [connectReturn]);

	const connect = (provider: ProviderKind) => {
		setBusy(provider);
		setSaid(undefined);
		void startConnecting(database, client, provider, window.location.pathname)
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
					{RETURNED[returned]()}
				</p>
			)}
			{/* A binding with no provider is one this app never writes
			    (`bindLibrary` names it), and connecting again replaces it. */}
			{bound === undefined ? null : bound === null || bound.provider === undefined ? (
				<>
					<p className="field-hint">{t('sync.settings.hint')}</p>
					<Offered offer={offer} connect={connect} busy={busy} />
				</>
			) : (
				<Connected
					bound={bound}
					kind={bound.provider}
					database={database}
					client={client}
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
			<ConflictsBanner database={database} />
		</section>
	);
};
