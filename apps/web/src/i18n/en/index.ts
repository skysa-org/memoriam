import { type Catalog } from '../catalog.js';
import { common } from './common.js';
import { install } from './install.js';
import { library } from './library.js';
import { passage } from './passage.js';
import { practice } from './practice.js';
import { shell } from './shell.js';
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
} as const satisfies Catalog;
