/** @jest-environment node */
import { GET as listUsers } from '@/app/api/admin/users/route';
import { GET as getUser } from '@/app/api/admin/users/[id]/route';
import { GET as getDashboard } from '@/app/api/admin/dashboard-stats/route';
import { authOptions } from '@/app/api/auth/[...nextauth]/options';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getServerSession as getNextSession } from 'next-auth/next';
import { rmSync } from 'node:fs';
import { Prisma } from '@prisma/client';

jest.mock('next/server', () => ({
  NextResponse: class extends Response {
    static json(value: unknown, init?: ResponseInit) { return new Response(JSON.stringify(value), init); }
  },
}));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/prisma', () => {
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaClient } = jest.requireActual('@prisma/client');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync(join(tmpdir(), 'forge-admin-directory-'));
  const path = join(directory, 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  const client = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${path}` }),
    log: [{ emit: 'event', level: 'query' }],
  });
  const queries: string[] = [];
  client.$on('query', (event: { query: string }) => queries.push(event.query));
  return { __esModule: true, __tempDirectory: directory, __databasePath: path, __queries: queries, default: client };
});

const queries: string[] = jest.requireMock('@/lib/prisma').__queries;
type ReadWork = (tx: Prisma.TransactionClient) => Promise<unknown>;
const conflict = () => new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
const request = () => new Request('http://localhost/api/admin/users') as never;
const routes = [
  { name: 'user list', read: () => listUsers(request()), deniedStatus: 403, deniedError: 'Keine Administratorrechte' },
  { name: 'user detail', read: () => getUser(request(), { params: Promise.resolve({ id: 'member' }) }), deniedStatus: 401, deniedError: 'Nicht autorisiert' },
  { name: 'dashboard', read: () => getDashboard(), deniedStatus: 401, deniedError: 'Unauthorized' },
];

// Exercise the real JWT/session callbacks. The only replaced auth boundary is
// the HTTP session wrapper, allowing a deterministic commit after validation.
async function currentSession(id = 'admin') {
  const token = await authOptions.callbacks!.jwt!({
    token: { id, sub: id, authProvider: 'oauth' },
  } as never);
  return authOptions.callbacks!.session!({ session: { user: {}, expires: '2099-01-01' }, token } as never);
}

function sessionImplementation(load: () => Promise<unknown>) {
  jest.mocked(getServerSession).mockImplementation(load as never);
  jest.mocked(getNextSession).mockImplementation(load as never);
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN', name: 'Admin' },
    { id: 'other-admin', email: 'other-admin@example.invalid', role: 'ADMIN', name: 'Other admin' },
    { id: 'member', email: 'private-member@example.invalid', role: 'USER', name: 'Member', contact: 'Private contact',
      password: 'private-hash', verificationToken: 'private-verification', resetPasswordToken: 'private-reset' },
  ] });
  await prisma.userSettings.create({ data: { userId: 'member', language: 'de', theme: 'DARK', emailNotifications: false } });
  await prisma.post.create({ data: { title: 'Member post', content: 'Activity', authorId: 'member' } });
  await prisma.course.create({ data: { title: 'Member course', description: 'Activity', instructorId: 'member' } });
  sessionImplementation(() => currentSession());
  queries.length = 0;
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(jest.requireMock('@/lib/prisma').__tempDirectory, { recursive: true, force: true });
});

describe.each(routes)('$name authorization', route => {
  test.each(['demotion', 'deletion'])('rejects %s committed after real session validation, before sensitive reads', async change => {
    sessionImplementation(async () => {
      const session = await currentSession();
      expect(session).toMatchObject({ user: { id: 'admin', role: 'ADMIN' } });
      if (change === 'demotion') await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
      else await prisma.user.delete({ where: { id: 'admin' } });
      queries.length = 0;
      return session;
    });

    const response = await route.read();
    const body = await response.json();
    // On the unpatched routes, all six revocation cases return this private email.
    if (response.status === 200) expect(JSON.stringify(body)).toContain('private-member@example.invalid');
    expect(response.status).toBe(route.deniedStatus);
    expect(body).toEqual({ error: route.deniedError });
    // Denial fetches only the actor's current role, never directory or activity.
    const reads = queries.filter(query => /^SELECT\b/i.test(query));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('`User`.`role`');
    expect(reads[0]).not.toMatch(/`(email|contact|password|UserSettings|Post|Course|Event)`/);
  });

  test.each(['USER', 'MODERATOR', 'INSTRUCTOR'])('keeps the existing denial for current %s sessions without route data reads', async role => {
    await prisma.user.update({ where: { id: 'admin' }, data: { role: role as 'USER' | 'MODERATOR' | 'INSTRUCTOR' } });
    sessionImplementation(async () => {
      const session = await currentSession();
      queries.length = 0;
      return session;
    });
    const response = await route.read();
    expect(response.status).toBe(route.deniedStatus);
    expect(await response.json()).toEqual({ error: route.deniedError });
    expect(queries).toEqual([]);
  });

  test('keeps the existing unauthenticated status without route data reads', async () => {
    sessionImplementation(async () => null);
    const response = await route.read();
    expect(response.status).toBe(401);
    expect(queries).toEqual([]);
  });

  test('preserves authorized response shape and sensitive fields without credential fields', async () => {
    const response = await route.read();
    expect(response.status).toBe(200);
    const body = await response.json();
    const encoded = JSON.stringify(body);
    expect(encoded).toContain('private-member@example.invalid');
    expect(encoded).not.toMatch(/private-hash|private-verification|private-reset/);
    if (route.name === 'user list') {
      expect(body).toHaveLength(3);
      expect(body.find((user: { id: string }) => user.id === 'member')).toMatchObject({
        email: 'private-member@example.invalid', contact: 'Private contact', skills: [],
        stats: { followersCount: 0, followingCount: 0 },
      });
    } else if (route.name === 'user detail') {
      expect(body).toMatchObject({ id: 'member', email: 'private-member@example.invalid', contact: 'Private contact',
        userSettings: { language: 'de', theme: 'DARK', emailNotifications: false }, badges: [], skills: [],
        stats: { postsCount: 1, commentsCount: 0, likesReceived: 0, coursesCount: 1, projectsCount: 0, endorsementsCount: 0 } });
      expect(body).not.toHaveProperty('posts');
      expect(body).not.toHaveProperty('courses');
    } else {
      expect(body).toMatchObject({ totalUsers: 3, totalPosts: 1, totalCourses: 1, totalEvents: 0 });
      expect(body.activities.map((activity: { type: string }) => activity.type).sort()).toEqual([
        'COURSE_CREATED', 'POST_CREATED', 'USER_REGISTERED', 'USER_REGISTERED', 'USER_REGISTERED',
      ]);
    }
  });

  test('reads one authorized snapshot even if another connection commits revocation and new data after its role read', async () => {
    const transact = prisma.$transaction.bind(prisma);
    let roleReads = 0;
    const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: ReadWork, options: object) =>
      transact(async tx => {
        const user = new Proxy(tx.user, {
          get(target, property, receiver) {
            if (property !== 'findUnique') return Reflect.get(target, property, receiver);
            return async (args: Prisma.UserFindUniqueArgs) => {
              const actor = await target.findUnique(args);
              if (args.where.id === 'admin' && args.select?.role) {
                roleReads++;
                const Database = jest.requireActual('better-sqlite3');
                const writer = new Database(jest.requireMock('@/lib/prisma').__databasePath);
                try {
                  writer.exec(`PRAGMA foreign_keys = ON; BEGIN;
                    UPDATE "User" SET role = 'USER' WHERE id = 'admin';
                    UPDATE "User" SET email = 'after-revocation@example.invalid', contact = 'After revocation' WHERE id = 'member';
                    UPDATE "UserSettings" SET language = 'fr' WHERE userId = 'member';
                    INSERT INTO "User" (id, email, updatedAt) VALUES ('new-member', 'new-member@example.invalid', CURRENT_TIMESTAMP);
                    INSERT INTO "Post" (id, title, content, authorId, updatedAt) VALUES ('new-post', 'New', 'New', 'member', CURRENT_TIMESTAMP);
                    INSERT INTO "Course" (id, title, description, instructorId, updatedAt) VALUES ('new-course', 'New', 'New', 'member', CURRENT_TIMESTAMP);
                    INSERT INTO "Event" (id, title, description, date, location, category, startTime, endTime, updatedAt)
                      VALUES ('new-event', 'New', 'New', CURRENT_TIMESTAMP, 'Online', 'Community', '12:00', '13:00', CURRENT_TIMESTAMP);
                    COMMIT;`);
                } finally { writer.close(); }
              }
              return actor;
            };
          },
        });
        return work(new Proxy(tx, { get: (target, property, receiver) =>
          property === 'user' ? user : Reflect.get(target, property, receiver) }));
      }, options)) as never);

    const response = await route.read();
    expect(response.status).toBe(200);
    expect(roleReads).toBe(1);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain('private-member@example.invalid');
    expect(JSON.stringify(body)).not.toMatch(/after-revocation|After revocation|new-member/);
    if (route.name === 'user list') expect(body).toHaveLength(3);
    if (route.name === 'user detail') expect(body).toMatchObject({ userSettings: { language: 'de' }, stats: { postsCount: 1, coursesCount: 1 } });
    if (route.name === 'dashboard') expect(body).toMatchObject({ totalUsers: 3, totalPosts: 1, totalCourses: 1, totalEvents: 0 });
    expect(transactions).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(await prisma.user.findUnique({ where: { id: 'admin' }, select: { role: true } })).toEqual({ role: 'USER' });
    expect(await prisma.user.findUnique({ where: { id: 'member' }, select: { email: true } })).toEqual({ email: 'after-revocation@example.invalid' });
  });

  test.each(['demotion', 'deletion'])('rechecks authority after a serialization conflict and committed %s', async change => {
    const transact = prisma.$transaction.bind(prisma);
    const transactions = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: ReadWork, options: object) => {
      try {
        return await transact(async tx => { await work(tx); throw conflict(); }, options);
      } catch (error) {
        if (change === 'demotion') await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
        else await prisma.user.delete({ where: { id: 'admin' } });
        queries.length = 0;
        throw error;
      }
    }) as never);
    const response = await route.read();
    expect(response.status).toBe(route.deniedStatus);
    expect(await response.json()).toEqual({ error: route.deniedError });
    expect(transactions).toHaveBeenCalledTimes(2);
    for (const [, options] of transactions.mock.calls) expect(options).toEqual({ isolationLevel: 'Serializable' });
    expect(queries.filter(query => /^SELECT\b/i.test(query))).toHaveLength(1);
  });

  test('retries a serialization conflict successfully for a still-authorized administrator', async () => {
    const transact = prisma.$transaction.bind(prisma);
    const transactions = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (work: ReadWork, options: object) =>
      transact(async tx => { await work(tx); throw conflict(); }, options)) as never);
    const response = await route.read();
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain('private-member@example.invalid');
    expect(transactions).toHaveBeenCalledTimes(2);
  });

  test.each([
    { name: 'exhausted serialization conflicts', error: conflict(), attempts: 4 },
    { name: 'unrelated known errors', error: new Prisma.PrismaClientKnownRequestError('Unrelated', { code: 'P2028', clientVersion: '7.10.0' }), attempts: 1 },
    { name: 'lookalike serialization errors', error: { code: 'P2034' }, attempts: 1 },
  ])('retains the 500 response for $name without exposing previously read data', async ({ error, attempts }) => {
    const transact = prisma.$transaction.bind(prisma);
    const transactions = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: ReadWork, options: object) =>
      transact(async tx => { await work(tx); throw error; }, options)) as never);
    const response = await route.read();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: route.name === 'user list' ? 'Fehler beim Abrufen der Benutzer' :
      route.name === 'user detail' ? 'Fehler beim Abrufen des Benutzers' : 'Internal Server Error' });
    expect(transactions).toHaveBeenCalledTimes(attempts);
  });
});

test('preserves the authorized detail 404, while a revoked administrator cannot probe missing users', async () => {
  const missing = () => getUser(request(), { params: Promise.resolve({ id: 'missing' }) });
  const response = await missing();
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: 'Benutzer nicht gefunden' });
  sessionImplementation(async () => {
    const session = await currentSession();
    await prisma.user.update({ where: { id: 'admin' }, data: { role: 'USER' } });
    return session;
  });
  expect((await missing()).status).toBe(401);
});
