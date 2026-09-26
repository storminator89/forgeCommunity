import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:3013';
const email = `sqlite-docker-${randomUUID()}@example.test`;
const account = {
  name: 'SQLite Docker Smoke',
  email,
  password: 'SmokeTest-Strong-2026!',
};
const compose = (...args) => new Promise((resolve, reject) => {
  const child = spawn('docker', [
    'compose', '-f', process.env.COMPOSE_FILE ?? 'docker-compose.yml', ...args,
  ], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`docker compose ${args.join(' ')} failed (${signal ?? code})`));
  });
});

async function check(path, expectedStatus, options) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: { ...options?.headers, Connection: 'close' },
  });
  assert.equal(response.status, expectedStatus,
    `${path}: expected ${expectedStatus}, got ${response.status}: ${await response.clone().text()}`);
  return response;
}

const registration = () => check('/api/register', 201, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin },
  body: JSON.stringify(account),
});

await (await check('/api/health', 200)).arrayBuffer();
const created = await registration();
assert.ok((await created.json()).userId);

// A fresh process must see the account in the named SQLite volume. The
// registration API returns 400 for duplicate emails; a blank DB returns 201.
await compose('stop', 'app');
await compose('up', '-d', '--wait', '--force-recreate', 'app');
await (await check('/api/health', 200)).arrayBuffer();
const duplicate = await fetch(`${origin}/api/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: origin, Connection: 'close' },
  body: JSON.stringify(account),
});
assert.equal(duplicate.status, 400, `Account not retained: ${await duplicate.text()}`);
console.log('SQLite Docker smoke passed: health, registration, and restart persistence.');
