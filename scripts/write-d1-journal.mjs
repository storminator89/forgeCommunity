// Keep the historical filename for the postinstall hook. Retained migrations are
// append-only source artifacts: validate them without generating or rewriting them.
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = fileURLToPath(new URL('../drizzle', import.meta.url));
const metadataDirectory = join(migrationsDirectory, 'meta');
const journalPath = join(metadataDirectory, '_journal.json');
const baseline = {
  idx: 0,
  version: '7',
  when: 1792195200000,
  tag: '0000_forgecommunity',
  breakpoints: true,
};

function requireHistory(condition, message) {
  if (!condition) throw new Error(`Invalid retained D1 migration history: ${message}`);
}

async function requireDirectory(path) {
  const stat = await lstat(path);
  requireHistory(stat.isDirectory() && !stat.isSymbolicLink(), `${path} must be a non-symlink directory`);
}

async function requireFile(path) {
  const stat = await lstat(path);
  requireHistory(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0, `${path} must be a nonempty regular file`);
}

await requireDirectory(migrationsDirectory);
await requireDirectory(metadataDirectory);
await requireFile(journalPath);
const journal = JSON.parse(await readFile(journalPath, 'utf8'));
requireHistory(journal !== null && typeof journal === 'object' && !Array.isArray(journal), 'journal must be an object');
requireHistory(journal.version === '7' && journal.dialect === 'sqlite', 'expected version 7 and sqlite dialect');
requireHistory(Array.isArray(journal.entries) && journal.entries.length > 0, 'journal must contain entries');

const sqlNames = new Set();
let previousWhen = 0;
for (const [index, entry] of journal.entries.entries()) {
  requireHistory(entry !== null && typeof entry === 'object' && !Array.isArray(entry), `entry ${index} must be an object`);
  requireHistory(entry.idx === index && entry.version === '7', `entry ${index} must have a contiguous index and version 7`);
  requireHistory(Number.isSafeInteger(entry.when) && entry.when > previousWhen && entry.when <= 8640000000000000, `entry ${index} must have an increasing valid timestamp`);
  requireHistory(typeof entry.tag === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(entry.tag), `entry ${index} must have a safe migration tag`);
  requireHistory(typeof entry.breakpoints === 'boolean', `entry ${index} must declare breakpoints`);
  const sqlName = `${entry.tag}.sql`;
  requireHistory(!sqlNames.has(sqlName), `duplicate migration tag ${entry.tag}`);
  sqlNames.add(sqlName);
  previousWhen = entry.when;
  if (index === 0) {
    requireHistory(Object.keys(entry).length === Object.keys(baseline).length && Object.entries(baseline).every(([key, value]) => entry[key] === value), 'initial baseline entry must remain unchanged');
  }
  await requireFile(join(migrationsDirectory, sqlName));
}

for (const name of await readdir(migrationsDirectory)) {
  if (/\.sql$/i.test(name)) {
    requireHistory(sqlNames.has(name), `unjournaled SQL file ${name}`);
  }
}
