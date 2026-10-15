import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';

// This script creates tables, users, publications and a failure trigger. It is
// deliberately restricted to a local, explicitly disposable forge_test DB.
assert.equal(process.env.POSTGRESQL_PUBLICATION_SMOKE_DISPOSABLE, '1',
  'Set POSTGRESQL_PUBLICATION_SMOKE_DISPOSABLE=1 only for a disposable local forge_test database.');
assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required.');
const baseUrl = new URL(process.env.DATABASE_URL);
assert.ok(['postgres:', 'postgresql:'].includes(baseUrl.protocol), 'PostgreSQL URL is required.');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'PostgreSQL must be local.');
assert.equal(baseUrl.pathname, '/forge_test', 'Only the disposable forge_test database is allowed.');
assert.equal(baseUrl.search, '', 'Pass a database URL without schema or other parameters; this script creates its own unique schema.');
assert.equal(baseUrl.hash, '', 'Database URL fragments are not allowed.');
assert.ok(!process.env.DATABASE_PROVIDER || process.env.DATABASE_PROVIDER === 'postgresql',
  'DATABASE_PROVIDER must be postgresql.');

const schema = `lms_smoke_${randomUUID().replaceAll('-', '')}`;
const schemaUrl = new URL(baseUrl);
schemaUrl.searchParams.set('schema', schema);
const databaseUrl = schemaUrl.toString();
const database = new pg.Client({ connectionString: baseUrl.toString() });
let app;
let appError;
let assetRoot;
let appLogs = '';
let checks = 0;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code}).`));
    });
  });
}

async function port() {
  const reservation = createServer();
  await new Promise((resolve, reject) => reservation.once('error', reject).listen(0, '127.0.0.1', resolve));
  const selected = reservation.address().port;
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return selected;
}

function httpClient(origin) {
  const cookies = new Map();
  return async (path, { method = 'GET', body, status = 200, headers = {} } = {}) => {
    assert.ok(path.startsWith('/') && !path.startsWith('//'), 'Only app-relative smoke requests are allowed.');
    const multipart = body instanceof FormData;
    const response = await fetch(origin + path, {
      method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: {
        ...(cookies.size ? { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') } : {}),
        ...(method !== 'GET' ? { origin } : {}),
        ...(body !== undefined && !multipart && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : multipart || typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const divider = pair.indexOf('=');
      if (divider > 0) cookies.set(pair.slice(0, divider), pair.slice(divider + 1));
    }
    checks++;
    const allowed = Array.isArray(status) ? status : [status];
    assert.ok(allowed.includes(response.status),
      `${method} ${path}: expected ${allowed.join('/')} but received ${response.status}: ${(await response.clone().text()).slice(0, 1_500)}`);
    return response;
  };
}

async function login(request, origin, email, password) {
  const { csrfToken } = await (await request('/api/auth/csrf')).json();
  const form = new URLSearchParams({ csrfToken, email, password, callbackUrl: origin + '/resources', json: 'true' });
  const response = await request('/api/auth/callback/credentials', {
    method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal((await response.json()).url, origin + '/resources', 'Credential login failed.');
}

async function waitForApp(origin) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (appError) throw appError;
    if (app.exitCode !== null) throw new Error(`Standalone app exited early: ${appLogs.slice(-6_000)}`);
    try {
      const result = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(2_000) });
      if (result.status === 200) return;
    } catch { /* The socket may not be listening yet. */ }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`Standalone app did not become healthy: ${appLogs.slice(-6_000)}`);
}

async function main() {
  await database.connect();
  await database.query(`CREATE SCHEMA "${schema}"`);
  await database.query(`SET search_path TO "${schema}"`);
  const selectedPort = await port();
  const origin = `http://127.0.0.1:${selectedPort}`;
  assetRoot = await mkdtemp(join(tmpdir(), 'forge-lms-assets-'));
  const appEnv = {
    ...process.env,
    DATABASE_PROVIDER: 'postgresql', DATABASE_URL: databaseUrl,
    NEXTAUTH_SECRET: randomBytes(32).toString('hex'),
    NEXTAUTH_URL: origin, NEXT_PUBLIC_APP_URL: origin,
    COURSE_ASSET_STORAGE_PATH: assetRoot,
  };
  delete appEnv.COURSE_AUTHOR_WRITES_FROZEN;

  // Use the reviewed fresh-install schema in a unique namespace. Keeping the
  // ?schema URL all the way into the app catches PG-adapter search-path bugs.
  await run('npm', ['run', 'db:deploy', '--', '--initialize-empty-schema'], appEnv);
  await run(process.execPath, ['scripts/assert-course-publication-ready.mjs'], appEnv);
  await run('npm', ['run', 'db:generate'], appEnv);
  await run('npm', ['run', 'build'], appEnv);
  app = spawn(process.execPath, ['.next/standalone/server.js'], { env: { ...appEnv, PORT: String(selectedPort), HOSTNAME: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  app.on('error', error => { appError = error; });
  app.stdout.on('data', data => { appLogs = (appLogs + data).slice(-12_000); });
  app.stderr.on('data', data => { appLogs = (appLogs + data).slice(-12_000); });
  await waitForApp(origin);

  const anonymous = httpClient(origin);
  const author = httpClient(origin);
  const learner = httpClient(origin);
  // The catalogue is available to signed-in community members only. Keep an
  // anonymous negative check and inspect its publication filter as a learner.
  await anonymous('/api/courses', { status: 401 });
  const suffix = randomUUID();
  const password = 'Postgresql-Smoke-Strong-2026!';
  const authorEmail = `lms-author-${suffix}@example.test`;
  const learnerEmail = `lms-learner-${suffix}@example.test`;
  await anonymous('/api/register', { method: 'POST', status: 201, body: { name: 'PG Smoke Author', email: authorEmail, password } });
  const learnerRegistration = await (await anonymous('/api/register', {
    method: 'POST', status: 201, body: { name: 'PG Smoke Learner', email: learnerEmail, password },
  })).json();
  await login(author, origin, authorEmail, password);
  await login(learner, origin, learnerEmail, password);
  assert.deepEqual(await (await learner('/api/courses')).json(), [],
    'Fresh isolated schema unexpectedly contains visible courses.');

  const privateTitle = `Private unpublished ${randomUUID()}`;
  const createForm = new FormData();
  createForm.set('title', privateTitle);
  createForm.set('description', 'Saved draft description');
  const created = await (await author('/api/courses', { method: 'POST', status: 201, body: createForm })).json();
  assert.ok(created.id && created.activePublicationId === null, 'Course creation must leave an unpublished draft.');
  const courseId = created.id;
  const route = `/api/courses/${courseId}`;
  const privateDirectory = await (await learner('/api/courses')).json();
  assert.ok(!privateDirectory.some(course => course.id === courseId || course.title === privateTitle),
    'Unpublished course leaked through the member directory.');
  await anonymous(route, { status: 401 });
  await learner(route, { status: 404 });
  await learner(`${route}/enrollment`, { method: 'POST', status: 404 });
  await learner(`${route}/authoring`, { status: 403 });

  let draft = (await (await author(`${route}/authoring`)).json()).draft;
  assert.equal(draft.revision, 0);
  assert.equal(draft.payload.title, privateTitle);
  const upload = new FormData();
  upload.set('file', new Blob([png], { type: 'image/png' }), 'cover.png');
  const asset = await (await author(`${route}/authoring/assets`, { method: 'POST', status: 201, body: upload })).json();
  assert.equal(asset.url, `${route}/assets/${asset.id}`);
  assert.equal(asset.mimeType, 'image/png');
  const draftImage = await author(asset.url);
  const servedPng = Buffer.from(await draftImage.arrayBuffer());
  assert.equal(servedPng.byteLength, asset.size);
  assert.deepEqual(servedPng.subarray(0, 8), png.subarray(0, 8), 'Private asset lost its PNG signature.');
  await anonymous(asset.url, { status: 404 });

  const nodeId = randomUUID();
  const insert = { kind: 'insertNode', node: { id: nodeId, title: 'Lektion', type: 'TEXT', content: '<p>Version one</p>' }, parentId: null, afterId: null };
  await author(`${route}/authoring`, { method: 'PATCH', status: 428, body: { operation: insert } });
  draft = (await (await author(`${route}/authoring`, { method: 'PATCH', body: { expectedRevision: 0, operation: insert } })).json()).draft;
  assert.equal(draft.revision, 1);
  await author(`${route}/authoring`, { method: 'PATCH', status: 412, body: { expectedRevision: 0, operation: { kind: 'setMetadata', patch: { imageUrl: asset.url } } } });
  draft = (await (await author(`${route}/authoring`, { method: 'PATCH', body: { expectedRevision: 1, operation: { kind: 'setMetadata', patch: { imageUrl: asset.url } } } })).json()).draft;
  assert.equal(draft.revision, 2);
  const reviewPath = (revision, active) => `${route}/authoring/review?expectedRevision=${revision}&expectedActivePublicationId=${active ?? 'null'}`;
  const review = await (await author(reviewPath(2, null))).json();
  assert.equal(review.ready, true, `Publication review blocked: ${JSON.stringify(review.blockers)}`);
  await author(`${route}/authoring/publish`, { method: 'POST', status: 428, body: { expectedRevision: 2, requestId: randomUUID() } });
  const publish = (revision, active) => author(`${route}/authoring/publish`, { method: 'POST',
    body: { expectedRevision: revision, expectedActivePublicationId: active, requestId: randomUUID() } });
  const first = (await (await publish(2, null)).json()).publication;
  assert.equal(first.sequence, 1);
  assert.ok(first.id);
  const publishedCover = await anonymous(asset.url);
  assert.deepEqual(Buffer.from(await publishedCover.arrayBuffer()), servedPng);
  assert.ok((await (await learner('/api/courses')).json()).some(course => course.id === courseId),
    'Published course is missing from the member directory.');
  await learner(`${route}/enrollment`, { method: 'POST', status: 201 });
  let contents = await (await learner(`${route}/contents`)).json();
  assert.equal(contents.length, 1);
  assert.equal(contents[0].id, nodeId);
  assert.equal(contents[0].publicationId, first.id);
  const firstToken = contents[0].contentVersionToken;
  assert.ok(firstToken);
  const progress = (publicationId, contentVersionToken) => learner(`${route}/progress`, {
    method: 'PATCH', body: { contentId: nodeId, completed: true, publicationId, contentVersionToken },
  });
  await progress(first.id, firstToken);
  assert.equal((await (await learner(`${route}/progress`)).json()).complete, true);

  draft = (await (await author(`${route}/authoring`, { method: 'PATCH', body: {
    expectedRevision: 2, operation: { kind: 'updateNode', id: nodeId, patch: { content: '<p>Version two</p>' } },
  } })).json()).draft;
  draft = (await (await author(`${route}/authoring`, { method: 'PATCH', body: {
    expectedRevision: 3, operation: { kind: 'setMetadata', patch: { imageUrl: null } },
  } })).json()).draft;
  assert.equal(draft.revision, 4);
  const second = (await (await publish(4, first.id)).json()).publication;
  assert.equal(second.sequence, 2);
  await anonymous(asset.url, { status: 404 });
  assert.equal((await (await learner(`${route}/progress`)).json()).complete, false,
    'Historical completion must not complete the new publication.');
  await learner(`${route}/progress`, { method: 'PATCH', status: 412,
    body: { contentId: nodeId, completed: true, publicationId: first.id, contentVersionToken: firstToken } });
  contents = await (await learner(`${route}/contents`)).json();
  assert.equal(contents[0].publicationId, second.id);
  assert.notEqual(contents[0].contentVersionToken, firstToken);
  await progress(second.id, contents[0].contentVersionToken);
  assert.equal((await (await learner(`${route}/progress`)).json()).complete, true);
  const pdf = await learner(`${route}/certificate`, { method: 'POST' });
  assert.match(pdf.headers.get('content-type') ?? '', /application\/pdf/);
  assert.ok((await pdf.arrayBuffer()).byteLength > 100);
  const credential = (await database.query('SELECT "publicationId", "courseName", "userId" FROM "Certificate" WHERE "courseId" = $1 AND "userId" = $2',
    [courseId, learnerRegistration.userId])).rows;
  assert.equal(credential.length, 1);
  assert.equal(credential[0].publicationId, second.id, 'Certificate must record the completed publication.');
  assert.equal(credential[0].courseName, privateTitle);
  await learner(`${route}/certificate`, { method: 'POST' });
  assert.equal((await database.query('SELECT COUNT(*)::integer AS count FROM "Certificate" WHERE "courseId" = $1 AND "userId" = $2',
    [courseId, learnerRegistration.userId])).rows[0].count, 1, 'Certificate retry duplicated the credential.');

  draft = (await (await author(`${route}/authoring`, { method: 'PATCH', body: {
    expectedRevision: 4, operation: { kind: 'updateNode', id: nodeId, patch: { content: '<p>Version three</p>' } },
  } })).json()).draft;
  assert.equal(draft.revision, 5);
  const secondToken = contents[0].contentVersionToken;
  const [thirdPublish, racingProgress] = await Promise.all([
    publish(5, second.id),
    learner(`${route}/progress`, { method: 'PATCH', status: [200, 412],
      body: { contentId: nodeId, completed: true, publicationId: second.id, contentVersionToken: secondToken } }),
  ]);
  const third = (await thirdPublish.json()).publication;
  assert.equal(third.sequence, 3);
  assert.ok([200, 412].includes(racingProgress.status));
  assert.equal((await (await learner(`${route}/progress`)).json()).complete, false,
    'Parallel old-version progress must not complete the new publication.');
  assert.equal((await database.query('SELECT "publicationId" FROM "Certificate" WHERE "courseId" = $1 AND "userId" = $2',
    [courseId, learnerRegistration.userId])).rows[0].publicationId, second.id,
  'A later publication must not rewrite certificate provenance.');
  await learner(`${route}/progress`, { method: 'PATCH', status: 412,
    body: { contentId: nodeId, completed: true, publicationId: second.id, contentVersionToken: secondToken } });

  // Force a real SQL error after the publication INSERT, during live content
  // projection. The whole publish transaction must roll back atomically.
  const failureTitle = `Failure target ${randomUUID()}`;
  const failureNodeId = randomUUID();
  draft = (await (await author(`${route}/authoring`, { method: 'PATCH', body: {
    expectedRevision: 5, operation: { kind: 'insertNode', node: { id: failureNodeId,
      title: failureTitle, type: 'TEXT', content: '<p>Should never appear live</p>' }, parentId: null, afterId: nodeId },
  } })).json()).draft;
  draft = (await (await author(`${route}/authoring`, { method: 'PATCH', body: {
    expectedRevision: 6, operation: { kind: 'setMetadata', patch: { title: 'Should not become live' } },
  } })).json()).draft;
  assert.equal(draft.revision, 7);
  const before = (await database.query('SELECT "title", "activePublicationId" FROM "Course" WHERE "id" = $1', [courseId])).rows[0];
  const countBefore = (await database.query('SELECT COUNT(*)::integer AS count FROM "CoursePublication" WHERE "courseId" = $1', [courseId])).rows[0].count;
  await database.query(`CREATE FUNCTION smoke_fail_content() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."title" = '${failureTitle}' THEN RAISE EXCEPTION 'injected publication failure'; END IF; RETURN NEW; END; $$`);
  await database.query('CREATE TRIGGER smoke_fail_content BEFORE INSERT OR UPDATE ON "CourseContent" FOR EACH ROW EXECUTE FUNCTION smoke_fail_content()');
  await author(`${route}/authoring/publish`, { method: 'POST', status: 500,
    body: { expectedRevision: 7, expectedActivePublicationId: third.id, requestId: randomUUID() } });
  const after = (await database.query('SELECT "title", "activePublicationId" FROM "Course" WHERE "id" = $1', [courseId])).rows[0];
  assert.deepEqual(after, before, 'Failed publish changed the live course or active pointer.');
  assert.equal((await database.query('SELECT COUNT(*)::integer AS count FROM "CoursePublication" WHERE "courseId" = $1', [courseId])).rows[0].count,
    countBefore, 'Failed publish left a publication history row.');
  assert.equal((await database.query('SELECT COUNT(*)::integer AS count FROM "CourseContent" WHERE "courseId" = $1 AND "id" = $2',
    [courseId, failureNodeId])).rows[0].count, 0, 'Failed publish left live content.');
  assert.equal((await (await author(`${route}/authoring`)).json()).draft.revision, 7,
    'A failed publish must leave the saved draft intact.');
  console.log(`PostgreSQL publication runtime smoke: ${checks} HTTP checks passed in isolated schema ${schema}.`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  if (appLogs) console.error(`Standalone app tail:\n${appLogs.slice(-6_000)}`);
  process.exitCode = 1;
} finally {
  if (app?.pid && app.exitCode === null) {
    app.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => app.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 5_000)),
    ]);
    if (app.exitCode === null) app.kill('SIGKILL');
  }
  await database.end().catch(() => {});
  if (assetRoot) await rm(assetRoot, { recursive: true, force: true });
  // The schema is left for CI diagnostics. The entire forge_test service is
  // disposable; no other database or schema is ever touched.
}
