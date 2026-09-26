import { isSqliteDatabase } from '@/lib/database-provider';

// SQLite's LIKE comparison is case insensitive for ASCII text, whereas
// PostgreSQL needs an explicit insensitive filter. Prisma does not accept
// `mode` in queries generated from a SQLite schema.
export function containsInsensitive(value: string) {
  return isSqliteDatabase()
    ? { contains: value }
    : { contains: value, mode: 'insensitive' as const };
}

// SQLite's email column has COLLATE NOCASE in the tracked migration, including
// its unique constraint. Equality consequently handles legacy mixed-case rows
// and concurrent registrations with the same semantics as PostgreSQL's filter.
export function emailEqualsInsensitive(email: string) {
  return isSqliteDatabase()
    ? { email: { equals: email } }
    : { email: { equals: email, mode: 'insensitive' as const } };
}
