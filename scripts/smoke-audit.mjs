import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Run only against a disposable, initialized local SQLite database and its
// matching running server. The explicit file is required for fixture setup.
const file = process.env.SMOKE_SQLITE_FILE;
if (!file || !isAbsolute(file) || !existsSync(file)) {
  throw new Error('Set SMOKE_SQLITE_FILE to an existing absolute path of a disposable initialized SQLite database.');
}
const origin = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3013').replace(/\/$/, '');
const base = new URL(origin);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:' || base.pathname !== '/') {
  throw new Error('SMOKE_BASE_URL must point to a local HTTP server.');
}
const sqliteFile = realpathSync(file);

function database(action) {
  const db = new DatabaseSync(sqliteFile);
  try {
    return action(db);
  } finally {
    db.close();
  }
}

database(db => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('_app_migrations', 'User', 'SkillEndorsement')").all();
  assert.deepEqual(new Set(tables.map(row => row.name)), new Set(['_app_migrations', 'User', 'SkillEndorsement']),
    'SQLite fixture must have the audited migrations applied');
  assert.equal(db.prepare('SELECT count(*) AS count FROM "User"').get().count, 0,
    'The explicit SQLite fixture must be disposable and empty');
});

function client() {
  const cookies = new Map();
  return async function request(path, { status = 200, method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(origin + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(cookies.size ? { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
        ...(method !== 'GET' ? { origin } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const separator = pair.indexOf('=');
      if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
    return response;
  };
}

async function login(request, email, password) {
  const { csrfToken } = await (await request('/api/auth/csrf')).json();
  const body = new URLSearchParams({ csrfToken, email, password, callbackUrl: origin + '/resources', json: 'true' });
  const response = await request('/api/auth/callback/credentials', {
    method: 'POST', body: body.toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  assert.equal((await response.json()).url, origin + '/resources', `Login failed for ${email}`);
}

const admin = client();
const member = client();
const suffix = randomUUID();
const adminEmail = `audit-admin-${suffix}@example.test`;
const memberEmail = `audit-member-${suffix}@example.test`;
const instructorEmail = `audit-instructor-${suffix}@example.test`;
const password = 'StrongPassword123!';
const changedPassword = 'DifferentPassword456!';

await admin('/api/health');
await admin('/api/register', { method: 'POST', status: 201, body: { name: 'Audit Admin', email: adminEmail, password } });
await member('/api/register', { method: 'POST', status: 201, body: { name: 'Audit Member', email: memberEmail, password } });
await admin('/api/register', { method: 'POST', status: 201, body: { name: 'Audit Instructor', email: instructorEmail, password } });
const { adminId, memberId, instructorId, skillId } = database(db => {
  const adminId = db.prepare('SELECT id FROM "User" WHERE email = ?').get(adminEmail)?.id;
  const memberId = db.prepare('SELECT id FROM "User" WHERE email = ?').get(memberEmail)?.id;
  const instructorId = db.prepare('SELECT id FROM "User" WHERE email = ?').get(instructorEmail)?.id;
  assert.ok(adminId && memberId && instructorId, 'HTTP registration did not persist fixture users');
  assert.equal(db.prepare('UPDATE "User" SET role = ? WHERE id = ?').run('ADMIN', adminId).changes, 1);
  const skillId = randomUUID();
  db.prepare('INSERT INTO "Skill" (id, name, category) VALUES (?, ?, ?)').run(skillId, `Smoke ${suffix}`, 'Smoke');
  return { adminId, memberId, instructorId, skillId };
});

await login(admin, adminEmail, password);
await login(member, memberEmail, password);
await admin('/api/admin/users', {
  method: 'POST', status: 400,
  body: { name: 'Weak Password', email: `weak-${suffix}@example.test`, password: 'weak', role: 'USER' },
});
await admin(`/api/admin/users/${adminId}`, {
  method: 'PUT', status: 400,
  body: { name: 'Audit Admin', email: adminEmail, role: 'USER' },
});

const userSkill = await (await member('/api/user/skills', {
  method: 'POST', status: 201, body: { skillId, level: 2 },
})).json();
await admin(`/api/users/${memberId}`, { method: 'PATCH', body: { skillId: userSkill.id } });
await member(`/api/users/${memberId}/profile`, {
  method: 'PUT', body: { name: 'Audit Member Updated', skills: [{ id: userSkill.id, level: 3 }] },
});
const retainedSkill = await (await admin(`/api/users/${memberId}`)).json();
assert.equal(retainedSkill.skills.find(skill => skill.skillId === skillId)?.id, userSkill.id,
  'Profile save replaced the retained UserSkill row');
assert.equal(retainedSkill.skills.find(skill => skill.id === userSkill.id)?.endorsements, 1,
  'Profile save cleared the retained skill endorsements');
await admin(`/api/users/${memberId}`, { method: 'PATCH', status: 409, body: { skillId: userSkill.id } });
const profile = await (await admin(`/api/users/${memberId}`)).json();
assert.equal(profile.skills.find(skill => skill.id === userSkill.id)?.endorsements, 1,
  'Duplicate endorsement changed the aggregate count');

const { courseId, contentIds } = database(db => {
  const courseId = randomUUID();
  const contentIds = [randomUUID(), randomUUID(), randomUUID()];
  const now = new Date().toISOString();
  db.prepare('INSERT INTO "Course" (id, title, description, instructorId, updatedAt) VALUES (?, ?, ?, ?, ?)')
    .run(courseId, `Audit Course ${suffix}`, 'Disposable certificate fixture', instructorId, now);
  db.prepare('INSERT INTO "Enrollment" (id, userId, courseId, completedAt) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), memberId, courseId, now);
  const insert = db.prepare('INSERT INTO "CourseContent" (id, title, content, "order", courseId, parentId, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  contentIds.forEach((id, index) => insert.run(id, `Depth ${index + 1}`, 'Content', index, courseId, index ? contentIds[index - 1] : null, now));
  return { courseId, contentIds };
});
const certificateResponses = await Promise.all([1, 2].map(() => member(`/api/courses/${courseId}/certificate`, { method: 'POST' })));
for (const response of certificateResponses) {
  assert.match(response.headers.get('content-type') ?? '', /^application\/pdf/);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-', 'Certificate is not a PDF');
}
database(db => {
  assert.equal(db.prepare('SELECT count(*) AS count FROM "Certificate" WHERE courseId = ? AND userId = ?').get(courseId, memberId).count, 1,
    'Concurrent issuance duplicated the certificate');
});
await admin(`/api/admin/users/${instructorId}`, { method: 'DELETE' });
database(db => {
  assert.equal(db.prepare('SELECT count(*) AS count FROM "User" WHERE id = ?').get(instructorId).count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM "Course" WHERE id = ?').get(courseId).count, 0);
  assert.equal(db.prepare(`SELECT count(*) AS count FROM "CourseContent" WHERE id IN (${contentIds.map(() => '?').join(',')})`).get(...contentIds).count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM "Enrollment" WHERE courseId = ?').get(courseId).count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM "Certificate" WHERE courseId = ?').get(courseId).count, 0);
  assert.equal(db.prepare('SELECT count(*) AS count FROM "User" WHERE role = ?').get('ADMIN').count, 1,
    'Instructor deletion changed the administrator total');
});

const channel = await (await admin('/api/chat/channels', {
  method: 'POST', body: { name: `Private audit ${suffix}`, isPrivate: true },
})).json();
await admin('/api/chat/members', { method: 'POST', body: { channelId: channel.id, userId: memberId } });
const message = await (await member('/api/chat/messages', {
  method: 'POST', body: { channelId: channel.id, content: 'Before removal' },
})).json();
await admin(`/api/chat/members?channelId=${encodeURIComponent(channel.id)}&userId=${encodeURIComponent(memberId)}`, {
  method: 'DELETE', status: 204,
});
await member(`/api/chat/messages/${message.id}`, {
  method: 'PATCH', status: 403, body: { content: 'After removal' },
});

await admin('/api/admin/users', { method: 'POST', status: 400, body: '{' });
await admin('/api/admin/users', { method: 'POST', status: 413, body: JSON.stringify({ name: 'x'.repeat(300_000) }) });

await admin(`/api/admin/users/${adminId}`, {
  method: 'PUT', body: { name: 'Audit Admin', email: adminEmail, role: 'ADMIN', password: changedPassword },
});
await admin('/api/user/profile', { status: 401 });

console.log('Audit HTTP smoke passed: account guards, retained skills, duplicate endorsement, concurrent certificate PDF issuance, instructor cleanup, private-channel access, and JSON limits.');
