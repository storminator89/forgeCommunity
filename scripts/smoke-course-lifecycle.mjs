import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';

// Disposable local fixture only. Enrollment/progress/completion/certificates are
// created through HTTP, never by setting completedAt or inserting certificates.
const file = process.env.SMOKE_SQLITE_FILE;
const origin = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3014').replace(/\/$/, '');
const base = new URL(origin);
assert.ok(file && isAbsolute(file) && existsSync(file), 'Provide an initialized disposable SMOKE_SQLITE_FILE');
assert.ok(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname), 'Local HTTP fixture required');
const db = new DatabaseSync(file);
assert.equal(db.prepare('SELECT count(*) AS n FROM "User"').get().n, 0, 'Fixture must start empty');
const suffix = randomUUID();
const password = 'DisposableStrong123!';
let checks = 0;
function client() {
  const cookies = new Map();
  return async (path, { status = 200, method = 'GET', body, headers = {} } = {}) => {
    const multipart = body instanceof FormData;
    const response = await fetch(origin + path, {
      method, redirect: 'manual',
      headers: {
        ...(cookies.size ? { cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') } : {}),
        ...(method !== 'GET' ? { origin } : {}),
        ...(body !== undefined && !multipart && typeof body !== 'string' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : multipart || typeof body === 'string' ? body : JSON.stringify(body),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';'); const i = pair.indexOf('=');
      if (i > 0) cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    assert.ok((Array.isArray(status) ? status : [status]).includes(response.status), `${method} ${path}: ${response.status} ${await response.clone().text()}`);
    checks++;
    return response;
  };
}
async function account(name) {
  const request = client(); const email = `${name.toLowerCase().replaceAll(" ", "-")}-${suffix}@example.test`;
  const registration = await (await request('/api/register', { method: 'POST', status: 201, body: { name, email, password } })).json();
  const { csrfToken } = await (await request('/api/auth/csrf')).json();
  const login = await request('/api/auth/callback/credentials', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken, email, password, callbackUrl: origin + '/courses', json: 'true' }).toString() });
  assert.equal((await login.json()).url, origin + '/courses');
  return { request, id: registration.userId, email };
}
const owner = await account('Course Owner');
const learner = await account('Learner');
const other = await account('Other Learner');
const anonymous = client();
async function course(title, extra = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries({ title, description: 'Disposable course lifecycle smoke', ...extra })) body.set(key, String(value));
  return (await owner.request('/api/courses', { method: 'POST', status: 201, body })).json();
}
async function content(courseId, title, extra = {}) {
  return (await owner.request(`/api/courses/${courseId}/contents`, { method: 'POST', status: 201, body: { title, type: 'TEXT', content: '<p>Learning material</p>', ...extra } })).json();
}
const free = await course('Free course');
const first = await content(free.id, 'First lesson');
const last = await content(free.id, 'Final lesson');
await content(free.id, 'Optional lesson', { isRequired: false });
const foreign = await course('Other course');
const foreignContent = await content(foreign.id, 'Other content');
const path = `/api/courses/${free.id}`;
await anonymous(`${path}/enroll`, { method: 'POST', status: 401 });
await learner.request(`${path}/contents`, { status: 403 });
await learner.request(`${path}/contents/${first.id}/progress`, { method: 'PUT', status: 403, body: { completed: true } });
await learner.request(`${path}/certificate`, { method: 'POST', status: 403 });
await Promise.all([1, 2].map(() => learner.request(`${path}/enroll`, { method: 'POST', status: [200, 201] })));
assert.equal(db.prepare('SELECT count(*) AS n FROM "Enrollment" WHERE courseId=? AND userId=?').get(free.id, learner.id).n, 1);
await learner.request(`${path}/contents`);
await other.request(`${path}/enrollments`, { method: 'POST', status: 403, body: { userId: other.id } });
await other.request(`${path}/enrollments`, { status: 403 });
await learner.request(`${path}/contents/${foreignContent.id}/progress`, { method: 'PUT', status: 404, body: { completed: true } });
await learner.request(`${path}/contents/${first.id}/progress`, { method: 'PUT', status: 400, body: { completed: 'true' } });
let progress = await (await learner.request(`${path}/progress`)).json();
assert.equal(progress.requiredCount, 2);
assert.equal(progress.certificate, null);
progress = await (await learner.request(`${path}/contents/${first.id}/progress`, { method: 'PUT', body: { completed: true } })).json();
assert.equal(progress.completedCount, 1); assert.equal(progress.percentage, 50); assert.equal(progress.certificate, null);
progress = await (await learner.request(`${path}/contents/${first.id}/progress`, { method: 'PUT', body: { completed: false } })).json();
assert.equal(progress.completedCount, 0);
await learner.request(`${path}/contents/${first.id}/progress`, { method: 'PUT', body: { completed: true } });
await learner.request(`${path}/certificate`, { method: 'POST', status: 403 });
const finished = await Promise.all([1, 2, 3].map(async () => (await learner.request(`${path}/contents/${last.id}/progress`, { method: 'PUT', body: { completed: true } })).json()));
const certificateId = finished[0].certificate?.id;
assert.ok(certificateId, 'Final progress request did not automatically issue certificate');
for (const result of finished) { assert.equal(result.certificate.id, certificateId); assert.ok(result.enrollment.completedAt); assert.equal(result.percentage, 100); }
assert.equal(db.prepare('SELECT count(*) AS n FROM "Certificate" WHERE courseId=? AND userId=?').get(free.id, learner.id).n, 1);
await learner.request(`${path}/contents/${last.id}/progress`, { method: 'PUT', status: 409, body: { completed: false } });
const freshClient = await (async () => {
  const request = client(); const { csrfToken } = await (await request('/api/auth/csrf')).json();
  await request('/api/auth/callback/credentials', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrfToken, email: learner.email, password, callbackUrl: origin + '/courses', json: 'true' }).toString() });
  return request;
})();
assert.equal((await (await freshClient(`${path}/progress`)).json()).certificate.id, certificateId, 'Server progress lost after fresh login');
const pdf = await learner.request(`${path}/certificate`, { method: 'POST' });
assert.match(pdf.headers.get('content-type') ?? '', /application\/pdf/);
assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
const savedPdf = await learner.request(`/api/certificates/${certificateId}/download`);
assert.match(savedPdf.headers.get('content-type') ?? '', /application\/pdf/);
await other.request(`/api/certificates/${certificateId}/download`, { status: 404 });
assert.equal(db.prepare('SELECT count(*) AS n FROM "Certificate" WHERE courseId=? AND userId=?').get(free.id, learner.id).n, 1);

const completedAt = finished[0].enrollment.completedAt;
await content(free.id, 'Later syllabus addition');
const history = await (await learner.request(`${path}/progress`)).json();
assert.equal(history.certificate.id, certificateId, 'Syllabus edit replaced historical certificate');
assert.equal(history.enrollment.completedAt, completedAt, 'Syllabus edit revoked completed enrollment');
await other.request(`${path}/certificate`, { method: 'POST', status: 403 });
const optionalOnly = await course('Optional only');
const optional = await content(optionalOnly.id, 'Optional', { isRequired: false });
await learner.request(`/api/courses/${optionalOnly.id}/enroll`, { method: 'POST', status: [200, 201] });
const optionalProgress = await (await learner.request(`/api/courses/${optionalOnly.id}/contents/${optional.id}/progress`, { method: 'PUT', body: { completed: true } })).json();
assert.equal(optionalProgress.requiredCount, 0); assert.equal(optionalProgress.certificate, null); assert.equal(optionalProgress.enrollment.completedAt, null);

const paid = await course('Paid course', { price: 25, currency: 'EUR' });
const paidContent = await content(paid.id, 'Paid lesson');
await learner.request(`/api/courses/${paid.id}/enroll`, { method: 'POST', status: 403 });
await learner.request(`/api/courses/${paid.id}/contents`, { status: 403 });
await other.request(`/api/courses/${paid.id}/enrollments`, { method: 'POST', status: 403, body: { userId: learner.id } });
await owner.request(`/api/courses/${paid.id}/enrollments`, { method: 'POST', status: [200, 201], body: { email: learner.email } });
await owner.request(`/api/courses/${paid.id}/enrollments`, { method: 'POST', status: [200, 201], body: { userId: learner.id } });
await learner.request(`/api/courses/${paid.id}/contents`);
const paidProgress = await (await learner.request(`/api/courses/${paid.id}/contents/${paidContent.id}/progress`, { method: 'PUT', body: { completed: true } })).json();
assert.ok(paidProgress.certificate?.id, 'Paid approved course did not auto issue');
const empty = await course('Empty course');
await learner.request(`/api/courses/${empty.id}/enroll`, { method: 'POST', status: [200, 201] });
const emptyProgress = await (await learner.request(`/api/courses/${empty.id}/progress`)).json();
assert.equal(emptyProgress.requiredCount, 0); assert.equal(emptyProgress.enrollment.completedAt, null); assert.equal(emptyProgress.certificate, null);
await learner.request(`/api/courses/${empty.id}/certificate`, { method: 'POST', status: 403 });
const limited = await course('One place', { maxStudents: 1 });
const outcomes = await Promise.all([learner, other].map(user => user.request(`/api/courses/${limited.id}/enroll`, { method: 'POST', status: [200, 201, 409] })));
assert.equal(outcomes.filter(response => response.ok).length, 1, 'Concurrent enrollment exceeded capacity');
assert.equal(db.prepare('SELECT count(*) AS n FROM "Enrollment" WHERE courseId=?').get(limited.id).n, 1);
db.close();
console.log(`Course lifecycle HTTP smoke: ${checks} checks passed; free enrollment, paid unlock, persisted progress, automatic single certificate, PDF, concurrent limits, and access guards.`);
