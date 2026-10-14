// Generates PNG icons from public/icons/icon.svg (run: node scripts/icons.mjs)
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url));
const out = (n) => new URL(`../public/icons/${n}`, import.meta.url).pathname;
await sharp(svg).resize(192, 192).png().toFile(out('icon-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('icon-512.png'));
await sharp(svg).resize(180, 180).png().toFile(out('apple-touch-icon.png'));
// maskable: safe zone -> pad the artwork inside a full-bleed background
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0f1113' } }).composite([{ input: inner, left: 56, top: 56 }]).png().toFile(out('icon-maskable-512.png'));
console.log('icons written');
