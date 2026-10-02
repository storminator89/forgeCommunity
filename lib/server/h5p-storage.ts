import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm, realpath, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import prisma from '@/lib/prisma';
import { H5PValidationError, H5PPackage, validateH5PPath } from './h5p-archive';

export function h5pStorageRoot() { return path.resolve(process.env.H5P_STORAGE_PATH || path.join(process.cwd(), 'data', 'h5p')); }
export function validH5PId(id: string) { return /^[A-Za-z0-9_-]{1,80}$/.test(id); }

export async function storeH5PPackage(packageData: H5PPackage, userId: string, title = packageData.title) {
  const id = randomUUID();
  const root = h5pStorageRoot();
  const publicRoot = path.join(process.cwd(), 'public');
  if (root === publicRoot || root.startsWith(`${publicRoot}${path.sep}`)) throw new Error('H5P_STORAGE_PATH must be outside public assets');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(root);
  const canonicalPublic = await realpath(publicRoot).catch(() => path.resolve(publicRoot));
  if (canonicalRoot === canonicalPublic || canonicalRoot.startsWith(`${canonicalPublic}${path.sep}`)) throw new Error('H5P_STORAGE_PATH must be outside public assets');
  const temporary = path.join(canonicalRoot, `.import-${id}`);
  const destination = path.join(canonicalRoot, id);
  try {
    await mkdir(path.join(temporary, 'package'), { recursive: true, mode: 0o700 });
    for (const [name, bytes] of packageData.files) {
      const filename = path.join(temporary, 'package', validateH5PPath(name));
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      await writeFile(filename, bytes, { mode: 0o600, flag: 'wx' });
    }
    await writeFile(path.join(temporary, 'metadata.json'), JSON.stringify({ version: 1, title, mainLibrary: packageData.mainLibrary, expandedBytes: packageData.expandedBytes, fileCount: packageData.files.size, libraries: packageData.libraries }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, destination);
    const saved = await prisma.h5PContent.create({ data: { id, title, contentType: packageData.mainLibrary, userId }, select: { id: true, title: true, contentType: true, createdAt: true } });
    return { ...saved, embedUrl: `/h5p/embed/${id}` };
  } catch (error) {
    await Promise.all([rm(temporary, { recursive: true, force: true }), rm(destination, { recursive: true, force: true })]);
    throw error;
  }
}

export async function readH5PAsset(id: string, segments: string[]) {
  if (!validH5PId(id) || !segments.length || segments.some(segment => segment.includes('/') || segment.includes('\\'))) throw new H5PValidationError('Ungültiger H5P-Dateipfad.');
  const relative = validateH5PPath(segments.join('/'));
  const root = await realpath(h5pStorageRoot());
  const base = path.join(root, id, 'package');
  // No symbolic link is followed, including parent directories. Imported files
  // are private and extraction never creates links in the first place.
  let current = root;
  for (const segment of [id, 'package', ...relative.split('/')]) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new H5PValidationError('Verknüpfte H5P-Dateien dürfen nicht ausgeliefert werden.', 403);
  }
  const filename = path.join(base, relative);
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) throw new H5PValidationError('Ungültige H5P-Datei.');
    return { bytes: await file.readFile(), filename: relative };
  } finally { await file.close(); }
}

export function h5pAssetMime(filename: string) {
  const mime: Record<string, string> = {
    '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.avif': 'image/avif', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.wav': 'audio/wav',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  };
  return mime[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}
