import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url));
const destination = fileURLToPath(new URL('../prisma/schema.sqlite.prisma', import.meta.url));
const canonical = readFileSync(source, 'utf8');
const provider = /(^\s*provider\s*=\s*)"postgresql"/m;
if (!provider.test(canonical)) {
  throw new Error('Expected exactly one PostgreSQL provider in the canonical Prisma schema.');
}
const sqlite = canonical.replace(provider, '$1"sqlite"').replaceAll('@db.Text', '');
const notice = '// Generated from schema.prisma by scripts/generate-sqlite-schema.mjs; edit the PostgreSQL schema instead.\n';
const generated = notice + sqlite.replace(/[\t ]+$/gm, '');

if (process.argv.includes('--check')) {
  if (readFileSync(destination, 'utf8') !== generated) {
    throw new Error('SQLite Prisma schema is stale; run npm run db:schema:sqlite.');
  }
} else {
  writeFileSync(destination, generated);
}
