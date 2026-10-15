import { existsSync } from 'node:fs';
import { initializeSqlite } from './sqlite-init.mjs';
import { applyPostgresqlUpgrades } from './postgresql-upgrades.mjs';

if (existsSync('.env')) process.loadEnvFile('.env');
const provider = process.env.DATABASE_PROVIDER ?? 'postgresql';
const flags = process.argv.slice(2);
if (flags.some(flag => !['--baseline-current-schema', '--initialize-empty-schema'].includes(flag)) || flags.length > 1) {
  throw new Error('Unknown database deployment option.');
}
const baselineCurrentSchema = flags.includes('--baseline-current-schema');
const initializeEmptySchema = flags.includes('--initialize-empty-schema');
if (provider === 'sqlite') {
  if (baselineCurrentSchema || initializeEmptySchema) throw new Error('PostgreSQL initialization options do not apply to SQLite.');
  initializeSqlite(process.env.DATABASE_URL);
} else if (provider === 'postgresql') {
  await applyPostgresqlUpgrades(process.env.DATABASE_URL, { baselineCurrentSchema, initializeEmptySchema });
} else {
  throw new Error('DATABASE_PROVIDER must be either "postgresql" or "sqlite".');
}
