import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const source = new URL('assets/source/navigation-outline/individual/', root);
const output = new URL('public/images/navigation/outline-v2/', root);
const names = [
  'community', 'members', 'projects', 'events', 'courses',
  'pathways', 'knowledge', 'resources', 'skills', 'missions',
  'drafts', 'chat', 'notifications', 'search', 'settings',
  'about', 'dashboard', 'user-management', 'moderation', 'saved',
];
const only = process.argv.find(arg => arg.startsWith('--only='))?.slice(7).split(',');
const selected = only ?? names;
if (selected.some(name => !names.includes(name))) throw new Error('Unknown icon name.');
await mkdir(output, { recursive: true });
const geometry = [];
for (const name of selected) {
  const input = await readFile(new URL(`${name}.png`, source));
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x1 = info.width, y1 = info.height, x2 = -1, y2 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    // Locate visible ink, ignoring near-transparent generation noise. Never slice a grid.
    if (data[(y * info.width + x) * 4 + 3] > 8) {
      x1 = Math.min(x1, x); y1 = Math.min(y1, y);
      x2 = Math.max(x2, x); y2 = Math.max(y2, y);
    }
  }
  if (x2 < 0) throw new Error(`Missing generated contour: ${name}`);
  const sourceMargin = Math.min(x1, y1, info.width - x2 - 1, info.height - y2 - 1);
  if (sourceMargin < Math.min(info.width, info.height) * .05) throw new Error(`Source contour too close to canvas edge: ${name}`);
  // Keep a source-space guard around the visible contour and its antialiasing.
  const guard = Math.ceil(Math.min(info.width, info.height) * .02);
  x1 = Math.max(0, x1 - guard); y1 = Math.max(0, y1 - guard);
  x2 = Math.min(info.width - 1, x2 + guard); y2 = Math.min(info.height - 1, y2 + guard);
  const width = x2 - x1 + 1, height = y2 - y1 + 1;
  await sharp(input).extract({ left: x1, top: y1, width, height })
    // Explicit contain is essential: the default cover crops wide/tall glyphs.
    // Keep one extend operation; Sharp only applies the final extend in a pipeline.
    .resize({ width: 80, height: 80, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ left: 8, right: 8, top: 8, bottom: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ lossless: true }).toFile(fileURLToPath(new URL(`${name}.webp`, output)));
  geometry.push({ name, source: { width: info.width, height: info.height, bounds: [x1, y1, x2, y2], minimumMargin: sourceMargin }, output: { width: 96, height: 96, minimumMargin: 8 } });
}
if (!only) await writeFile(new URL('geometry.json', source), JSON.stringify(geometry, null, 2) + '\n');
console.log(`Prepared ${selected.length} individually generated icons; full contours, 8px transparent gutters, lossless 96px WebP.`);
