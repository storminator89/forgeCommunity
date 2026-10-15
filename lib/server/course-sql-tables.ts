import { Prisma } from '@prisma/client';
import { getDatabaseProvider, getPostgresqlSchema } from '@/lib/database-provider';

const COURSE_SQL_TABLES = {
  AssignmentSubmission: '"AssignmentSubmission"',
  AssignmentGradeDecision: '"AssignmentGradeDecision"',
  Enrollment: '"Enrollment"',
} as const;
type CourseSqlTable = keyof typeof COURSE_SQL_TABLES;

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/** Raw SQL inherits connection search_path, but not PrismaPg's schema option. */
export function courseSqlTable(table: CourseSqlTable): Prisma.Sql {
  const name = COURSE_SQL_TABLES[table];
  if (!name) throw new Error('Unsupported course SQL table.');
  if (getDatabaseProvider() === 'sqlite') return Prisma.raw(name);
  // Only the configured database schema becomes SQL syntax, and it is always
  // quoted as one identifier. With no ?schema=, preserve the connection's
  // search_path just as PrismaPg does. Caller values remain bound parameters.
  const schema = getPostgresqlSchema();
  return Prisma.raw(schema ? `${quotedIdentifier(schema)}.${name}` : name);
}
