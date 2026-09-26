import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export function sqlitePath(url) {
  if (!url?.startsWith('file:')) {
    throw new Error('SQLite initialization requires DATABASE_URL=file:/absolute/path/database.db.');
  }
  const value = url.slice(5);
  if (!isAbsolute(value) || value.startsWith('//') || /[%?#]/.test(value)) {
    throw new Error('SQLite initialization requires an absolute, persistent local file: URL without escaping or query parameters.');
  }
  return value;
}

export function initializeSqlite(url, migrationsDir = fileURLToPath(new URL('../prisma/sqlite-migrations/', import.meta.url))) {
  if (process.env.DATABASE_PROVIDER !== 'sqlite') {
    throw new Error('SQLite initialization requires DATABASE_PROVIDER=sqlite.');
  }
  const path = sqlitePath(url);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    const files = readdirSync(migrationsDir).filter((name) => /^\d+_[\w-]+\.sql$/.test(name)).sort();
    if (files.length === 0) throw new Error('No tracked SQLite migrations found.');

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => name);
    if (tables.length > 0 && !tables.includes('_app_migrations')) {
      throw new Error('Existing SQLite schema has no migration history; refusing to change it. Back it up and migrate it explicitly.');
    }
    const historyExists = tables.includes('_app_migrations');
    const applied = historyExists
      ? db.prepare('SELECT name, checksum FROM _app_migrations').all()
      : [];
    const known = new Map(files.map((name) => [name, createHash('sha256').update(readFileSync(resolve(migrationsDir, name))).digest('hex')]));
    for (const { name, checksum } of applied) {
      if (!known.has(name)) throw new Error(`Applied SQLite migration ${name} is not present in the image.`);
      if (known.get(name) !== checksum) throw new Error(`SQLite migration ${name} checksum changed; refusing to alter existing data.`);
    }
    const completed = new Set(applied.map(({ name }) => name));
    // A missing earlier migration cannot safely be applied after a later one.
    let pending = false;
    for (const name of files) {
      if (!completed.has(name)) pending = true;
      else if (pending) throw new Error(`SQLite migration history has a gap before ${name}.`);
    }

    for (const name of files) {
      if (completed.has(name)) continue;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec('CREATE TABLE IF NOT EXISTS _app_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
        db.exec(readFileSync(resolve(migrationsDir, name), 'utf8'));
        db.prepare('INSERT INTO _app_migrations (name, checksum) VALUES (?, ?)').run(name, known.get(name));
        db.exec('COMMIT');
        console.log(`Applied SQLite migration ${name}`);
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    return path;
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = initializeSqlite(process.env.DATABASE_URL);
    console.log(`SQLite database ready: ${path}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
