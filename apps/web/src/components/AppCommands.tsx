import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { exportLibrary } from '../archive/exportLibrary.js';
import { parseChord } from '../commands/chord.js';
import { useCommand } from '../commands/context.js';
import { t } from '../i18n/t.js';
import { db } from '../store/db.js';
import { CommandPalette } from './CommandPalette.js';
import { useNotices } from './Notices.js';

/**
 * What the app can be asked to do from anywhere in it, and the palette that
 * lists every command (docs/ARCHITECTURE.md §7, "Keyboard"). A screen adds its
 * own while it is open: a passage's page, its practice and its edit.
 *
 * Only the palette has a chord. The screens are a tap away in the bar, and the
 * chords a browser keeps for itself (`Mod+N`, `Mod+T`) cannot be taken.
 */

const PALETTE = parseChord('Mod+K');

export const AppCommands = () => {
	const navigate = useNavigate();
	const notices = useNotices();
	const [open, setOpen] = useState(false);
	const app = t('shell.commands.group.app');

	useCommand({
		id: 'app.palette',
		label: t('shell.commands.palette'),
		group: app,
		chord: PALETTE,
		enabled: true,
		run: () => {
			setOpen(true);
		},
	});
	useCommand({
		id: 'app.today',
		label: t('shell.commands.today'),
		group: app,
		enabled: true,
		run: () => void navigate({ to: '/' }),
	});
	useCommand({
		id: 'app.library',
		label: t('shell.commands.library'),
		group: app,
		enabled: true,
		run: () => void navigate({ to: '/library' }),
	});
	useCommand({
		id: 'app.stats',
		label: t('shell.commands.stats'),
		group: app,
		enabled: true,
		run: () => void navigate({ to: '/stats' }),
	});
	useCommand({
		id: 'app.settings',
		label: t('shell.commands.settings'),
		group: app,
		enabled: true,
		run: () => void navigate({ to: '/settings' }),
	});
	useCommand({
		id: 'app.export',
		label: t('shell.commands.export'),
		group: app,
		enabled: true,
		run: () => {
			void exportLibrary(db).then((exported) => {
				if (!exported.ok) notices.tell(t('settings.backup.tooLarge'));
			});
		},
	});
	useCommand({
		id: 'passage.new',
		label: t('shell.commands.newPassage'),
		group: t('shell.commands.group.passage'),
		enabled: true,
		run: () => void navigate({ to: '/new', search: {} }),
	});
	useCommand({
		id: 'practice.today',
		label: t('shell.commands.practiseToday'),
		group: t('shell.commands.group.practice'),
		enabled: true,
		run: () => void navigate({ to: '/session' }),
	});

	return open ? (
		<CommandPalette
			onClose={() => {
				setOpen(false);
			}}
		/>
	) : null;
};
