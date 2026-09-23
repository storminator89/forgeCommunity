import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';

// No real database or deployment credentials are used by this smoke test.
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const uploads = path.resolve('.next/standalone/public/images/uploads');
const publicName = `image-${randomUUID()}.png`;
const legacyName = `chat-${randomUUID()}.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5V8AAAAASUVORK5CYII=', 'base64');
await mkdir(uploads, { recursive: true });
// An existing file also must be blocked before Next's static file handler.
await writeFile(path.join(uploads, legacyName), png);
const child = spawn(process.execPath, ['.next/standalone/server.js'], {
  env: {
    ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1',
    DATABASE_URL: 'postgresql://placeholder.invalid:5432/forge',
    NEXTAUTH_SECRET: randomBytes(32).toString('hex'), NEXTAUTH_URL: origin,
    NEXT_PUBLIC_APP_URL: origin,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
const timeout = setTimeout(() => child.kill('SIGTERM'), 45_000);
try {
  await new Promise((resolve, reject) => {
    const ready = data => { if (String(data).includes('Ready')) resolve(); };
    child.stdout.on('data', ready);
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`Server exited ${code}: ${logs}`)));
  });
  const check = async (url, status, options = {}) => {
    const response = await fetch(origin + url, { ...options, redirect: 'manual' });
    assert.equal(response.status, status, `${url}: ${await response.clone().text()}`);
    return response;
  };
  await check('/login', 200);
  await check('/api/auth/providers', 200);
  await check('/api/auth/csrf', 200);
  await check('/api/users', 401);
  await check('/api/chat/uploads/chat-dead-beef.png', 401);
  await check('/api/register', 403, {
    method: 'POST', headers: { origin: 'https://attacker.invalid', 'content-type': 'application/json' }, body: '{}',
  });
  await check('/api/auth/callback/credentials', 413, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'x'.repeat(16_385),
  });
  await check(`/images/uploads/${legacyName}`, 404);
  await check(`/images/uploads/${legacyName.replace('chat-', '%63hat-')}`, 404);
  await check(`/images/uploads/${legacyName}`, 404, { method: 'HEAD' });
  // Created after startup: exercises runtime uploads rather than static indexing.
  await writeFile(path.join(uploads, publicName), png);
  const image = await check(`/images/uploads/${publicName}`, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  console.log('Standalone smoke: 11 HTTP checks passed.');
} finally {
  clearTimeout(timeout);
  child.kill('SIGTERM');
  await Promise.all([publicName, legacyName].map(name => rm(path.join(uploads, name), { force: true })));
}
