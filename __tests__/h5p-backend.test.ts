/** @jest-environment node */
import { zipSync, strToU8 } from 'fflate';
import { mkdtemp, readdir, rm, readFile, symlink, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { H5P_MAX_EXPANDED_BYTES, H5PValidationError, extractH5PArchive, validateH5PPackage } from '@/lib/server/h5p-archive';
import { storeH5PPackage, readH5PAsset } from '@/lib/server/h5p-storage';
import { assertCanAttachH5P, authorizedH5PContent, createH5PAssetToken, verifyH5PAssetToken, h5pAppOrigin } from '@/lib/server/h5p-access';
import { POST as upload } from '@/app/api/h5p/upload/route';
import { GET as embed } from '@/app/h5p/embed/[id]/route';
import { GET as assets } from '@/app/api/h5p/assets/[id]/[token]/[...path]/route';
import { GET as metadata } from '@/app/api/h5p/contents/[id]/route';
import { getServerSession } from 'next-auth/next';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/request-body', () => ({ requestWithBodyLimit: async (request: Request) => request, RequestBodyLimitError: class extends Error {} }));
jest.mock('@/lib/server/rate-limit', () => ({ consumeRateLimit: () => ({ allowed: true }), rateLimitHeaders: () => ({}), UPLOAD_RATE_LIMIT: {} }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  h5PContent: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  courseContent: { findFirst: jest.fn() },
} }));
const db = prisma as unknown as {
  h5PContent: { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock };
  courseContent: { findFirst: jest.Mock };
};
const defaultManifest = { title: 'Interaktives Beispiel', mainLibrary: 'H5P.Example', preloadedDependencies: [{ machineName: 'H5P.Example', majorVersion: 1, minorVersion: 0 }] };
const defaultLibrary = { title: 'Example', machineName: 'H5P.Example', majorVersion: 1, minorVersion: 0, patchVersion: 0, runnable: 1, preloadedJs: [{ path: 'example.js' }], preloadedCss: [{ path: 'example.css' }] };
function archive(extra: Record<string, Uint8Array> = {}, manifest: unknown = defaultManifest, library: unknown = defaultLibrary) {
  return zipSync({
    'h5p.json': strToU8(JSON.stringify(manifest)), 'content/content.json': strToU8('{}'),
    'H5P.Example-1.0/library.json': strToU8(JSON.stringify(library)),
    'H5P.Example-1.0/example.js': strToU8('H5P.Example = function () {};'),
    'H5P.Example-1.0/example.css': strToU8('.example { padding: 20px; }'),
    'H5P.Example-1.0/semantics.json': strToU8('[]'), ...extra,
  });
}
function centralEntry(bytes: Uint8Array, name: string) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset + 46 <= bytes.length; offset++) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      const size = view.getUint16(offset + 28, true);
      if (new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + size)) === name) return { view, central: offset, local: view.getUint32(offset + 42, true) };
    }
  }
  throw new Error('Missing test ZIP entry');
}

let storage: string;
let records: Map<string, Record<string, unknown>>;
const originalStorage = process.env.H5P_STORAGE_PATH;
const originalSecret = process.env.NEXTAUTH_SECRET;
const originalAuthUrl = process.env.NEXTAUTH_URL;
const originalPublicUrl = process.env.NEXT_PUBLIC_APP_URL;
beforeEach(async () => {
  jest.clearAllMocks();
  storage = await mkdtemp(path.join(os.tmpdir(), 'forge-h5p-backend-'));
  process.env.H5P_STORAGE_PATH = storage;
  process.env.NEXTAUTH_SECRET = 'test-only-h5p-signing-key';
  delete process.env.NEXTAUTH_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;
  records = new Map();
  db.h5PContent.create.mockImplementation(async ({ data }) => { const saved = { ...data, createdAt: new Date() }; records.set(data.id, saved); return saved; });
  db.h5PContent.findUnique.mockImplementation(async ({ where }) => records.get(where.id) || null);
  db.courseContent.findFirst.mockResolvedValue(null);
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'owner', role: 'INSTRUCTOR' } } as never);
});
afterEach(async () => {
  await rm(storage, { recursive: true, force: true });
  for (const [key, value] of [['H5P_STORAGE_PATH', originalStorage], ['NEXTAUTH_SECRET', originalSecret], ['NEXTAUTH_URL', originalAuthUrl], ['NEXT_PUBLIC_APP_URL', originalPublicUrl]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

it('validates a real ZIP package, including standard deflated empty directory entries', () => {
  const result = validateH5PPackage(archive({ 'content/': new Uint8Array(0) }));
  expect(result.title).toBe('Interaktives Beispiel');
  expect(result.mainLibrary).toBe('H5P.Example');
  expect(result.libraries).toEqual(['H5P.Example-1.0']);
  expect(result.files.has('content/content.json')).toBe(true);
  expect(result.files.has('content')).toBe(false);
});

it.each(['../escape.js', '/absolute.js', 'content/../../escape.js', 'content\\escape.js', 'content/%2e%2e/escape.js', 'C:/escape.js'])(
  'rejects the unsafe ZIP path %s before extraction', unsafe => {
    expect(() => validateH5PPackage(archive({ [unsafe]: strToU8('bad') }))).toThrow(H5PValidationError);
  },
);

it('rejects ZIP symlinks, corruption, duplicate central paths and zip bombs', () => {
  const link = archive();
  const linked = centralEntry(link, 'H5P.Example-1.0/example.js');
  linked.view.setUint32(linked.central + 38, 0xa1ff0000, true);
  expect(() => validateH5PPackage(link)).toThrow(/Verknüpfungen/);
  const crc = archive();
  const corrupted = centralEntry(crc, 'h5p.json');
  corrupted.view.setUint32(corrupted.central + 16, 123, true);
  corrupted.view.setUint32(corrupted.local + 14, 123, true);
  expect(() => validateH5PPackage(crc)).toThrow(/Prüfsumme/);
  const duplicate = archive({ 'content/one.txt': strToU8('one'), 'content/two.txt': strToU8('two') });
  const duplicateEntry = centralEntry(duplicate, 'content/two.txt');
  duplicate.set(strToU8('content/one.txt'), duplicateEntry.central + 46);
  expect(() => validateH5PPackage(duplicate)).toThrow(/doppelte/);
  const bomb = archive();
  const bombEntry = centralEntry(bomb, 'h5p.json');
  bombEntry.view.setUint32(bombEntry.central + 24, H5P_MAX_EXPANDED_BYTES + 1, true);
  expect(() => validateH5PPackage(bomb)).toThrow(/zu groß/);
});

it('caps actual inflation when both ZIP headers lie about uncompressed output size', () => {
  const forged = archive();
  const entry = centralEntry(forged, 'h5p.json');
  entry.view.setUint32(entry.central + 24, 1, true);
  entry.view.setUint32(entry.local + 22, 1, true);
  expect(() => extractH5PArchive(forged)).toThrow(H5PValidationError);
});

it('rejects absent runtime dependencies, preload cycles and a dynamic-only main library', () => {
  const absent = { ...defaultManifest, preloadedDependencies: [...defaultManifest.preloadedDependencies, { machineName: 'H5P.Missing', majorVersion: 1, minorVersion: 0 }] };
  expect(() => validateH5PPackage(archive({}, absent))).toThrow(/H5P.Missing-1.0 fehlt/);
  expect(() => validateH5PPackage(archive({}, defaultManifest, { ...defaultLibrary, preloadedDependencies: defaultManifest.preloadedDependencies }))).toThrow(/Abhängigkeitszyklus/);
  expect(() => validateH5PPackage(archive({}, { ...defaultManifest, preloadedDependencies: [], dynamicDependencies: defaultManifest.preloadedDependencies }))).toThrow(/Hauptbibliothek/);
});

it('persists private package files and metadata, and cleans up when the database write fails', async () => {
  const imported = await storeH5PPackage(validateH5PPackage(archive()), 'owner');
  expect(imported.embedUrl).toBe(`/h5p/embed/${imported.id}`);
  const asset = await readH5PAsset(imported.id, ['H5P.Example-1.0', 'example.js']);
  expect(asset.bytes.toString()).toContain('H5P.Example');
  const storedMetadata = JSON.parse(await readFile(path.join(storage, imported.id, 'metadata.json'), 'utf8'));
  expect(storedMetadata).toMatchObject({ mainLibrary: 'H5P.Example', version: 1 });
  db.h5PContent.create.mockRejectedValueOnce(new Error('database offline'));
  await expect(storeH5PPackage(validateH5PPackage(archive()), 'owner')).rejects.toThrow('database offline');
  expect(await readdir(storage)).toEqual([imported.id]);
});

it('will not follow injected filesystem symlinks when serving a package file', async () => {
  const imported = await storeH5PPackage(validateH5PPackage(archive()), 'owner');
  await symlink('/etc/passwd', path.join(storage, imported.id, 'package', 'content', 'link.txt'));
  await expect(readH5PAsset(imported.id, ['content', 'link.txt'])).rejects.toThrow(/Verknüpfte/);
  await expect(readH5PAsset(imported.id, ['..', 'metadata.json'])).rejects.toThrow(H5PValidationError);
});

it('rejects a private storage configuration that points through a symlink into public files', async () => {
  const publicDir = path.join(process.cwd(), 'public', 'h5p-test-private-guard');
  const alias = path.join(storage, 'alias');
  await mkdir(publicDir, { recursive: true });
  try {
    await symlink(publicDir, alias);
    process.env.H5P_STORAGE_PATH = alias;
    await expect(storeH5PPackage(validateH5PPackage(archive()), 'owner')).rejects.toThrow('outside public assets');
  } finally { await rm(publicDir, { recursive: true, force: true }); }
});

it('issues short-lived content-scoped asset capabilities and refuses tampering or expiry', () => {
  const now = Date.UTC(2026, 9, 2);
  const token = createH5PAssetToken('content-1', now);
  expect(verifyH5PAssetToken('content-1', token, now)).toBe(true);
  expect(verifyH5PAssetToken('content-2', token, now)).toBe(false);
  expect(verifyH5PAssetToken('content-1', `${token.slice(0, -1)}!`, now)).toBe(false);
  expect(verifyH5PAssetToken('content-1', token, now + 2 * 60 * 60 * 1_000)).toBe(false);
});

it('grants existing course references only read access and blocks foreign package attachments', async () => {
  records.set('content-1', { id: 'content-1', title: 'Private', contentType: 'H5P.Example', userId: 'owner' });
  await expect(authorizedH5PContent('content-1', { id: 'stranger' }, 'http://localhost')).rejects.toMatchObject({ status: 403 });
  db.courseContent.findFirst.mockResolvedValue({ id: 'authorized-reference' });
  await expect(authorizedH5PContent('content-1', { id: 'student' }, 'http://localhost')).resolves.toMatchObject({ id: 'content-1' });
  await expect(assertCanAttachH5P('student', 'INSTRUCTOR', '/h5p/embed/content-1', 'http://localhost')).rejects.toMatchObject({ status: 403 });
  await expect(assertCanAttachH5P('owner', 'INSTRUCTOR', '/h5p/embed/content-1', 'http://localhost')).resolves.toBeUndefined();
  await expect(assertCanAttachH5P('admin', 'ADMIN', '/h5p/embed/content-1', 'http://localhost')).resolves.toBeUndefined();
});

it('recognizes public deployment origins behind a proxy instead of treating local URLs as remote', async () => {
  process.env.NEXTAUTH_URL = 'https://community.example.org/auth';
  records.set('content-1', { id: 'content-1', userId: 'owner' });
  expect(h5pAppOrigin('http://0.0.0.0:3013')).toBe('https://community.example.org');
  await expect(assertCanAttachH5P('stranger', 'INSTRUCTOR', 'https://community.example.org/h5p/embed/content-1', 'http://0.0.0.0:3013')).rejects.toMatchObject({ status: 403 });
  await expect(assertCanAttachH5P('stranger', 'INSTRUCTOR', 'https://external.example.org/exercises/1', 'http://0.0.0.0:3013')).resolves.toBeUndefined();
});

it('uploads a valid .h5p file and returns its real persisted embed URL', async () => {
  const bytes = archive();
  const file = { name: 'example.h5p', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const request = { url: 'http://localhost/api/h5p/upload', headers: new Headers(), formData: async () => ({ get: (key: string) => key === 'h5p' ? file : null }) };
  const response = await upload(request as never);
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body.embedUrl).toBe(`/h5p/embed/${body.id}`);
  expect(records.has(body.id)).toBe(true);
  expect((await readH5PAsset(body.id, ['h5p.json'])).bytes.length).toBeGreaterThan(0);
});

it('returns meaningful malformed archive and unauthorized upload responses', async () => {
  const request = { url: 'http://localhost/api/h5p/upload', headers: new Headers(), formData: async () => ({ get: () => ({ name: 'bad.h5p', size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }) }) };
  expect((await upload(request as never)).status).toBe(400);
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'student', role: 'USER' } } as never);
  expect((await upload(request as never)).status).toBe(403);
  expect(db.h5PContent.create).not.toHaveBeenCalled();
});

it('serves an isolated player and token assets without cookies, including range requests', async () => {
  const imported = await storeH5PPackage(validateH5PPackage(archive()), 'owner');
  const embedResponse = await embed(new Request(`http://localhost/h5p/embed/${imported.id}`) as never, { params: Promise.resolve({ id: imported.id }) });
  expect(embedResponse.status).toBe(200);
  const csp = embedResponse.headers.get('content-security-policy')!;
  expect(csp).toContain('sandbox allow-scripts');
  expect(csp).not.toContain('allow-same-origin');
  const html = await embedResponse.text();
  expect(html).toContain('H5PStandalone.H5P');
  expect(html).toContain('"embedType":"div"');
  expect(html).toContain('"credentials":"omit"');
  const token = html.match(/\/api\/h5p\/assets\/[^/]+\/([^/" ]+)/)![1];
  const assetParams = { params: Promise.resolve({ id: imported.id, token, path: ['H5P.Example-1.0', 'example.js'] }) };
  jest.mocked(getServerSession).mockResolvedValue(null);
  const source = await assets(new Request('http://localhost/asset') as never, assetParams);
  expect(source.status).toBe(200);
  expect(source.headers.get('access-control-allow-origin')).toBe('*');
  expect(source.headers.get('access-control-allow-credentials')).toBeNull();
  expect(source.headers.get('content-security-policy')).toContain('sandbox');
  expect(await source.text()).toContain('H5P.Example');
  const partial = await assets(new Request('http://localhost/asset', { headers: { Range: 'bytes=0-2' } }) as never, assetParams);
  expect(partial.status).toBe(206);
  expect(await partial.text()).toBe('H5P');
  const denied = await assets(new Request('http://localhost/asset') as never, { params: Promise.resolve({ id: imported.id, token: 'bad', path: ['h5p.json'] }) });
  expect(denied.status).toBe(403);
});

it('blocks unshared embed and metadata access while hiding the package owner from authorized metadata', async () => {
  const imported = await storeH5PPackage(validateH5PPackage(archive()), 'owner');
  const request = new Request(`http://localhost/h5p/embed/${imported.id}`);
  const params = { params: Promise.resolve({ id: imported.id }) };
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'stranger', role: 'USER' } } as never);
  expect((await embed(request as never, params)).status).toBe(403);
  expect((await metadata(request as never, params)).status).toBe(403);
  db.courseContent.findFirst.mockResolvedValue({ id: 'enrolled-course-reference' });
  const response = await metadata(request as never, params);
  expect(response.status).toBe(200);
  expect((await response.json()).userId).toBeUndefined();
  jest.mocked(getServerSession).mockResolvedValue(null);
  expect((await embed(request as never, params)).status).toBe(401);
});
