import { containsInsensitive, emailEqualsInsensitive } from '@/lib/server/database-query';

describe('provider-specific text filters', () => {
  const originalProvider = process.env.DATABASE_PROVIDER;

  afterAll(() => {
    if (originalProvider === undefined) delete process.env.DATABASE_PROVIDER;
    else process.env.DATABASE_PROVIDER = originalProvider;
  });

  it('uses PostgreSQL insensitive comparisons for existing installations', () => {
    process.env.DATABASE_PROVIDER = 'postgresql';
    expect(emailEqualsInsensitive('person@example.com')).toEqual({
      email: { equals: 'person@example.com', mode: 'insensitive' },
    });
    expect(containsInsensitive('FORGE')).toEqual({
      contains: 'FORGE', mode: 'insensitive',
    });
  });

  it('uses SQLite-compatible filters with email NOCASE collation', () => {
    process.env.DATABASE_PROVIDER = 'sqlite';
    expect(emailEqualsInsensitive('person@example.com')).toEqual({
      email: { equals: 'person@example.com' },
    });
    expect(containsInsensitive('FORGE')).toEqual({ contains: 'FORGE' });
  });
});
