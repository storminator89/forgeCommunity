/** @jest-environment node */
import { getPostgresqlSchema } from '@/lib/database-provider';
import { courseSqlTable } from '@/lib/server/course-sql-tables';

const originalProvider = process.env.DATABASE_PROVIDER;
const originalUrl = process.env.DATABASE_URL;

afterEach(() => {
  if (originalProvider === undefined) delete process.env.DATABASE_PROVIDER;
  else process.env.DATABASE_PROVIDER = originalProvider;
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
});

test('SQLite raw table identifiers stay unqualified', () => {
  process.env.DATABASE_PROVIDER = 'sqlite';
  expect(courseSqlTable('AssignmentSubmission').strings).toEqual(['"AssignmentSubmission"']);
  expect(courseSqlTable('Course').strings).toEqual(['"Course"']);
});

test('PG raw tables use exactly the adapter schema, even with identifier punctuation', () => {
  process.env.DATABASE_PROVIDER = 'postgresql';
  process.env.DATABASE_URL = 'postgresql://localhost/forge?schema=' + encodeURIComponent('other".public;--');
  const schema = getPostgresqlSchema();
  expect(schema).toBe('other".public;--');
  const table = courseSqlTable('AssignmentGradeDecision');
  expect(table.strings).toEqual(['"other"".public;--"."AssignmentGradeDecision"']);
  expect(courseSqlTable('Course').strings).toEqual(['"other"".public;--"."Course"']);
  expect(table.values).toEqual([]);
  process.env.DATABASE_URL = 'postgresql://localhost/forge';
  expect(getPostgresqlSchema()).toBeNull();
  expect(courseSqlTable('Enrollment').strings).toEqual(['"Enrollment"']);
  process.env.DATABASE_URL = 'postgresql://localhost/forge?schema=public';
  expect(courseSqlTable('Enrollment').strings).toEqual(['"public"."Enrollment"']);
});

test('PG rejects empty and ambiguous schema names without echoing the URL', () => {
  for (const schema of ['', 'a'.repeat(64), 'has\0nul']) {
    const url = 'postgresql://secret@localhost/forge?schema=' + encodeURIComponent(schema);
    process.env.DATABASE_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = url;
    expect(() => getPostgresqlSchema()).toThrow('PostgreSQL DATABASE_URL has an invalid schema name.');
    expect(() => courseSqlTable('Enrollment')).toThrow('PostgreSQL DATABASE_URL has an invalid schema name.');
  }
});
