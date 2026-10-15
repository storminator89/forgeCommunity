import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// This test creates accounts through HTTP, never by seeding the database.
// Local use requires a NEW, initialized /tmp/forge-contributions-smoke-*/forge.db
// (under the platform's actual tmpdir) and its matching running SQLite server:
// DATABASE_PROVIDER=sqlite DATABASE_URL=file:/tmp/forge-contributions-smoke-XXX/forge.db
// SMOKE_SQLITE_FILE=/tmp/forge-contributions-smoke-XXX/forge.db
// SMOKE_BASE_URL=http://127.0.0.1:PORT CONTRIBUTIONS_SMOKE_DISPOSABLE_DB=1
// node scripts/smoke-contributions.mjs
// CI additionally sets CONTRIBUTIONS_SMOKE_CI=1 and CI=true inside its disposable
// SQLite container. That exception accepts only /app/data/forge.db on port 3013.
export function validateTarget(env = process.env) {
  assert.equal(env.CONTRIBUTIONS_SMOKE_DISPOSABLE_DB, '1', 'Explicit CONTRIBUTIONS_SMOKE_DISPOSABLE_DB=1 approval is required');
  assert.equal(env.DATABASE_PROVIDER, 'sqlite', 'Contribution smoke requires DATABASE_PROVIDER=sqlite');
  assert.ok(env.SMOKE_BASE_URL, 'SMOKE_BASE_URL must explicitly select the disposable local server');
  const base = new URL(env.SMOKE_BASE_URL);
  assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) &&
    base.port && base.pathname === '/' && !base.username && !base.password && !base.search && !base.hash,
  'SMOKE_BASE_URL must be a loopback HTTP origin with an explicit port and no credentials, path, query or fragment');
  const file = env.SMOKE_SQLITE_FILE;
  assert.ok(file && isAbsolute(file) && existsSync(file), 'SMOKE_SQLITE_FILE must be an existing absolute SQLite file');
  const sqliteFile = realpathSync(file);
  const configuredFile = env.DATABASE_URL?.startsWith('file:') ? env.DATABASE_URL.slice(5) : '';
  assert.ok(isAbsolute(configuredFile) && !configuredFile.startsWith('//') && !/[%?#]/.test(configuredFile) && existsSync(configuredFile),
    'DATABASE_URL must explicitly select an existing absolute local SQLite file');
  assert.equal(realpathSync(configuredFile), sqliteFile, 'DATABASE_URL and SMOKE_SQLITE_FILE must select the same fixture');
  const ci = env.CONTRIBUTIONS_SMOKE_CI === '1';
  if (ci) {
    assert.equal(env.CI, 'true', 'The disposable Docker exception requires CI=true');
    assert.equal(sqliteFile, '/app/data/forge.db', 'CI smoke is confined to the disposable SQLite container database');
    assert.equal(base.origin, 'http://127.0.0.1:3013', 'CI smoke must run inside the disposable app container');
  } else {
    assert.equal(basename(sqliteFile), 'forge.db', 'Local smoke requires a dedicated forge.db fixture');
    assert.equal(dirname(dirname(sqliteFile)), realpathSync(tmpdir()), 'Local fixture must be directly under the platform temporary directory');
    assert.match(basename(dirname(sqliteFile)), /^forge-contributions-smoke-[A-Za-z0-9_-]+$/, 'Local fixture directory must be dedicated to contribution smoke');
  }
  return { origin: base.origin, sqliteFile, ci };
}

function database(file, action, writable = false) {
  const db = new DatabaseSync(file, { readOnly: !writable });
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
    return action(db);
  } finally { db.close(); }
}

export function privateHeaders(response) {
  // The production proxy can return its own anonymous auth envelope before
  // the route, and transport layers can canonicalize private/Vary headers.
  // no-store alone forbids retention by both private and shared caches. Check
  // that guarantee, while the account-switch assertions check actual isolation.
  const cache = (response.headers.get('cache-control') ?? '').toLowerCase();
  assert.match(cache, /(?:^|,\s*)no-store(?:,|$)/, 'Private response must prohibit storage');
}

function client(origin) {
  const cookies = new Map();
  return async (path, { status = 200, method = 'GET', body, headers = {}, privateResponse = false } = {}) => {
    assert.ok(path.startsWith('/') && !path.startsWith('//'), 'Request must use an app-relative path');
    const url = new URL(path, origin);
    assert.equal(url.origin, origin, 'Smoke requests cannot leave the disposable local origin');
    const response = await fetch(url, {
      method, redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: {
        ...(cookies.size ? { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
        ...(method !== 'GET' ? { origin } : {}),
        ...(body !== undefined && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
    assert.equal(response.status, status, `${method} ${path}: ${(await response.clone().text()).slice(0, 2_000)}`);
    if (privateResponse) privateHeaders(response);
    assert.match(response.headers.get('content-type') ?? '', /^application\/json/, `${method} ${path} must return JSON`);
    return response.json();
  };
}

export async function runSmoke(env = process.env) {
  const { origin, sqliteFile, ci } = validateTarget(env);
  const read = action => database(sqliteFile, action);
  read(db => {
    for (const name of ['_app_migrations', 'User', 'Post', 'Comment', 'AcceptedSolution', 'AcceptedSolutionChange', 'RewardLedger', 'RewardLedgerChange', 'CourseCompletionRecord', 'Badge', 'UserBadge']) {
      assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name), `Missing migrated SQLite table ${name}`);
    }
    if (!ci) assert.equal(db.prepare('SELECT count(*) AS count FROM "User"').get().count, 0, 'Local smoke requires a new empty disposable fixture');
  });
  const protectedSnapshot = () => read(db => Object.fromEntries(
    ['RewardLedger', 'RewardLedgerChange', 'CourseCompletionRecord', 'Badge', 'UserBadge'].map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]),
  ));
  const initialProtected = protectedSnapshot();
  const unchangedProtected = () => assert.deepEqual(protectedSnapshot(), initialProtected, 'Discussion flows must not mutate rewards, points, course milestones or badges');
  const suffix = randomUUID();
  const actors = ['author', 'respondent'].map(kind => ({
    kind, name: `Contribution Smoke ${kind}`, email: `contribution-smoke-${kind}-${suffix}@example.test`,
    password: `Smoke-${randomBytes(18).toString('hex')}!9`, request: client(origin), id: null,
  }));
  const [author, respondent] = actors;
  const anonymous = client(origin);
  let postId;
  const decisionRows = () => read(db => db.prepare('SELECT * FROM "AcceptedSolutionChange" WHERE postId = ? ORDER BY id').all(postId));
  const summary = async (actor, count) => assert.deepEqual(await actor.request('/api/contributions/me', { privateResponse: true }),
    { eligible: true, selectedByAuthors: count, saturated: false }, `${actor.kind} private milestone must be current and contain no identities`);
  const rewardBaseline = new Map();
  const unchanged = async count => {
    await summary(respondent, count);
    await summary(author, 0);
    for (const actor of actors) assert.deepEqual(await actor.request('/api/rewards/me', { privateResponse: true }), rewardBaseline.get(actor.id), `${actor.kind} points/rewards changed`);
    unchangedProtected();
  };
  const solution = (actor, commentId, expectedRevision, status = 200) => actor.request(`/api/posts/${postId}/solution`, {
    method: 'PUT', status, body: { commentId, expectedRevision }, privateResponse: true,
  });
  let failure;
  try {
    assert.deepEqual(await anonymous('/api/health'), { status: 'ok' });
    const denied = await anonymous('/api/contributions/me', { status: 401, privateResponse: true });
    assert.ok(Object.keys(denied).length === 1 && typeof (denied.error ?? denied.message) === 'string',
      'Anonymous milestone errors must contain only the proxy/route auth message, with no private progress');
    for (const actor of actors) {
      const registered = await actor.request('/api/register', { method: 'POST', status: 201, body: { name: actor.name, email: actor.email, password: actor.password } });
      assert.ok(typeof registered.userId === 'string' && registered.userId, 'Registration must return its real account ID');
      actor.id = registered.userId;
      assert.deepEqual(read(db => ({ ...db.prepare('SELECT id, email, name, role, isTestAccount FROM "User" WHERE id = ? AND email = ?').get(actor.id, actor.email) })),
        { id: actor.id, email: actor.email, name: actor.name, role: 'USER', isTestAccount: 0 }, 'Running HTTP server must persist into the explicitly selected SQLite fixture');
      const { csrfToken } = await actor.request('/api/auth/csrf');
      assert.ok(typeof csrfToken === 'string' && csrfToken, 'Real credentials login requires a CSRF token');
      const form = new URLSearchParams({ csrfToken, email: actor.email, password: actor.password, callbackUrl: origin + '/community', json: 'true' });
      const loggedIn = await actor.request('/api/auth/callback/credentials', { method: 'POST', body: form.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      assert.equal(loggedIn.url, origin + '/community', `${actor.kind} credentials login failed`);
      const session = await actor.request('/api/auth/session');
      assert.equal(session.user?.id, actor.id, 'Authenticated identity must come from the real session API');
      assert.equal(session.user?.email, actor.email);
      actor.id = session.user.id;
      const profile = await actor.request('/api/user/profile');
      assert.equal(profile.id, actor.id);
      assert.equal(profile.email, actor.email);
      const rewards = await actor.request('/api/rewards/me', { privateResponse: true });
      assert.deepEqual(rewards, { points: 0, completedCourses: 0, firstCourseCompleted: false, history: [] });
      rewardBaseline.set(actor.id, rewards);
    }
    await unchanged(0);
    const post = await author.request('/api/posts', { method: 'POST', status: 201, body: { title: `Contribution Smoke ${suffix}`, content: '<p>Synthetic disposable question</p>' } });
    assert.ok(typeof post.id === 'string' && post.id);
    postId = post.id;
    assert.equal(post.author.id, author.id);
    assert.equal(post.solutionRevision, null);
    assert.equal(post.acceptedSolutionCount, 0);
    const reply = await respondent.request(`/api/posts/${postId}/comments`, { method: 'POST', status: 200, body: { content: 'Synthetic disposable helpful answer' } });
    assert.ok(typeof reply.id === 'string' && reply.id);
    assert.equal(reply.author.id, respondent.id);
    assert.equal(reply.postId, postId);
    assert.equal(Object.hasOwn(reply, 'solutionEligible'), false, 'Reply authors must not receive the author-only eligibility hint');
    await unchanged(0);
    const unauthorized = await solution(respondent, reply.id, null, 403);
    assert.deepEqual(Object.keys(unauthorized), ['error'], 'Non-authors must not receive author-only refreshed state');
    assert.equal(decisionRows().length, 0);
    for (const actor of actors) {
      const otherId = actor === author ? respondent.id : author.id;
      const foreign = await actor.request(`/api/contributions/me?userId=${encodeURIComponent(otherId)}`, { status: 400, privateResponse: true });
      assert.deepEqual(Object.keys(foreign), ['error'], 'Other-account queries must return no identities or progress');
    }
    const selected = await solution(author, reply.id, null);
    assert.equal(selected.changed, true);
    assert.equal(selected.post.id, postId);
    assert.equal(selected.post.acceptedSolutionCount, 1);
    assert.equal(selected.post.acceptedSolution.comment.id, reply.id);
    const revision = selected.post.solutionRevision;
    assert.ok(typeof revision === 'string' && revision);
    assert.equal(selected.post.acceptedSolution.revision, revision);
    const firstDecision = decisionRows();
    assert.equal(firstDecision.length, 1);
    assert.equal(firstDecision[0].id, revision);
    assert.equal(firstDecision[0].actorId, author.id);
    assert.equal(firstDecision[0].action, 'SELECTED');
    assert.equal(firstDecision[0].commentId, reply.id);
    await unchanged(1);
    const publicPost = await respondent.request(`/api/posts/${postId}`, { privateResponse: true });
    assert.equal(publicPost.acceptedSolution.comment.id, reply.id);
    for (const comment of [...publicPost.comments, publicPost.acceptedSolution.comment]) {
      assert.deepEqual(Object.keys(comment.author).sort(), ['id', 'image', 'name']);
      assert.equal(Object.hasOwn(comment, 'solutionEligible'), false);
    }
    for (const key of ['selectedByAuthors', 'saturated', 'eligible', 'email', 'password', 'isTestAccount', 'verificationToken', 'resetPasswordToken']) {
      assert.equal(JSON.stringify(publicPost).includes(`"${key}":`), false, `Public discussion leaked private field ${key}`);
    }
    const repeated = await solution(author, reply.id, null);
    assert.equal(repeated.changed, false);
    assert.equal(repeated.post.solutionRevision, revision);
    assert.deepEqual(decisionRows(), firstDecision, 'No-op selection must not append or change audit records');
    await unchanged(1);
    const stale = await solution(author, null, null, 409);
    assert.equal(stale.post.solutionRevision, revision);
    assert.equal(stale.post.acceptedSolution.comment.id, reply.id);
    assert.deepEqual(decisionRows(), firstDecision, 'Stale state conflict must not mutate the decision');
    const cleared = await solution(author, null, revision);
    assert.equal(cleared.changed, true);
    assert.equal(cleared.post.solutionRevision, null);
    assert.equal(cleared.post.acceptedSolution, null);
    assert.equal(cleared.post.acceptedSolutionCount, 0);
    const clearedDecisions = decisionRows();
    assert.equal(clearedDecisions.length, 2);
    const clearDecision = clearedDecisions.find(row => row.action === 'CLEARED');
    assert.ok(clearDecision);
    assert.equal(clearDecision.actorId, author.id);
    assert.equal(clearDecision.previousCommentId, reply.id);
    assert.equal(clearDecision.commentId, null);
    await unchanged(0);
    const repeatedClear = await solution(author, null, revision);
    assert.equal(repeatedClear.changed, false);
    assert.deepEqual(decisionRows(), clearedDecisions, 'No-op clearing must preserve audit history');
    await unchanged(0);
    assert.equal(read(db => db.prepare('SELECT count(*) AS count FROM "AcceptedSolution" WHERE postId = ?').get(postId).count), 0);
  } catch (error) { failure = error; }
  try {
    // Only delete this run's exact UUID-named accounts and their own discussion
    // audit rows. All assertion/fixture observation above uses a read-only DB.
    // There is no self-erasure HTTP endpoint; these local fixture-only deletes
    // prevent repeated CI/local runs leaving synthetic users or decision rows.
    database(sqliteFile, db => {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (postId && author.id) db.prepare('DELETE FROM "AcceptedSolutionChange" WHERE postId = ? AND actorId = ?').run(postId, author.id);
        for (const actor of actors) {
          if (actor.id) db.prepare('DELETE FROM "User" WHERE id = ? AND email = ? AND name = ?').run(actor.id, actor.email, actor.name);
          assert.equal(db.prepare('SELECT count(*) AS count FROM "User" WHERE email = ?').get(actor.email).count, 0, 'Synthetic fixture account cleanup failed');
        }
        if (postId) assert.equal(db.prepare('SELECT count(*) AS count FROM "Post" WHERE id = ?').get(postId).count, 0, 'Synthetic discussion cleanup failed');
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }, true);
    unchangedProtected();
  } catch (error) { throw failure ? new AggregateError([failure, error], 'Contribution smoke and fixture cleanup failed') : error; }
  if (failure) throw failure;
  console.log('Contributions HTTP smoke passed: real registration/login, author-only select/no-op/clear, private respondent 0→1→0, author zero, rejected other-account queries, no-store/privacy, unchanged rewards/points/badges, and synthetic fixture cleanup.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runSmoke();
