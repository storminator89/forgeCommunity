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
  // Make raw SQL rely on explicit schema qualification, rather than an
  // accidentally helpful connection search_path. PrismaPg receives ?schema=
  // separately and must continue to resolve its model queries there.
  // Exercise the production startup gate, including its first retention sweep,
  // rather than bypassing it by launching Next's standalone artifact directly.
  app = spawn(process.execPath, ['scripts/start-standalone.mjs'], { env: {
    ...appEnv, PGOPTIONS: '-c search_path=pg_catalog', PORT: String(selectedPort), HOSTNAME: '127.0.0.1',
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  app.on('error', error => { appError = error; });
  app.stdout.on('data', data => { appLogs = (appLogs + data).slice(-12_000); });
  app.stderr.on('data', data => { appLogs = (appLogs + data).slice(-12_000); });
  await waitForApp(origin);
  const retentionHealth = (await database.query(`SELECT "lastSuccessAt" FROM "${schema}"."PracticeRetentionHealth" WHERE "id" = 'learner'`)).rows[0];
  assert.ok(retentionHealth?.lastSuccessAt && Date.now() - retentionHealth.lastSuccessAt.getTime() < 60_000,
    'Production startup did not complete the initial retention sweep.');

  const anonymous = httpClient(origin);
  const author = httpClient(origin);
  const learner = httpClient(origin);
  const peer = httpClient(origin);
  // The catalogue is available to signed-in community members only. Keep an
  // anonymous negative check and inspect its publication filter as a learner.
  await anonymous('/api/courses', { status: 401 });
  const suffix = randomUUID();
  const password = 'Postgresql-Smoke-Strong-2026!';
  const authorEmail = `lms-author-${suffix}@example.test`;
  const learnerEmail = `lms-learner-${suffix}@example.test`;
  const peerEmail = `lms-peer-${suffix}@example.test`;
  const authorRegistration = await (await anonymous('/api/register', {
    method: 'POST', status: 201, body: { name: 'PG Smoke Author', email: authorEmail, password },
  })).json();
  const learnerRegistration = await (await anonymous('/api/register', {
    method: 'POST', status: 201, body: { name: 'PG Smoke Learner', email: learnerEmail, password },
  })).json();
  const peerRegistration = await (await anonymous('/api/register', {
    method: 'POST', status: 201, body: { name: 'PG Smoke Peer', email: peerEmail, password },
  })).json();
  // Practice authoring is staff-only. Promote only this just-created CI account
  // inside the isolated schema before its first credential session is issued.
  await database.query(`UPDATE "${schema}"."User" SET "role" = 'INSTRUCTOR' WHERE "id" = $1`, [authorRegistration.userId]);
  await login(author, origin, authorEmail, password);
  await login(learner, origin, learnerEmail, password);
  await login(peer, origin, peerEmail, password);
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
  // A separate, synthetic formative pool must be usable by an authenticated
  // learner without writing credential progress, grades, certificates or rewards.
  const practice = `${route}/practice`;
  const learnerPractice = `${practice}/learner`;
  const credentialState = async () => (await database.query(`SELECT
    (SELECT COUNT(*)::integer FROM "${schema}"."QuizAttempt" WHERE "userId" = $1 AND "courseId" = $2) AS "quizAttempts",
    (SELECT COUNT(*)::integer FROM "${schema}"."AssignmentSubmission" WHERE "userId" = $1 AND "courseId" = $2) AS "assignments",
    (SELECT COUNT(*)::integer FROM "${schema}"."CourseContentProgress" WHERE "userId" = $1 AND "courseId" = $2) AS "progress",
    (SELECT COUNT(*)::integer FROM "${schema}"."Certificate" WHERE "userId" = $1 AND "courseId" = $2) AS "certificates",
    (SELECT COUNT(*)::integer FROM "${schema}"."RewardLedger" WHERE "userId" = $1) AS "rewards",
    (SELECT "completedAt" FROM "${schema}"."Enrollment" WHERE "userId" = $1 AND "courseId" = $2) AS "completedAt"`,
  [learnerRegistration.userId, courseId])).rows[0];
  const beforePractice = await credentialState();
  assert.deepEqual(beforePractice, { quizAttempts: 0, assignments: 0, progress: 0,
    certificates: 0, rewards: 0, completedAt: null });
  await anonymous(learnerPractice, { status: 401 });
  await peer(learnerPractice, { status: 403 });
  assert.equal((await (await learner(learnerPractice)).json()).status, 'off');
  const objective = await (await author('/api/courses/practice/objectives', { method: 'POST', status: 201,
    body: { title: 'Disposable PG recall' },
  })).json();
  const item = await (await author(`/api/courses/practice/objectives/${objective.id}/items`, { method: 'POST', status: 201,
    body: { choice: { type: 'SINGLE_CHOICE', prompt: 'Which synthetic answer is correct?',
      options: ['First', 'Second'], correctIndex: 1, explanation: 'Only the second synthetic answer is correct.' } },
  })).json();
  const practiceDraft = (await (await author(`${practice}/authoring`, { method: 'PATCH', body: {
    expectedRevision: 0, items: [{ objectiveId: objective.id, objectiveRevision: objective.revision,
      itemId: item.id, itemRevision: item.latestRevision }],
  } })).json()).draft;
  assert.equal(practiceDraft.revision, 1);
  const practiceSnapshot = (await (await author(`${practice}/authoring/publish`, { method: 'POST', body: {
    expectedRevision: 1, expectedActivePublicationId: first.id, requestId: randomUUID(),
  } })).json()).snapshot;
  assert.equal(practiceSnapshot.coursePublicationId, first.id);
  assert.equal((await (await learner(learnerPractice)).json()).status, 'available');
  await learner(`${learnerPractice}/start`, { method: 'POST', status: 409 });
  await learner(`${learnerPractice}/opt-in`, { method: 'POST' });
  const readyPractice = await (await learner(learnerPractice)).json();
  assert.equal(readyPractice.status, 'ready');
  assert.equal(readyPractice.availability, 'ready');
  assert.equal(readyPractice.dueCount, 1);
  assert.equal(readyPractice.nextAvailableAt, null);
  const startedPractice = await (await learner(`${learnerPractice}/start`, { method: 'POST' })).json();
  assert.equal(startedPractice.pending.item.itemId, item.id);
  await learner(`${learnerPractice}/close`, { method: 'POST', status: 409, body: { sessionId: startedPractice.sessionId } });
  await learner(`${learnerPractice}/close`, { method: 'POST', status: 403, headers: { origin: 'https://hostile.example' }, body: { sessionId: startedPractice.sessionId } });
  assert.deepEqual(startedPractice.pending.item.options, ['First', 'Second']);
  assert.ok(!JSON.stringify(startedPractice).includes('correctIndex') &&
    !JSON.stringify(startedPractice).includes('Only the second synthetic answer'), 'Reservation exposed the answer key.');
  assert.equal((await (await learner(`${learnerPractice}/start`, { method: 'POST' })).json()).pending.reservationId,
    startedPractice.pending.reservationId, 'Start retry created a second reservation.');
  await peer(`${route}/enrollment`, { method: 'POST', status: 201 });
  assert.equal((await (await peer(learnerPractice)).json()).status, 'available', 'Another account inherited learner opt-in.');
  await peer(`${learnerPractice}/opt-in`, { method: 'POST' });
  const peerView = await (await peer(learnerPractice)).json();
  assert.equal(peerView.status, 'ready');
  assert.ok(!JSON.stringify(peerView).includes(startedPractice.sessionId) &&
    !JSON.stringify(peerView).includes(startedPractice.pending.reservationId), 'Another account saw private practice state.');
  await peer(`${learnerPractice}/close`, { method: 'POST', status: 404, body: { sessionId: startedPractice.sessionId } });
  await peer(`${learnerPractice}/next`, { method: 'POST', status: 404, body: { sessionId: startedPractice.sessionId } });
  const practiceAnswer = { sessionId: startedPractice.sessionId,
    reservationId: startedPractice.pending.reservationId, submissionId: randomUUID(), optionIndex: 1, confidence: 'SURE' };
  await peer(`${learnerPractice}/answer`, { method: 'POST', status: 404, body: practiceAnswer });
  const answeredPractice = await (await learner(`${learnerPractice}/answer`, { method: 'POST', body: practiceAnswer })).json();
  assert.deepEqual({ correct: answeredPractice.correct, correctIndex: answeredPractice.correctIndex,
    answeredCount: answeredPractice.answeredCount, replay: answeredPractice.replay },
  { correct: true, correctIndex: 1, answeredCount: 1, replay: false });
  const replayedPractice = await (await learner(`${learnerPractice}/answer`, { method: 'POST', body: practiceAnswer })).json();
  assert.equal(replayedPractice.replay, true);
  assert.equal(replayedPractice.nextDueAt, answeredPractice.nextDueAt);
  assert.ok(!JSON.stringify(await (await peer(learnerPractice)).json()).includes(startedPractice.sessionId),
    'Another account saw answered practice history.');
  await learner(`${learnerPractice}/answer`, { method: 'POST', status: 409,
    body: { ...practiceAnswer, optionIndex: 0 } });
  await learner(`${learnerPractice}/answer`, { method: 'POST', status: 409,
    body: { ...practiceAnswer, submissionId: randomUUID() } });
  assert.equal((await database.query(`SELECT COUNT(*)::integer AS count FROM "${schema}"."PracticeLearnerAnswer" a
    JOIN "${schema}"."PracticeLearnerReservation" r ON r."id" = a."reservationId"
    WHERE r."sessionId" = $1`, [startedPractice.sessionId])).rows[0].count, 1,
  'Replay or conflict duplicated the private answer.');
  assert.deepEqual(await credentialState(), beforePractice, 'Formative answer changed credential state.');
  const privateReadEvidence = async () => (await database.query(`SELECT
    (SELECT row_to_json(s) FROM "${schema}"."PracticeLearnerSetting" s WHERE "userId" = $1 AND "courseId" = $2) AS setting,
    (SELECT COUNT(*)::integer FROM "${schema}"."PracticeLearnerSession" WHERE "userId" = $1 AND "courseId" = $2) AS sessions,
    (SELECT COUNT(*)::integer FROM "${schema}"."PracticeLearnerReservation" WHERE "sessionId" = $3) AS reservations`,
  [learnerRegistration.userId, courseId, startedPractice.sessionId])).rows[0];
  // The one-item disposable pool's wrong/short raw due window must still obey
  // the unchanged inclusive last-two/24h exclusion, in the real PG HTTP path.
  const shortDue = new Date(Date.now() + 5 * 60_000);
  await database.query(`UPDATE "${schema}"."PracticeLearnerSchedule" SET "dueAt" = $1 WHERE "userId" = $2 AND "courseId" = $3`,
    [shortDue, learnerRegistration.userId, courseId]);
  const shownAt = (await database.query(`SELECT "shownAt" FROM "${schema}"."PracticeLearnerReservation" WHERE "id" = $1`,
    [startedPractice.pending.reservationId])).rows[0].shownAt;
  await learner(`${learnerPractice}/close`, { method: 'POST', body: { sessionId: startedPractice.sessionId } });
  await learner(`${learnerPractice}/close`, { method: 'POST', body: { sessionId: startedPractice.sessionId } });
  const beforeRead = await privateReadEvidence();
  const waitingPractice = await (await learner(learnerPractice)).json();
  assert.equal(waitingPractice.availability, 'waiting');
  assert.equal(waitingPractice.dueCount, 0);
  assert.equal(waitingPractice.nextAvailableAt, new Date(shownAt.getTime() + 86400_000 + 1).toISOString());
  assert.ok(!waitingPractice.session && !JSON.stringify(waitingPractice).includes('correctIndex'));
  await learner(learnerPractice);
  assert.deepEqual(await privateReadEvidence(), beforeRead, 'Practice GET changed settings/activity or reserved a question.');
  const healthBefore = (await database.query(`SELECT "lastSuccessAt" FROM "${schema}"."PracticeRetentionHealth" WHERE "id" = 'learner'`)).rows[0].lastSuccessAt;
  for (const offset of [-46 * 60_000, 6 * 60_000]) {
    await database.query(`UPDATE "${schema}"."PracticeRetentionHealth" SET "lastSuccessAt" = $1 WHERE "id" = 'learner'`, [new Date(Date.now() + offset)]);
    const unavailablePractice = await (await learner(learnerPractice)).json();
    assert.equal(unavailablePractice.status, 'unavailable');
    assert.equal(unavailablePractice.dueCount, 0);
    assert.equal(unavailablePractice.nextAvailableAt, null);
    assert.ok(!unavailablePractice.session);
  }
  await database.query(`UPDATE "${schema}"."PracticeRetentionHealth" SET "lastSuccessAt" = $1 WHERE "id" = 'learner'`, [healthBefore]);

  const resetToken = (await (await learner(`${learnerPractice}/reset/prepare`, { method: 'POST' })).json()).token;
  await learner(`${learnerPractice}/reset`, { method: 'POST', status: 428,
    body: { token: resetToken, confirmation: 'no' } });
  await learner(`${learnerPractice}/reset`, { method: 'POST', body: {
    token: resetToken, confirmation: 'RESET_MY_PRACTICE',
  } });
  await learner(`${learnerPractice}/reset`, { method: 'POST', status: 409, body: {
    token: resetToken, confirmation: 'RESET_MY_PRACTICE',
  } });
  assert.equal((await (await learner(learnerPractice)).json()).status, 'available');
  assert.equal((await database.query(`SELECT COUNT(*)::integer AS count FROM "${schema}"."PracticeLearnerSetting"
    WHERE "userId" = $1 AND "courseId" = $2`, [learnerRegistration.userId, courseId])).rows[0].count, 0,
  'Reset left learner-private state behind.');
  const resetChildren = (await database.query(`SELECT
    (SELECT COUNT(*)::integer FROM "${schema}"."PracticeLearnerSession" WHERE "id" = $1) AS "sessions",
    (SELECT COUNT(*)::integer FROM "${schema}"."PracticeLearnerReservation" WHERE "sessionId" = $1) AS "reservations",
    (SELECT COUNT(*)::integer FROM "${schema}"."PracticeLearnerSubmissionReceipt" WHERE "sessionId" = $1) AS "receipts",
    (SELECT COUNT(*)::integer FROM "${schema}"."PracticeLearnerSchedule" WHERE "userId" = $2 AND "courseId" = $3) AS "schedules"`,
  [startedPractice.sessionId, learnerRegistration.userId, courseId])).rows[0];
  assert.deepEqual(resetChildren, { sessions: 0, reservations: 0, receipts: 0, schedules: 0 },
    'Reset left learner-private child rows behind.');
  assert.equal((await database.query(`SELECT COUNT(*)::integer AS count FROM "${schema}"."PracticeLearnerSetting"
    WHERE "userId" = $1 AND "courseId" = $2 AND "optedIn"`, [peerRegistration.userId, courseId])).rows[0].count, 1,
  'Reset changed another account’s opt-in.');
  assert.deepEqual(await credentialState(), beforePractice, 'Formative reset changed credential state.');
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
  // One private, bounded text-assignment journey through production PG HTTP.
  // Use synthetic text only; no learner answer is printed to logs or artifacts.
  const assignmentForm = new FormData();
  assignmentForm.set('title', `Assignment smoke ${randomUUID()}`);
  assignmentForm.set('description', 'Manual grading runtime check');
  const assignmentCourse = await (await author('/api/courses', { method: 'POST', status: 201, body: assignmentForm })).json();
  const assignmentRoute = `/api/courses/${assignmentCourse.id}`;
  const assignmentNodeId = randomUUID();
  const assignmentDraft = await (await author(`${assignmentRoute}/authoring`, { method: 'PATCH', body: {
    expectedRevision: 0, operation: { kind: 'insertNode', node: { id: assignmentNodeId, title: 'Written task', type: 'ASSIGNMENT',
      content: JSON.stringify({ prompt: 'Explain a simple idea.', passingScore: 70 }) }, parentId: null, afterId: null },
  } })).json();
  assert.equal(assignmentDraft.draft.revision, 1);
  assert.equal((await (await author(`${assignmentRoute}/authoring/review?expectedRevision=1&expectedActivePublicationId=null`)).json()).ready, true);
  const assignmentPublication = (await (await author(`${assignmentRoute}/authoring/publish`, { method: 'POST', body: {
    expectedRevision: 1, expectedActivePublicationId: null, requestId: randomUUID(),
  } })).json()).publication;
  await learner(`${assignmentRoute}/enrollment`, { method: 'POST', status: 201 });
  const assignmentContent = (await (await learner(`${assignmentRoute}/contents`)).json())[0];
  assert.equal(assignmentContent.id, assignmentNodeId);
  await learner(`${assignmentRoute}/progress`, { method: 'PATCH', status: 409, body: {
    contentId: assignmentNodeId, completed: true, publicationId: assignmentPublication.id,
    contentVersionToken: assignmentContent.contentVersionToken,
  } });
  const ownAssignmentRoute = `${assignmentRoute}/contents/${assignmentNodeId}/assignment`;
  assert.equal((await (await learner(ownAssignmentRoute)).json()).maySubmit, true);
  const submitted = await (await learner(ownAssignmentRoute, { method: 'POST', status: 201, body: {
    requestId: randomUUID(), response: 'Synthetic PG smoke answer', publicationId: assignmentPublication.id,
    contentVersionToken: assignmentContent.contentVersionToken,
  } })).json();
  assert.ok(submitted.id);
  assert.equal((await (await learner(`${assignmentRoute}/progress`)).json()).complete, false);
  const queue = await (await author(`${assignmentRoute}/assignments`)).json();
  assert.deepEqual(queue.submissions.map(row => row.id), [submitted.id]);
  const pendingAnalytics = await (await author(`${assignmentRoute}/analytics`)).json();
  assert.equal(pendingAnalytics.learners[0].currentStatus, 'in-progress');
  assert.ok(!JSON.stringify(pendingAnalytics).includes('Synthetic PG smoke answer'), 'Analytics exposed a private response.');
  const gradeRoute = `${assignmentRoute}/assignments/${submitted.id}/grade`;
  const graded = await (await author(gradeRoute, { method: 'POST', body: {
    requestId: randomUUID(), expectedDecisionId: null, action: 'GRADED', score: 85, feedback: 'Synthetic review',
  } })).json();
  assert.equal(graded.decision.passed, true);
  assert.equal((await (await learner(`${assignmentRoute}/progress`)).json()).complete, true);
  const authorCourses = async () => (await (await author(`/api/users/${authorRegistration.userId}/courses`)).json()).courses;
  const learnerEnrollments = async () => (await (await learner(`/api/users/${learnerRegistration.userId}/enrollments`)).json()).courses;
  const assertNoPublicCompletionRates = async () => {
    const course = (await authorCourses()).find(row => row.id === assignmentCourse.id);
    assert.ok(course, 'Published assignment course must remain discoverable on the author profile.');
    assert.equal(course.stats.enrollments, 1, 'Public enrollment count must remain available.');
    assert.equal(Object.hasOwn(course.stats, 'completionRate'), false, 'Public profile exposed current completion.');
    assert.equal(Object.hasOwn(course.stats, 'everCompletionRate'), false, 'Public profile exposed historical completion.');
  };
  const learnerCompletionRate = async () => (await learnerEnrollments())
    .find(course => course.id === assignmentCourse.id)?.stats.completionRate;
  assert.equal((await (await author(`${assignmentRoute}/analytics`)).json()).summary.currentComplete, 1);
  await assertNoPublicCompletionRates();
  assert.equal(await learnerCompletionRate(), 100, 'Private learner enrollments must project current assignment completion.');
  const goalRoute = '/api/learning-goals/me';
  const startedGoal = await (await learner(goalRoute, { method: 'POST', status: 201,
    body: { targetLeaves: 1, durationDays: 7, timezone: 'UTC' },
  })).json();
  assert.equal(startedGoal.goal.completedLeaves, 0, 'A pass before goal opt-in must not count.');
  const stillPassing = await (await author(gradeRoute, { method: 'POST', body: {
    requestId: randomUUID(), expectedDecisionId: graded.decision.id, action: 'GRADED', score: 90,
    feedback: 'Synthetic corrected feedback',
  } })).json();
  assert.equal(stillPassing.decision.passed, true);
  assert.equal((await (await learner(goalRoute)).json()).goal.completedLeaves, 0,
    'A passing correction must retain the pre-goal completion time.');
  const corrected = await (await author(gradeRoute, { method: 'POST', body: {
    requestId: randomUUID(), expectedDecisionId: stillPassing.decision.id, action: 'GRADED', score: 40,
  } })).json();
  assert.equal(corrected.decision.passed, false);
  assert.equal((await (await learner(`${assignmentRoute}/progress`)).json()).complete, false);
  assert.equal((await (await learner(goalRoute)).json()).goal.completedLeaves, 0);
  assert.equal((await (await author(`${assignmentRoute}/analytics`)).json()).summary.currentComplete, 0);
  await assertNoPublicCompletionRates();
  assert.equal(await learnerCompletionRate(), 0, 'A failing correction must revoke private current completion.');
  const repassed = await (await author(gradeRoute, { method: 'POST', body: {
    requestId: randomUUID(), expectedDecisionId: corrected.decision.id, action: 'GRADED', score: 85,
  } })).json();
  assert.equal(repassed.decision.passed, true);
  assert.equal((await (await learner(goalRoute)).json()).goal.completedLeaves, 1,
    'A new pass after failure must begin a new goal-counting interval.');
  assert.equal((await (await learner(`${assignmentRoute}/progress`)).json()).complete, true);
  assert.equal((await (await author(`${assignmentRoute}/analytics`)).json()).summary.currentComplete, 1);
  await assertNoPublicCompletionRates();
  assert.equal(await learnerCompletionRate(), 100, 'Repassing must restore private current completion.');

  // Exercise the actual PostgreSQL adapter with a published dependency, not
  // just schema parity. An author token must not bypass the learner's lock.
  const pathForm = new FormData();
  pathForm.set('title', `PG path ${randomUUID()}`);
  pathForm.set('description', 'Disposable prerequisite runtime check');
  const pathCourse = (await (await author('/api/courses', { method: 'POST', status: 201, body: pathForm })).json()).id;
  const pathRoute = `/api/courses/${pathCourse}`;
  const pathFirst = randomUUID();
  const pathLast = randomUUID();
  for (const [revision, operation] of [
    [0, { kind: 'insertNode', node: { id: pathFirst, title: 'First step', type: 'TEXT', content: '<p>Public first step</p>' }, parentId: null, afterId: null }],
    [1, { kind: 'insertNode', node: { id: pathLast, title: 'Last step', type: 'TEXT', content: '<p>Protected last step</p>' }, parentId: null, afterId: pathFirst }],
    [2, { kind: 'setPrerequisites', id: pathLast, prerequisiteIds: [pathFirst] }],
  ]) await author(`${pathRoute}/authoring`, { method: 'PATCH', body: { expectedRevision: revision, operation } });
  const pathReview = await (await author(`${pathRoute}/authoring/review?expectedRevision=3&expectedActivePublicationId=null`)).json();
  assert.equal(pathReview.ready, true, `PG path review blocked: ${JSON.stringify(pathReview.blockers)}`);
  const pathPublication = (await (await author(`${pathRoute}/authoring/publish`, {
    method: 'POST', body: { expectedRevision: 3, expectedActivePublicationId: null, requestId: randomUUID() },
  })).json()).publication.id;
  await learner(`${pathRoute}/enrollment`, { method: 'POST', status: 201 });
  const authorPath = await (await author(`${pathRoute}/contents`)).json();
  let learnerPath = await (await learner(`${pathRoute}/contents`)).json();
  assert.equal(learnerPath[1].locked, true);
  assert.equal(learnerPath[1].content, '');
  assert.equal(learnerPath[1].contentVersionToken, null);
  assert.ok(!JSON.stringify(learnerPath).includes('<p>Protected last step</p>'));
  const pathProgress = (contentId, contentVersionToken, status = 200) => learner(`${pathRoute}/progress`, {
    method: 'PATCH', status, body: { contentId, completed: true, publicationId: pathPublication, contentVersionToken },
  });
  // Q&A context follows the same CURRENT learner proof on real PostgreSQL HTTP.
  // Staff discussion authority does not grant a preview bypass for labels.
  const pathQa = `${pathRoute}/qa`;
  const firstPair = { publicationId: pathPublication, contentId: pathFirst };
  const lastPair = { publicationId: pathPublication, contentId: pathLast };
  const qaInput = { title: 'Synthetic path question', body: 'How should this synthetic step work?',
    requestId: randomUUID(), lessonContext: firstPair };
  const qaJson = async (client, path, options) => {
    const response = await client(path, options);
    assert.equal(response.headers.get('cache-control'), 'private, no-store', `Q&A cache policy: ${path}`);
    return response.json();
  };
  const scopePath = pair => `${pathQa}?${new URLSearchParams(pair)}`;
  await anonymous(pathQa, { status: 401 });
  await peer(pathQa, { status: 403 });
  await learner(pathQa, { method: 'POST', status: 423, body: { ...qaInput, lessonContext: lastPair } });
  assert.deepEqual((await qaJson(author, scopePath(lastPair))).scope,
    { kind: 'lesson', lessonContext: { status: 'unavailable' } });
  const duplicateQuestions = await Promise.all([1, 2].map(() => qaJson(learner, pathQa, {
    method: 'POST', status: [200, 201], body: qaInput,
  })));
  assert.equal(duplicateQuestions[0].question.id, duplicateQuestions[1].question.id);
  assert.deepEqual(duplicateQuestions.map(row => row.created).sort(), [false, true]);
  const pathQuestion = duplicateQuestions[0].question;
  assert.deepEqual(pathQuestion.lessonContext, { status: 'current', ...firstPair,
    title: 'First step', href: `/courses/${pathCourse}/contents?content=${pathFirst}` });
  assert.ok(!JSON.stringify(pathQuestion).includes('<p>Public first step</p>'));
  await learner(pathQa, { method: 'POST', status: 409, body: { ...qaInput, lessonContext: null } });
  await learner(pathQa, { method: 'POST', status: 400, body: { ...qaInput, lessonContext: { ...firstPair, title: 'Injected' } } });
  const legacyQaInput = { ...qaInput, requestId: randomUUID(), lessonContext: null };
  const legacyQuestion = (await qaJson(learner, pathQa, { method: 'POST', status: 201, body: legacyQaInput })).question;
  assert.equal(legacyQuestion.lessonContext, null);
  assert.equal((await qaJson(learner, scopePath(firstPair))).items.length, 1);
  assert.equal((await qaJson(learner, pathQa)).items.length, 2);
  await peer(`${pathRoute}/enrollment`, { method: 'POST', status: 201 });
  const qaReply = (await qaJson(peer, `${pathQa}/${pathQuestion.id}/answers`, { method: 'POST', status: 201,
    body: { body: 'Synthetic peer explanation.', requestId: randomUUID() } })).answer;
  const otherReply = (await qaJson(author, `${pathQa}/${pathQuestion.id}/answers`, { method: 'POST', status: 201,
    body: { body: 'Synthetic instructor explanation.', requestId: randomUUID() } })).answer;
  const solutionRace = await Promise.all([qaReply, otherReply].map(answer => qaJson(author,
    `${pathQa}/${pathQuestion.id}/solution`, { method: 'PUT', status: [200, 409], body: { answerId: answer.id, expectedRevision: null } })));
  assert.equal(solutionRace.filter(result => result.acceptedAnswerId).length, 1, 'Q&A chosen-answer CAS did not select exactly one winner.');
  const chosen = solutionRace.find(result => result.acceptedAnswerId);
  const anchoredStored = (await database.query(`SELECT "contextPublicationId", "contextContentId" FROM "${schema}"."CourseQuestion" WHERE "id"=$1`, [pathQuestion.id])).rows[0];
  assert.deepEqual(anchoredStored, { contextPublicationId: pathPublication, contextContentId: pathFirst });
  assert.equal((await database.query(`SELECT COUNT(*)::integer AS n FROM "${schema}"."CourseQuestion" WHERE "courseId"=$1`, [pathCourse])).rows[0].n, 2);
  await pathProgress(pathLast, authorPath[1].contentVersionToken, 423);
  await pathProgress(pathFirst, learnerPath[0].contentVersionToken);
  learnerPath = await (await learner(`${pathRoute}/contents`)).json();
  assert.equal(learnerPath[1].locked, false);
  assert.equal(learnerPath[1].content, '<p>Protected last step</p>');
  await pathProgress(pathLast, learnerPath[1].contentVersionToken);
  assert.equal((await (await learner(`${pathRoute}/progress`)).json()).complete, true);
  // Lock/republish keeps the conversation and original chosen answer, with no old
  // title, identity or link in context. Lost-response retry keeps its exact pair.
  await author(`${pathRoute}/authoring`, { method: 'PATCH', body: { expectedRevision: 3,
    operation: { kind: 'updateNode', id: pathFirst, patch: { title: 'Revised first step', content: '<p>Revised private body</p>' } } } });
  await author(`${pathRoute}/authoring`, { method: 'PATCH', body: { expectedRevision: 4,
    operation: { kind: 'setReleaseOn', id: pathFirst, releaseOn: '2099-01-01' } } });
  const contextPublishInput = { expectedRevision: 5, expectedActivePublicationId: pathPublication, requestId: randomUUID() };
  const contextRace = await Promise.all([
    qaJson(learner, pathQa, { method: 'POST', status: [201, 412, 409], body: { ...qaInput, requestId: randomUUID() } }),
    author(`${pathRoute}/authoring/publish`, { method: 'POST', body: contextPublishInput }).then(response => response.json()),
  ]);
  const nextPathPublication = contextRace[1].publication.id;
  const replayAfterPublish = await qaJson(learner, pathQa, { method: 'POST', status: 200, body: qaInput });
  assert.equal(replayAfterPublish.created, false);
  assert.equal(replayAfterPublish.question.id, pathQuestion.id);
  assert.deepEqual(replayAfterPublish.question.lessonContext, { status: 'unavailable' });
  const retainedQa = await qaJson(learner, `${pathQa}/revalidate`, { method: 'POST', body: {
    ids: [pathQuestion.id, legacyQuestion.id], filter: 'all', q: '', lessonContext: null,
  } });
  assert.deepEqual(new Map(retainedQa.contexts.map(row => [row.id, row.lessonContext])),
    new Map([[pathQuestion.id, { status: 'unavailable' }], [legacyQuestion.id, null]]));
  assert.equal(Object.hasOwn(retainedQa, 'items'), false);
  for (const forbidden of [pathFirst, pathPublication, 'First step', 'Revised first step', 'href', '<p>']) {
    assert.ok(!JSON.stringify(retainedQa).includes(forbidden), `Retained Q&A probe exposed ${forbidden}`);
  }
  const oldQuestionDetail = await qaJson(learner, `${pathQa}/${pathQuestion.id}`);
  assert.equal(oldQuestionDetail.question.acceptedAnswerId, chosen.acceptedAnswerId);
  assert.equal(oldQuestionDetail.question.revision, chosen.revision);
  assert.equal(oldQuestionDetail.answers.length, 2);
  assert.equal((await qaJson(learner, scopePath({ publicationId: nextPathPublication, contentId: pathFirst }))).items.length, 0);
  await learner(pathQa, { method: 'POST', status: 423, body: { ...qaInput, requestId: randomUUID(),
    lessonContext: { publicationId: nextPathPublication, contentId: pathFirst } } });
  await learner(pathQa, { method: 'POST', status: 412, body: { ...qaInput, requestId: randomUUID() } });
  await learner(pathQa, { method: 'POST', status: 409, body: { ...qaInput,
    lessonContext: { publicationId: nextPathPublication, contentId: pathFirst } } });
  // A separate readable leaf exercises a real fresh-create/removal publication race.
  const removableLeaf = randomUUID();
  await author(`${pathRoute}/authoring`, { method: 'PATCH', body: { expectedRevision: 5, operation: {
    kind: 'insertNode', node: { id: removableLeaf, title: 'Disposable readable leaf', type: 'TEXT', content: '<p>Temporary current content</p>' },
    parentId: null, afterId: pathLast,
  } } });
  const removalBase = (await (await author(`${pathRoute}/authoring/publish`, { method: 'POST', body: {
    expectedRevision: 6, expectedActivePublicationId: nextPathPublication, requestId: randomUUID(),
  } })).json()).publication.id;
  await author(`${pathRoute}/authoring`, { method: 'PATCH', body: { expectedRevision: 6,
    operation: { kind: 'deleteNode', id: removableLeaf } } });
  const removeInput = { ...qaInput, requestId: randomUUID(), lessonContext: { publicationId: removalBase, contentId: removableLeaf } };
  const removedRace = await Promise.all([
    qaJson(learner, pathQa, { method: 'POST', status: [201, 412, 409], body: removeInput }),
    author(`${pathRoute}/authoring/publish`, { method: 'POST', body: {
      expectedRevision: 7, expectedActivePublicationId: removalBase, requestId: randomUUID(),
    } }).then(response => response.json()),
  ]);
  if (removedRace[0].question) {
    assert.deepEqual((await qaJson(learner, `${pathQa}/${removedRace[0].question.id}`)).question.lessonContext, { status: 'unavailable' });
    assert.equal((await qaJson(learner, pathQa, { method: 'POST', status: 200, body: removeInput })).created, false);
  } else await learner(pathQa, { method: 'POST', status: 412, body: removeInput });
  // A concurrent withdrawal and a fresh question must serialize before or after
  // access loss; once withdrawal returns, neither replay nor read may succeed.
  await Promise.all([
    peer(pathQa, { method: 'POST', status: [201, 403, 409], body: { ...legacyQaInput, requestId: randomUUID() } }),
    peer(`${pathRoute}/enrollment`, { method: 'DELETE' }),
  ]);
  await peer(pathQa, { method: 'POST', status: 403, body: qaInput });
  await peer(pathQa, { status: 403 });
  await peer(`${pathRoute}/enrollment`, { method: 'POST', status: 201 });
  assert.deepEqual((await qaJson(peer, `${pathQa}/${pathQuestion.id}`)).question.lessonContext, { status: 'unavailable' });


  // Exercise the pathway HTTP routes against the real PostgreSQL adapter. The
  // two approved quiz courses and administrator are synthetic and live only in
  // this disposable schema; production-style POST must take the qualified
  // Course row lock before sealing the definition.
  const quiz = JSON.stringify({ passingScore: 70, questions: [{ id: 'q1', type: 'SINGLE_CHOICE',
    question: 'Synthetic question?', options: ['Yes', 'No'], correctAnswers: [0] }] });
  async function makePathwayCourse(number) {
    const form = new FormData();
    form.set('title', `PG verified pathway ${number} ${randomUUID()}`);
    form.set('description', 'Disposable approved quiz course');
    const course = (await (await author('/api/courses', { method: 'POST', status: 201, body: form })).json()).id;
    const courseRoute = `/api/courses/${course}`;
    const node = randomUUID();
    const draft = (await (await author(`${courseRoute}/authoring`, { method: 'PATCH', body: {
      expectedRevision: 0, operation: { kind: 'insertNode', node: {
        id: node, title: 'Verified quiz', type: 'QUIZ', content: quiz,
      }, parentId: null, afterId: null },
    } })).json()).draft;
    assert.equal(draft.revision, 1);
    const review = await (await author(`${courseRoute}/authoring/review?expectedRevision=1&expectedActivePublicationId=null`)).json();
    assert.equal(review.ready, true, `Pathway quiz publication blocked: ${JSON.stringify(review.blockers)}`);
    const publication = (await (await author(`${courseRoute}/authoring/publish`, { method: 'POST', body: {
      expectedRevision: 1, expectedActivePublicationId: null, requestId: randomUUID(),
    } })).json()).publication;
    assert.ok(publication.id);
    return course;
  }
  const verifiedCourses = [await makePathwayCourse(1), await makePathwayCourse(2)];
  await database.query(`UPDATE "${schema}"."User" SET "role" = 'ADMIN' WHERE "id" = $1`, [authorRegistration.userId]);
  const admin = httpClient(origin);
  await login(admin, origin, authorEmail, password);
  for (const id of verifiedCourses) {
    await admin(`/api/admin/courses/${id}/reward-eligibility`, { method: 'PATCH', body: { eligible: true } });
  }

  // The inspection connection is restrictive too. All SQL assertions below
  // name the ephemeral schema; the app itself has had pg_catalog search_path
  // for the entire HTTP journey above.
  await database.query('SET search_path TO pg_catalog');
  assert.equal((await database.query('SHOW search_path')).rows[0].search_path, 'pg_catalog');
  const pathwayId = randomUUID();
  const definition = { requestId: pathwayId, title: 'Synthetic verified sequence',
    description: 'Two current approved courses', badgeLabel: 'Synthetic pathway complete', courseIds: verifiedCourses };
  const adminPath = '/api/admin/learning-pathways';
  const participationPath = `/api/learning-pathways/${pathwayId}/participation`;
  const hostileOrigin = { origin: 'https://cross-site.invalid' };
  const participationRow = () => database.query(`SELECT "optedOutAt", "badgeActive" FROM "${schema}"."LearningPathwayParticipation"
    WHERE "userId" = $1 AND "pathwayId" = $2`, [learnerRegistration.userId, pathwayId]);
  await anonymous(adminPath, { status: 401 });
  await learner(adminPath, { status: 403 });
  await anonymous('/api/learning-pathways/me', { status: 401 });
  await admin('/api/learning-pathways/me', { status: 403 });
  await admin(adminPath, { method: 'POST', status: 403, headers: hostileOrigin, body: definition });
  assert.equal((await database.query(`SELECT COUNT(*)::integer AS count FROM "${schema}"."LearningPathway"
    WHERE "id" = $1`, [pathwayId])).rows[0].count, 0, 'Cross-origin create wrote a pathway.');
  const createdPathway = await admin(adminPath, { method: 'POST', status: 201, body: definition });
  assert.equal(createdPathway.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await createdPathway.json()).pathway.courses.map(course => course.courseId), verifiedCourses);
  await admin(adminPath, { method: 'POST', status: 200, body: definition });
  await admin(adminPath, { method: 'POST', status: 409, body: { ...definition, title: 'Changed receipt' } });
  const adminList = await (await admin(adminPath)).json();
  assert.ok(adminList.pathways.some(pathway => pathway.id === pathwayId));
  assert.ok(!JSON.stringify(adminList).includes(learnerRegistration.userId), 'Admin definitions exposed participant identity.');

  const beforeJoin = await (await learner('/api/learning-pathways/me')).json();
  assert.equal(beforeJoin.pathways.find(pathway => pathway.id === pathwayId)?.participation, null);
  await learner(participationPath, { method: 'POST', status: 403, headers: hostileOrigin });
  assert.equal((await participationRow()).rows.length, 0, 'Cross-origin join wrote participation.');
  const joined = await learner(participationPath, { method: 'POST', status: 201 });
  assert.equal(joined.headers.get('cache-control'), 'private, no-store');
  assert.equal((await joined.json()).pathway.participation.badgeActive, false);
  const myPathway = (await (await learner('/api/learning-pathways/me')).json()).pathways
    .find(pathway => pathway.id === pathwayId);
  assert.ok(myPathway?.participation?.joinedAt && myPathway.participation.optedOutAt === null);
  assert.equal(myPathway.creditedCount, 0);
  const adminListAfterJoin = JSON.stringify(await (await admin(adminPath)).json());
  assert.ok(!adminListAfterJoin.includes(learnerRegistration.userId) &&
    !adminListAfterJoin.includes('joinedAt') && !adminListAfterJoin.includes('badgeActive'),
  'Admin definition listing disclosed private participation.');
  const profile = await (await admin(`/api/users/${learnerRegistration.userId}`)).json();
  assert.ok(!JSON.stringify(profile).includes(pathwayId) && !JSON.stringify(profile).includes(definition.badgeLabel),
    'Member profile disclosed private pathway participation.');
  await learner(participationPath, { method: 'DELETE', status: 403, headers: hostileOrigin });
  assert.equal((await participationRow()).rows[0].optedOutAt, null, 'Cross-origin opt-out changed participation.');
  const left = (await (await learner(participationPath, { method: 'DELETE' })).json()).pathway;
  assert.ok(left.participation.optedOutAt && !left.participation.badgeActive);
  assert.equal((await participationRow()).rows.length, 1, 'Opt-out erased the audit-bearing participation row.');
  assert.ok((await participationRow()).rows[0].optedOutAt, 'Opt-out was not persisted in the custom schema.');
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
