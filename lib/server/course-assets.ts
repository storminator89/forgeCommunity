import 'server-only';

import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@/generated/prisma/client';
import prisma from '@/lib/prisma';
import { readAndNormalizeImage } from '@/lib/server/image-upload';

const STORAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:gif|jpg|png|webp)$/;
const ASSET_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MIME_EXTENSION: Record<string, string> = {
  'image/gif': '.gif', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};

export class CourseAssetError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

export function courseAssetUrl(courseId: string, assetId: string) {
  return `/api/courses/${courseId}/assets/${assetId}`;
}

export function courseAssetStorageRoot() {
  return path.resolve(process.env.COURSE_ASSET_STORAGE_PATH || path.join(process.cwd(), 'data', 'course-assets'));
}

/** A private root may be configured, but never within public/ or through a symlink. */
async function checkedStorageRoot(create: boolean) {
  const root = courseAssetStorageRoot();
  const publicRoot = path.resolve(process.cwd(), 'public');
  if (root === publicRoot || root.startsWith(`${publicRoot}${path.sep}`)) throw new Error('Course asset storage must be outside public assets');
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  if ((await lstat(root)).isSymbolicLink()) throw new Error('Course asset storage cannot be a symlink');
  const canonicalRoot = await realpath(root);
  if (canonicalRoot !== root) throw new Error('Course asset storage path cannot contain a symlink');
  const canonicalPublic = await realpath(publicRoot).catch(() => publicRoot);
  if (canonicalRoot === canonicalPublic || canonicalRoot.startsWith(`${canonicalPublic}${path.sep}`)) {
    throw new Error('Course asset storage must be outside public assets');
  }
  return canonicalRoot;
}

/** Only canonical, relative, same-course URLs participate in the private asset contract. */
export function parseCourseAssetUrl(value: string) {
  const candidate = value.trim();
  if (!candidate.startsWith('/api/courses/')) return null;
  const match = /^\/api\/courses\/([A-Za-z0-9_-]{1,80})\/assets\/([A-Za-z0-9_-]{1,80})$/.exec(candidate);
  if (!match || !ASSET_ID.test(match[2])) throw new CourseAssetError('Ungültige Kursdatei-Adresse.');
  return { courseId: match[1], assetId: match[2] };
}

function textAssetUrls(value: unknown) {
  if (typeof value !== 'string' || !value) return [];
  const urls = [value];
  // The browser resolves HTML entities in src/href attributes. Inspect media
  // attributes as well as direct media URLs; unknown entity spellings can
  // never grant access because the active-reference check uses this parser too.
  if (value.includes('<')) {
    for (const match of value.matchAll(/(?:^|\s)(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
      const attribute = match[1] ?? match[2] ?? match[3] ?? '';
      urls.push(attribute.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|quot|apos|lt|gt|sol));?/gi, (_entity, decimal: string | undefined, hex: string | undefined, named: string | undefined) => {
        const digits = decimal ?? hex;
        if (digits !== undefined) {
          const codePoint = Number.parseInt(digits, decimal !== undefined ? 10 : 16);
          return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '';
        }
        return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', sol: '/' } as Record<string, string>)[(named ?? '').toLowerCase()] ?? '';
      }));
    }
  }
  return urls;
}

/** Enumerates local course assets from the saved payload, including HTML images. */
export function extractCourseAssetUrls(payload: unknown) {
  if (!payload || typeof payload !== 'object') return [];
  const draft = payload as { imageUrl?: unknown; contents?: unknown };
  const sources = textAssetUrls(draft.imageUrl);
  if (Array.isArray(draft.contents)) {
    for (const node of draft.contents) {
      if (node && typeof node === 'object') sources.push(...textAssetUrls((node as { content?: unknown }).content));
    }
  }
  const found = new Set<string>();
  for (const source of sources) {
    if (parseCourseAssetUrl(source)) found.add(source.trim());
  }
  return [...found];
}

export function activeAssetContentIds(payload: unknown, url: string): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const publication = payload as { contents?: unknown };
  if (!Array.isArray(publication.contents)) return [];
  const ids: string[] = [];
  for (const node of publication.contents) {
    if (!node || typeof node !== 'object') continue;
    const item = node as { id?: unknown; type?: unknown; content?: unknown };
    if (typeof item.id !== 'string' || (item.type !== 'TEXT' && item.type !== null)) continue;
    // Quiz JSON can contain private answer text and must never grant access.
    if (typeof item.content === 'string' && item.content.trimStart().startsWith('{')) {
      try {
        const parsed = JSON.parse(item.content) as unknown;
        if (parsed && typeof parsed === 'object' && 'questions' in parsed) continue;
      } catch { /* Malformed legacy text follows the existing text policy. */ }
    }
    if (textAssetUrls(item.content).some(value => value.trim() === url)) ids.push(item.id);
  }
  return ids;
}

export function activeAssetReference(payload: unknown, url: string): 'cover' | 'content' | null {
  if (!payload || typeof payload !== 'object') return null;
  const publication = payload as { imageUrl?: unknown; contents?: unknown };
  if (textAssetUrls(publication.imageUrl).some(value => value.trim() === url)) return 'cover';
  return activeAssetContentIds(payload, url).length ? 'content' : null;
}

type AssetReferenceDb = Pick<Prisma.TransactionClient, 'course' | 'courseAsset' | 'user'>;

export async function assertCanReferenceCourseAsset(db: AssetReferenceDb, courseId: string, actorId: string, url: string) {
  const parsed = parseCourseAssetUrl(url);
  if (!parsed) return;
  if (parsed.courseId !== courseId) throw new CourseAssetError('Kursdatei gehört zu einem anderen Kurs.', 403);
  const [course, actor, asset] = await Promise.all([
    db.course.findUnique({ where: { id: courseId }, select: { instructorId: true } }),
    db.user.findUnique({ where: { id: actorId }, select: { role: true } }),
    db.courseAsset.findUnique({ where: { id: parsed.assetId }, select: { courseId: true } }),
  ]);
  if (!course || !actor) throw new CourseAssetError('Kursdatei nicht gefunden.', 404);
  if (course.instructorId !== actorId && actor.role !== 'ADMIN') throw new CourseAssetError('Kein Zugriff auf die Kursdatei.', 403);
  if (!asset || asset.courseId !== courseId) throw new CourseAssetError('Kursdatei nicht gefunden.', 404);
}

type CourseAssetActor = { id: string };

async function assertCurrentCourseEditor(db: Pick<Prisma.TransactionClient, 'course' | 'user'>, courseId: string, actor: CourseAssetActor) {
  const [course, currentActor] = await Promise.all([
    db.course.findUnique({ where: { id: courseId }, select: { instructorId: true } }),
    db.user.findUnique({ where: { id: actor.id }, select: { role: true } }),
  ]);
  if (!course || !currentActor) throw new CourseAssetError('Kurs nicht gefunden.', 404);
  if (course.instructorId !== actor.id && currentActor.role !== 'ADMIN') throw new CourseAssetError('Kein Zugriff auf diesen Kurs.', 403);
}

/** Writes bytes before a short serializable DB transaction; failures remove the new orphan. */
export async function saveCourseAsset(courseId: string, actor: CourseAssetActor, file: File) {
  await assertCurrentCourseEditor(prisma, courseId, actor);
  const { bytes, extension } = await readAndNormalizeImage(file);
  const root = await checkedStorageRoot(true);
  const storageKey = `${randomUUID()}${extension}`;
  const filename = path.join(root, storageKey);
  try {
    await writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const asset = await prisma.$transaction(async tx => {
          await assertCurrentCourseEditor(tx, courseId, actor);
          return tx.courseAsset.create({
            data: { courseId, uploaderId: actor.id, storageKey, contentType: file.type, byteSize: bytes.byteLength },
            select: { id: true, contentType: true, byteSize: true },
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        return { id: asset.id, url: courseAssetUrl(courseId, asset.id), mimeType: asset.contentType, size: asset.byteSize };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        if (attempt === 3) throw new CourseAssetError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
      }
    }
  } catch (error) {
    await rm(filename, { force: true }).catch(cleanupError => {
      console.error('Failed to clean up uncommitted course asset:', cleanupError);
    });
    throw error;
  }
  throw new CourseAssetError('Gleichzeitige Änderung. Bitte erneut versuchen.', 409);
}

/** Do not follow file symlinks, and do not trust a storage path from the URL. */
export async function readCourseAsset(asset: { storageKey: string; contentType: string; byteSize: number }) {
  if (!STORAGE_KEY.test(asset.storageKey) || !asset.storageKey.endsWith(MIME_EXTENSION[asset.contentType] || '\0') ||
      asset.byteSize < 1 || asset.byteSize > 5 * 1024 * 1024) {
    throw new CourseAssetError('Kursdatei nicht gefunden.', 404);
  }
  const root = await checkedStorageRoot(false);
  const file = await open(path.join(root, asset.storageKey), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== asset.byteSize) throw new CourseAssetError('Kursdatei nicht gefunden.', 404);
    return await file.readFile();
  } finally {
    await file.close();
  }
}
