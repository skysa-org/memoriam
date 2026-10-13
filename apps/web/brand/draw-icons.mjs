// Draws the default brand's six icons: `node apps/web/brand/draw-icons.mjs [out dir] [#RRGGBB]`.
//
// The mark is a passage being memorized: three lines of text on the brand's
// colour, the last of them fading into dots where its words have been hidden.
// Drawn from shapes rather than kept as artwork, so a set on another colour is
// one command. Plain Node, no dependencies: shapes are measured by their signed
// distance and sampled 4x4 per pixel, then written as 8-bit RGBA PNGs.

import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'icons');
const background = process.argv[3] ?? '#4338CA';

const hex = (text) => {
	if (!/^#[0-9a-f]{6}$/i.test(text)) throw new Error(`not a #RRGGBB colour: ${text}`);
	return [1, 3, 5].map((at) => parseInt(text.slice(at, at + 2), 16));
};

// ---- Shapes, in units of the icon's width ---------------------------------

const capsule = (ax, bx, y, radius) => (px, py) => {
	const t = Math.max(0, Math.min(1, (px - ax) / (bx - ax)));
	return Math.hypot(px - (ax + t * (bx - ax)), py - y) - radius;
};

const circle = (cx, cy, radius) => (px, py) => Math.hypot(px - cx, py - cy) - radius;

const roundedSquare = (inset, radius) => (px, py) => {
	const half = 0.5 - inset;
	const qx = Math.abs(px - 0.5) - half + radius;
	const qy = Math.abs(py - 0.5) - half + radius;
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
};

/** The mark: each part a shape and how opaque it is, around the centre at `scale`. */
const mark = (scale) => {
	const at = (value) => 0.5 + (value - 0.5) * scale;
	const r = 0.04 * scale;
	return [
		{ shape: capsule(at(0.25), at(0.75), at(0.33), r), alpha: 1 },
		{ shape: capsule(at(0.25), at(0.5), at(0.5), r), alpha: 1 },
		{ shape: capsule(at(0.6), at(0.75), at(0.5), r), alpha: 1 },
		{ shape: capsule(at(0.25), at(0.42), at(0.67), r), alpha: 1 },
		{ shape: circle(at(0.53), at(0.67), r), alpha: 0.7 },
		{ shape: circle(at(0.64), at(0.67), r), alpha: 0.5 },
		{ shape: circle(at(0.75), at(0.67), r), alpha: 0.3 },
	];
};

// ---- Rendering --------------------------------------------------------------

const SAMPLES = 4;

const render = (size, { tile, scale }) => {
	const [br, bg, bb] = hex(background);
	const parts = mark(scale);
	const plate = tile ? roundedSquare(0.03, 0.22) : () => -1;
	const pixels = Buffer.alloc(size * size * 4);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			let covered = 0;
			let white = 0;
			for (let sy = 0; sy < SAMPLES; sy += 1) {
				for (let sx = 0; sx < SAMPLES; sx += 1) {
					const px = (x + (sx + 0.5) / SAMPLES) / size;
					const py = (y + (sy + 0.5) / SAMPLES) / size;
					if (plate(px, py) > 0) continue;
					covered += 1;
					const alpha = parts.reduce(
						(most, part) =>
							part.shape(px, py) <= 0 ? Math.max(most, part.alpha) : most,
						0
					);
					white += alpha;
				}
			}
			const total = SAMPLES * SAMPLES;
			const on = covered === 0 ? 0 : white / covered;
			const at = (y * size + x) * 4;
			pixels[at] = Math.round(br + (255 - br) * on);
			pixels[at + 1] = Math.round(bg + (255 - bg) * on);
			pixels[at + 2] = Math.round(bb + (255 - bb) * on);
			pixels[at + 3] = Math.round((255 * covered) / total);
		}
	}
	return pixels;
};

// ---- PNG --------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

const crc32 = (bytes) => {
	let c = 0xffffffff;
	for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
};

const png = (size, pixels) => {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(size, 0);
	header.writeUInt32BE(size, 4);
	header[8] = 8; // bit depth
	header[9] = 6; // RGBA
	const rows = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y += 1) {
		rows[y * (size * 4 + 1)] = 0; // no filter
		pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	}
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(rows, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
};

// The favicons are a rounded tile, as a tab shows them best. Every other icon
// is a full square, since the platforms that show them round or crop it
// themselves; the maskable one keeps the mark inside the central 80% circle.
const ICONS = [
	{ file: 'favicon-16x16.png', size: 16, tile: true, scale: 1.25 },
	{ file: 'favicon-32x32.png', size: 32, tile: true, scale: 1.15 },
	{ file: 'apple-touch-icon.png', size: 180, tile: false, scale: 1 },
	{ file: 'pwa-192x192.png', size: 192, tile: false, scale: 1 },
	{ file: 'pwa-512x512.png', size: 512, tile: false, scale: 1 },
	{ file: 'pwa-maskable-512x512.png', size: 512, tile: false, scale: 0.8 },
];

mkdirSync(out, { recursive: true });
ICONS.forEach(({ file, size, tile, scale }) => {
	writeFileSync(join(out, file), png(size, render(size, { tile, scale })));
});
process.stdout.write(`Drew ${String(ICONS.length)} icons on ${background} into ${out}\n`);
