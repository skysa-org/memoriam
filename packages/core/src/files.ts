import { extensionOf } from './names/extension.js';

/**
 * Files in the library that are not passages. The app writes none yet, but a
 * user may keep one in the library's folder, and sync mirrors it as the
 * provider lists it (docs/ARCHITECTURE.md §10).
 */

/**
 * The type to tell a provider a file is, as it is uploaded, by its name. This
 * is what the provider records and nothing more: the app reads the extension,
 * never this. Anything not named here goes up as bytes.
 */
const UPLOAD_TYPES: ReadonlyMap<string, string> = new Map([
	['png', 'image/png'],
	['jpg', 'image/jpeg'],
	['jpeg', 'image/jpeg'],
	['gif', 'image/gif'],
	['webp', 'image/webp'],
	['avif', 'image/avif'],
	['svg', 'image/svg+xml'],
	['bmp', 'image/bmp'],
	['heic', 'image/heic'],
	['heif', 'image/heif'],
	['tif', 'image/tiff'],
	['tiff', 'image/tiff'],
	['pdf', 'application/pdf'],
	['txt', 'text/plain'],
	['csv', 'text/csv'],
	['zip', 'application/zip'],
	['mp3', 'audio/mpeg'],
	['m4a', 'audio/mp4'],
	['wav', 'audio/wav'],
	['ogg', 'audio/ogg'],
	['mp4', 'video/mp4'],
	['mov', 'video/quicktime'],
	['webm', 'video/webm'],
]);

export const contentTypeOf = (name: string): string | undefined =>
	UPLOAD_TYPES.get(extensionOf(name));
