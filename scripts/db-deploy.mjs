import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { initializeSqlite } from './sqlite-init.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const provider = process.env.DATABASE_PROVIDER ?? 'postgresql';
if (provider === 'sqlite') {
  initializeSqlite(process.env.DATABASE_URL);
} else if (provider === 'postgresql') {
  if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) {
    throw new Error('PostgreSQL migration requires DATABASE_URL=postgresql://...');
  }
  const command = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const result = spawnSync(command, ['migrate', 'deploy'], { stdio: 'inherit', env: process.env, shell: true });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} else {
  throw new Error('DATABASE_PROVIDER must be either "postgresql" or "sqlite".');
}
