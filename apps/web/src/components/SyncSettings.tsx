import { type ProviderKind } from '@memoriam/core';
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
import { syncScheduler, useSyncStatus } from '../sync/runtime.js';
import { type SchedulerStatus, type SyncScheduler } from '../sync/scheduler.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { ConflictsBanner } from './ConflictsBanner.js';
import { Icon } from './Icon.js';

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
			return t('sync.status.syncing');
		case 'offline':
			return t('sync.status.offline');
		case 'retrying':
			return t('sync.status.retrying', { error });
		case 'attention':
			if (status.refusal === 'reauthorize_required') {
				return t('sync.status.reconnect', { provider });
			}
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
	scheduler?: Pick<SyncScheduler, 'status' | 'subscribe' | 'syncNow'>;
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
			<p className="field-hint" role="status">
				{statusLine(status, provider, now)}
			</p>
			<div className="form-actions">
				{status.refusal === 'reauthorize_required' && (
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
				<button
					type="button"
					className="button"
					disabled={status.phase === 'syncing'}
					onClick={() => {
						void scheduler.syncNow();
					}}
				>
					<Icon name="sync" />
					{t('sync.settings.syncNow')}
				</button>
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
