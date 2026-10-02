import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Run inside the app container, against an explicitly selected disposable DB.
// The fixture marker survives container recreation together with private H5P
// storage. H5P_SMOKE_PHASE=verify only reads existing fixtures and plays them.
const file = process.env.SMOKE_SQLITE_FILE;
assert.ok(file && isAbsolute(file) && existsSync(file), 'SMOKE_SQLITE_FILE must select an initialized, disposable absolute SQLite file');
const sqliteFile = realpathSync(file);
const origin = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3013').replace(/\/$/, '');
const base = new URL(origin);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) && base.protocol === 'http:' && base.pathname === '/', 'SMOKE_BASE_URL must be a local HTTP server');
const phase = process.env.H5P_SMOKE_PHASE ?? 'create';
assert.ok(['create', 'verify'].includes(phase), 'H5P_SMOKE_PHASE must be create or verify');
const markerFile = join(dirname(sqliteFile), 'h5p-smoke-fixture.json');

function database(action) {
  const db = new DatabaseSync(sqliteFile);
  try { return action(db); } finally { db.close(); }
}
database(db => {
  for (const name of ['_app_migrations', 'User', 'Course', 'CourseContent', 'Enrollment', 'H5PContent']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name), `SQLite smoke database is missing ${name}`);
  }
});

function client() {
  const cookies = new Map();
  return async (path, { status = 200, method = 'GET', body, headers = {} } = {}) => {
    assert.ok(path.startsWith('/') && !path.startsWith('//'), 'Smoke request must be an app-relative path');
    const multipart = body instanceof FormData;
    const response = await fetch(origin + path, {
      method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: {
        ...(cookies.size ? { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
        ...(method !== 'GET' ? { origin } : {}),
        ...(body !== undefined && !multipart && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : multipart || typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    assert.equal(response.status, status, `${method} ${path}: ${(await response.clone().text()).slice(0, 2_000)}`);
    return response;
  };
}
async function login(request, email, password) {
  const { csrfToken } = await (await request('/api/auth/csrf')).json();
  const form = new URLSearchParams({ csrfToken, email, password, callbackUrl: origin + '/resources', json: 'true' });
  const result = await (await request('/api/auth/callback/credentials', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } })).json();
  assert.equal(result.url, origin + '/resources', 'H5P fixture credentials login failed');
}
const admin = client();
const learner = client();
const outsider = client();
const anonymous = client();
await anonymous('/api/health');

function makeArchive(title, maliciousPath = false) {
  // Resolve from /app rather than /tmp, where CI copies this script. This also
  // verifies that fflate is included in the standalone runtime dependency trace.
  const { strToU8, zipSync } = createRequire(resolve('package.json'))('fflate');
  const json = value => strToU8(JSON.stringify(value));
  const library = 'H5P.ForgeSmoke-1.0';
  const files = {
    'h5p.json': json({ title, language: 'en', mainLibrary: 'H5P.ForgeSmoke', embedTypes: ['div'], license: 'MIT', preloadedDependencies: [{ machineName: 'H5P.ForgeSmoke', majorVersion: 1, minorVersion: 0 }] }),
    'content/content.json': json({ text: 'Forge H5P smoke ready' }),
    [`${library}/library.json`]: json({ title: 'Forge Smoke', machineName: 'H5P.ForgeSmoke', majorVersion: 1, minorVersion: 0, patchVersion: 0, runnable: 1, embedTypes: ['div'], license: 'MIT', coreApi: { majorVersion: 1, minorVersion: 24 }, preloadedJs: [{ path: 'smoke.js' }] }),
    [`${library}/semantics.json`]: json([{ name: 'text', type: 'text', label: 'Text', default: 'Forge H5P smoke ready' }]),
    [`${library}/smoke.js`]: strToU8('H5P.ForgeSmoke = function (parameters) { this.attach = function ($container) { $container.text(parameters.text || "Forge H5P smoke ready"); }; };'),
  };
  if (maliciousPath) files['../forge-smoke-outside.txt'] = strToU8('must never be extracted');
  return zipSync(files, { level: 6 });
}
function uploadForm(bytes) {
  const form = new FormData();
  form.append('h5p', new Blob([bytes], { type: 'application/octet-stream' }), 'forge-smoke.h5p');
  return form;
}

let fixture;
if (phase === 'verify') {
  assert.ok(existsSync(markerFile), 'H5P fixture marker did not survive container recreation');
  fixture = JSON.parse(readFileSync(markerFile, 'utf8'));
  assert.equal(fixture.version, 1);
} else {
  assert.ok(!existsSync(markerFile), 'H5P create phase requires a fresh disposable fixture marker');
  const suffix = randomUUID();
  const password = 'H5P-Smoke-Strong-2026!';
  const accounts = { admin: `h5p-admin-${suffix}@example.test`, learner: `h5p-learner-${suffix}@example.test`, outsider: `h5p-outsider-${suffix}@example.test` };
  for (const [role, email] of Object.entries(accounts)) {
    await anonymous('/api/register', { method: 'POST', status: 201, body: { name: `H5P Smoke ${role}`, email, password } });
  }
  const userIds = database(db => {
    const ids = Object.fromEntries(Object.entries(accounts).map(([role, email]) => [role, db.prepare('SELECT id FROM "User" WHERE email=?').get(email)?.id]));
    assert.ok(Object.values(ids).every(id => typeof id === 'string'), 'H5P fixture registration did not persist');
    assert.equal(db.prepare('UPDATE "User" SET role=? WHERE id=?').run('ADMIN', ids.admin).changes, 1);
    return ids;
  });
  fixture = { version: 1, accounts, password, userIds, title: `H5P Smoke ${suffix}` };
}
await login(admin, fixture.accounts.admin, fixture.password);
await login(learner, fixture.accounts.learner, fixture.password);
await login(outsider, fixture.accounts.outsider, fixture.password);

if (phase === 'create') {
  const archive = makeArchive(fixture.title);
  await learner('/api/h5p/upload', { method: 'POST', status: 403, body: uploadForm(archive) });
  await anonymous('/api/h5p/upload', { method: 'POST', status: 401, body: uploadForm(archive) });
  await admin('/api/h5p/upload', { method: 'POST', status: 400, body: uploadForm(makeArchive(fixture.title, true)) });
  const uploaded = await (await admin('/api/h5p/upload', { method: 'POST', status: 201, body: uploadForm(archive) })).json();
  assert.equal(typeof uploaded.id, 'string');
  assert.ok(uploaded.id.length > 0, 'Upload did not return a real package ID');
  assert.equal(uploaded.title, fixture.title);
  assert.match(uploaded.contentType, /H5P\.ForgeSmoke/);
  assert.equal(uploaded.embedUrl, `/h5p/embed/${uploaded.id}`);
  fixture.packageId = uploaded.id;
  fixture.embedUrl = uploaded.embedUrl;

  // A foreign, unassigned package must remain private. Attach it through the
  // same HTTP API used by the editor, then grant one enrolled learner access.
  await outsider(`/api/h5p/contents/${fixture.packageId}`, { status: 403 });
  fixture.courseId = randomUUID();
  database(db => db.prepare('INSERT INTO "Course" (id,title,description,instructorId,updatedAt) VALUES (?,?,?,?,?)').run(fixture.courseId, fixture.title, 'Disposable H5P course fixture', fixture.userIds.admin, new Date().toISOString()));
  const attached = await (await admin(`/api/courses/${fixture.courseId}/contents`, { method: 'POST', status: 201, body: { title: 'Interactive smoke content', type: 'H5P', content: fixture.embedUrl, parentId: null } })).json();
  assert.equal(attached.type, 'H5P');
  assert.equal(attached.content, fixture.embedUrl);
  fixture.contentId = attached.id;
  database(db => db.prepare('INSERT INTO "Enrollment" (id,userId,courseId) VALUES (?,?,?)').run(randomUUID(), fixture.userIds.learner, fixture.courseId));
  writeFileSync(markerFile, JSON.stringify(fixture), { encoding: 'utf8', mode: 0o600 });
}

const adminContents = await (await admin('/api/h5p/contents')).json();
assert.ok(adminContents.some(item => item.id === fixture.packageId && item.title === fixture.title && item.embedUrl === fixture.embedUrl), 'Uploaded package missing from authenticated content list');
const outsiderContents = await (await outsider('/api/h5p/contents')).json();
assert.ok(!outsiderContents.some(item => item.id === fixture.packageId), 'Foreign package metadata leaked through content list');
await outsider(`/api/h5p/contents/${fixture.packageId}`, { status: 403 });
const detail = await (await admin(`/api/h5p/contents/${fixture.packageId}`)).json();
assert.equal(detail.id, fixture.packageId, 'Existing content ID lookup failed');
const courseContents = await (await learner(`/api/courses/${fixture.courseId}/contents`)).json();
assert.ok(courseContents.some(item => item.id === fixture.contentId && item.type === 'H5P' && item.content === fixture.embedUrl), 'Enrolled learner could not read attached H5P course content');

const embedded = await learner(fixture.embedUrl);
assert.match(embedded.headers.get('content-type') ?? '', /text\/html/);
const policy = embedded.headers.get('content-security-policy') ?? '';
const sandbox = policy.split(';').map(directive => directive.trim()).find(directive => /^sandbox(?:\s|$)/.test(directive));
assert.ok(sandbox && sandbox.includes('allow-scripts'), 'Embed response must sandbox its executable H5P content');
assert.ok(!sandbox.includes('allow-same-origin'), 'H5P iframe must have an opaque origin');
const html = await embedded.text();
assert.match(html, /H5PIntegration|H5PStandalone/, 'Embed did not contain H5P player integration');
assert.match(html, /h5p-runtime\//, 'Embed did not load the packaged H5P core runtime');
const runtimePath = html.match(/\/h5p-runtime\/[A-Za-z0-9_./-]+\.js/)?.[0];
assert.ok(runtimePath, 'Embed must reference a self-hosted player JavaScript asset');
const runtime = await anonymous(runtimePath, { headers: { origin: 'null' } });
assert.match(runtime.headers.get('content-type') ?? '', /javascript/);
assert.equal(runtime.headers.get('access-control-allow-origin'), '*');
assert.ok((await runtime.text()).length > 100, 'Self-hosted H5P player asset is empty');
const assetPrefix = `/api/h5p/assets/${fixture.packageId}/`;
const prefixPosition = html.indexOf(assetPrefix);
assert.ok(prefixPosition >= 0, 'Embed did not contain a tokenized private asset URL');
const token = html.slice(prefixPosition + assetPrefix.length).match(/^([A-Za-z0-9._-]+)(?:\/|["'<\s])/)?.[1];
assert.ok(token, 'Embed asset token could not be resolved');
const assetPath = `${assetPrefix}${token}/H5P.ForgeSmoke-1.0/smoke.js`;
// Sandboxed documents send no application cookies: their signed asset token
// grants only short-lived package reads, and CORS must admit the opaque origin.
const script = await anonymous(assetPath, { headers: { origin: 'null' } });
assert.equal(script.headers.get('access-control-allow-origin'), '*');
assert.match(await script.text(), /H5P\.ForgeSmoke/);
await anonymous(`${assetPrefix}invalid-token/H5P.ForgeSmoke-1.0/smoke.js`, { status: 403 });
await outsider(fixture.embedUrl, { status: 403 });

database(db => {
  assert.equal(db.prepare('SELECT count(*) AS count FROM "H5PContent" WHERE id=? AND userId=?').get(fixture.packageId, fixture.userIds.admin).count, 1, 'H5P package metadata was not persisted');
  assert.equal(db.prepare('SELECT content FROM "CourseContent" WHERE id=?').get(fixture.contentId)?.content, fixture.embedUrl);
});
console.log(`H5P ${phase === 'verify' ? 'restart persistence' : 'HTTP'} smoke passed: real package upload, archive path rejection, existing content lookup, course attachment, enrolled playback, opaque-origin sandbox, signed asset CORS, and denied foreign access.`);
