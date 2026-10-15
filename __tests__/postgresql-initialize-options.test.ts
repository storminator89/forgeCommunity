/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const deploy = (provider: string, url: string, flags: string[]) => spawnSync(
  process.execPath, ['scripts/db-deploy.mjs', ...flags], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, DATABASE_PROVIDER: provider, DATABASE_URL: url },
  },
);

test('empty-schema initializer cannot touch a SQLite file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'forge-pg-init-guard-'));
  const path = join(directory, 'not-created.db');
  try {
    const result = deploy('sqlite', `file:${path}`, ['--initialize-empty-schema']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/do not apply to SQLite/);
    expect(existsSync(path)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('empty-schema initializer requires an explicit PostgreSQL URL schema before connecting', () => {
  const result = deploy('postgresql', 'postgresql://unused:unused@127.0.0.1:1/forge_test', ['--initialize-empty-schema']);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/requires an explicit \?schema= target/);
});

test('PostgreSQL initialization modes cannot be combined', () => {
  const result = deploy('postgresql', 'postgresql://unused:unused@127.0.0.1:1/forge_test?schema=public',
    ['--initialize-empty-schema', '--baseline-current-schema']);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(/Unknown database deployment option/);
});
