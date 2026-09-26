import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

// Run against an initialized SQLite deployment (including a Docker instance).
// For example: SMOKE_BASE_URL=http://127.0.0.1:3013 node scripts/smoke-sqlite.mjs
const origin = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3013').replace(/\/$/, '');
const cookies = new Map();
const email = `smoke-${randomUUID()}@example.test`;
const password = 'StrongPassword123!';
const marker = `SQLite Smoke ${randomUUID()}`;

async function request(path, { status = 200, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(origin + path, {
    method,
    redirect: 'manual',
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
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  assert.equal(response.status, status, `${method} ${path}: ${await response.clone().text()}`);
  return response;
}

await request('/api/health');
await request('/api/register', {
  method: 'POST', status: 201,
  body: { name: 'SQLite Smoke', email, password },
});
// Optional local fixture for an account written by older code with mixed-case
// email. Docker runs can omit this, since the database volume is in the image.
let storedEmail = email;
if (process.env.SMOKE_SQLITE_FILE) {
  storedEmail = email.toUpperCase();
  const db = new DatabaseSync(process.env.SMOKE_SQLITE_FILE);
  try {
    const result = db.prepare('UPDATE "User" SET email = ? WHERE email = ?').run(storedEmail, email);
    assert.equal(result.changes, 1);
  } finally {
    db.close();
  }
}
await request('/api/register', {
  method: 'POST', status: 400,
  body: { name: 'Duplicate', email: email.toUpperCase(), password },
});

const { csrfToken } = await (await request('/api/auth/csrf')).json();
const credentials = new URLSearchParams({
  csrfToken,
  email: email.toUpperCase(),
  password,
  callbackUrl: origin + '/resources',
  json: 'true',
});
const login = await request('/api/auth/callback/credentials', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: credentials.toString(),
});
const loginResult = await login.json();
assert.equal(loginResult.url, origin + '/resources', JSON.stringify(loginResult));
assert.ok([...cookies.keys()].some(key => key.endsWith('session-token')), 'credentials session cookie missing');

const profile = await (await request('/api/user/profile')).json();
assert.equal(profile.email, storedEmail);
let expectedCertificates = [];
if (process.env.SMOKE_SQLITE_FILE) {
  const courseA = randomUUID();
  const courseB = randomUUID();
  const oldId = randomUUID();
  const latestId = randomUUID();
  const otherId = randomUUID();
  const db = new DatabaseSync(process.env.SMOKE_SQLITE_FILE);
  try {
    const courseInsert = db.prepare(
      'INSERT INTO "Course" (id, title, description, instructorId, updatedAt) VALUES (?, ?, ?, ?, ?)',
    );
    const certificateInsert = db.prepare(
      'INSERT INTO "Certificate" (id, userId, courseId, issuedAt, courseName, userName) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const now = new Date().toISOString();
    courseInsert.run(courseA, 'Certificate course A', 'Smoke fixture', profile.id, now);
    courseInsert.run(courseB, 'Certificate course B', 'Smoke fixture', profile.id, now);
    certificateInsert.run(oldId, profile.id, courseA, '2023-01-01T00:00:00.000+00:00', 'Certificate course A', 'SQLite Smoke');
    certificateInsert.run(latestId, profile.id, courseA, '2024-01-01T00:00:00.000+00:00', 'Certificate course A', 'SQLite Smoke');
    certificateInsert.run(otherId, profile.id, courseB, '2023-06-01T00:00:00.000+00:00', 'Certificate course B', 'SQLite Smoke');
  } finally {
    db.close();
  }
  expectedCertificates = [latestId, otherId];
}
const resource = await (await request('/api/resources', {
  method: 'POST', status: 201,
  body: { title: marker, category: 'Community', type: 'ARTICLE', url: 'https://example.test/original', color: '#123456' },
})).json();
assert.equal(resource.author.id, profile.id);

const resources = await (await request(`/api/resources?search=${encodeURIComponent(marker.toUpperCase())}`)).json();
assert.ok(resources.resources.some(item => item.id === resource.id), 'SQLite resource search must ignore ASCII case');
const results = await (await request(`/api/search?type=resource&query=${encodeURIComponent(marker.toUpperCase())}`)).json();
assert.ok(results.results.some(item => item.id === resource.id), 'global resource search must ignore ASCII case');

const updated = await (await request(`/api/resources/${resource.id}`, {
  method: 'PUT',
  body: { title: marker + ' Updated', url: 'https://example.test/updated' },
})).json();
assert.equal(updated.title, marker + ' Updated');
assert.equal((await (await request(`/api/resources/${resource.id}`)).json()).title, updated.title);
const certificates = await (await request('/api/user/certificates')).json();
assert.deepEqual(certificates.map(item => item.id), expectedCertificates);
if (expectedCertificates.length) {
  assert.equal(certificates[0].issuedAt, '2024-01-01T00:00:00.000Z');
}
await request(`/api/resources/${resource.id}`, { method: 'DELETE' });
await request(`/api/resources/${resource.id}`, { status: 404 });

console.log('SQLite HTTP smoke: health, register, duplicate mixed-case email, login, profile, search, resource CRUD, certificates passed.');
