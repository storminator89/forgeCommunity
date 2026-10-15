export type DatabaseProvider = 'postgresql' | 'sqlite';

// PostgreSQL remains the default for existing deployments.
export function getDatabaseProvider(): DatabaseProvider {
  const provider = process.env.DATABASE_PROVIDER ?? 'postgresql';
  if (provider !== 'postgresql' && provider !== 'sqlite') {
    throw new Error('DATABASE_PROVIDER must be either "postgresql" or "sqlite".');
  }
  return provider;
}

export function isSqliteDatabase(): boolean {
  return getDatabaseProvider() === 'sqlite';
}

export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be configured before using Prisma.');
  }
  const valid = isSqliteDatabase()
    ? /^file:\/(?!\/)[^%?#]+$/.test(url)
    : /^postgres(?:ql)?:\/\//.test(url);
  if (!valid) {
    throw new Error(`DATABASE_URL must use a ${isSqliteDatabase() ? 'file:/absolute/path/database.db' : 'postgresql://...'} URL for DATABASE_PROVIDER=${getDatabaseProvider()}.`);
  }
  return url;
}

/** The same explicit namespace is used by Prisma's PG adapter and raw SQL. */
export function getPostgresqlSchema(): string | null {
  const schema = new URL(getDatabaseUrl()).searchParams.get('schema');
  // Without ?schema=, both PrismaPg and raw SQL retain the connection's
  // search_path, which may be configured outside this URL.
  if (schema === null) return null;
  // PostgreSQL truncates longer identifiers; refusing them prevents raw SQL
  // and Prisma from silently resolving different namespaces.
  if (!schema || schema.includes('\0') || Buffer.byteLength(schema, 'utf8') > 63) {
    throw new Error('PostgreSQL DATABASE_URL has an invalid schema name.');
  }
  return schema;
}
