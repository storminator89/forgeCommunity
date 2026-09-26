// lib/prisma.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { getDatabaseProvider, getDatabaseUrl } from './database-provider';

const provider = getDatabaseProvider();
const url = getDatabaseUrl();
const adapter = provider === 'sqlite'
  ? new PrismaBetterSqlite3({ url })
  : new PrismaPg({ connectionString: url });

declare global {
  // Ermöglicht globale Variablen ohne TypeScript-Fehler
  var prisma: PrismaClient | undefined;
}

const prisma = global.prisma || new PrismaClient({ adapter });
// The generated Prisma Client embeds its datasource provider. A mismatched
// build would otherwise fail only when the first query runs.
const generatedProvider = (prisma as PrismaClient & {
  _engineConfig: { activeProvider: string };
})._engineConfig.activeProvider;
if (generatedProvider !== provider) {
  throw new Error(`Prisma Client was generated for ${generatedProvider}, but DATABASE_PROVIDER=${provider}. Rebuild with DATABASE_PROVIDER=${provider}.`);
}

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;

export default prisma;
