import { type Catalog } from '../catalog.js';
import { badges } from './badges.js';
import { common } from './common.js';
import { conflicts } from './conflicts.js';
import { install } from './install.js';
import { library } from './library.js';
import { passage } from './passage.js';
import { practice } from './practice.js';
import { session } from './session.js';
import { settings } from './settings.js';
import { shell } from './shell.js';
import { stats } from './stats.js';
import { sync } from './sync.js';
import { today } from './today.js';

/**
 * The English catalog, and the one every other is checked against: its keys
 * are the app's message keys, and its placeholders and tags are what a
 * translation has to keep.
 */
export const en = {
	common,
	shell,
	install,
	today,
	library,
	passage,
	practice,
	session,
	settings,
	stats,
	badges,
	sync,
	conflicts,
} as const satisfies Catalog;
