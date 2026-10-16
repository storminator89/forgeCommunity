/** @jest-environment node */

import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { GET as listMissions, POST as createMission } from '@/app/api/spaces/[spaceId]/missions/route';
import { GET as readMission, PATCH as closeMission } from '@/app/api/spaces/[spaceId]/missions/[missionId]/route';
import { POST as joinMission, DELETE as leaveMission } from '@/app/api/spaces/[spaceId]/missions/[missionId]/participation/route';
import { DELETE as removeMember } from '@/app/api/spaces/[spaceId]/members/[userId]/route';
import { POST as contribute } from '@/app/api/spaces/[spaceId]/missions/[missionId]/contributions/route';
import { DELETE as withdraw } from '@/app/api/spaces/[spaceId]/missions/[missionId]/contributions/[contributionId]/route';
import { PATCH as moderate } from '@/app/api/spaces/[spaceId]/missions/[missionId]/contributions/[contributionId]/moderation/route';
import { GET as audit } from '@/app/api/spaces/[spaceId]/missions/[missionId]/contributions/moderation/route';
import { POST as report, GET as listReports } from '@/app/api/reports/route';
import { PATCH as reviewReport } from '@/app/api/reports/[reportId]/route';
import { PUT as updateAccount } from '@/app/api/admin/users/[id]/route';

jest.setTimeout(30000);
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/app/api/auth/[...nextauth]/options', () => ({ authOptions: {} }));
jest.mock('@/lib/server/sanitize-html', () => ({
  sanitizeTextServer: (value: string) => value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(),
  sanitizeHtmlPreviewServer: (value: string, limit = 240) => value.replace(/<[^>]*>/g, '').slice(0, limit),
}));
jest.mock('@/lib/prisma', () => {
  const { PrismaClient } = jest.requireActual('@prisma/client');
  if (process.env.SPACE_MISSIONS_POSTGRESQL_DISPOSABLE === '1') {
    const { missionTestDatabaseUrl } = require('../../scripts/space-mission-test-database.cjs');
    const validatedUrl = missionTestDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER);
    const { randomUUID } = require('node:crypto');
    const { spawnSync } = require('node:child_process');
    const { Client } = require('pg');
    const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
    const schema = `forge_mission_${randomUUID().replaceAll('-', '_')}`;
    const scopedUrl = new URL(validatedUrl); scopedUrl.searchParams.set('schema', schema);
    const runtime = new PrismaClient({ adapter: new PrismaPg({ connectionString: validatedUrl }, { schema }) });
    return { __esModule: true, default: runtime,
      __initialize: async () => {
        const db = new Client({ connectionString: validatedUrl }); await db.connect();
        try { await db.query(`CREATE SCHEMA "${schema}"`); } finally { await db.end(); }
        const result = spawnSync(process.execPath, ['scripts/db-deploy.mjs', '--initialize-empty-schema'], {
          cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
          env: { ...process.env, DATABASE_PROVIDER: 'postgresql', DATABASE_URL: scopedUrl.toString() },
        });
        if (result.status !== 0) throw new Error(`Mission PostgreSQL deployment failed: ${result.error?.message ?? result.stderr}`);
      },
      __finalize: async () => {
        const db = new Client({ connectionString: validatedUrl }); await db.connect();
        try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); }
      },
    };
  }
  const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const path = join(mkdtempSync(join(tmpdir(), 'forge-space-missions-')), 'test.db');
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = join(process.cwd(), 'prisma', 'sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) {
      db.exec(readFileSync(join(migrations, name), 'utf8'));
    }
  } finally { db.close(); }
  return { __esModule: true, default: new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }) }) };
});

const session = (id: string | null = 'admin', role = 'ADMIN') =>
  jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
const request = (method: string, body?: object, path = '/api/spaces/private/missions', headers = {}) => new Request(`http://localhost${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
}) as never;
const space = (spaceId = 'private') => ({ params: Promise.resolve({ spaceId }) });
const mission = (missionId: string, spaceId = 'private') => ({ params: Promise.resolve({ spaceId, missionId }) });
const input = (requestId = 'create-one') => ({ title: 'Teach-back relay', prompt: 'Share a useful insight about this topic.', requestId });
const join = (id: string, expectedEpoch = 0) => joinMission(request('POST', { expectedEpoch }), mission(id));
const leave = (id: string, epoch = 1) => leaveMission(request('DELETE', { epoch }), mission(id));
const read = (id: string, spaceId = 'private') => readMission(request('GET'), mission(id, spaceId));
const contribution = (missionId: string, contributionId: string, spaceId = 'private') => ({ params: Promise.resolve({ spaceId, missionId, contributionId }) });
const postInput = (requestId = 'insight', kind: 'INSIGHT' | 'BUILD_ON' = 'INSIGHT', targetContributionId: string | null = null, epoch = 1) =>
  ({ kind, content: 'A specific insight that we can build on.', epoch, requestId, targetContributionId });
const post = (id: string, body = postInput()) => contribute(request('POST', body), mission(id));
const withdrawPost = (id: string, contributionId: string, epoch = 1) => withdraw(request('DELETE', { epoch }), contribution(id, contributionId));
const moderatePost = (id: string, contributionId: string, hidden = true) => moderate(request('PATCH', { hidden }), contribution(id, contributionId));
const create = async (body = input()) => {
  const response = await createMission(request('POST', body), space());
  expect(response.status).toBe(201);
  return response.json();
};
const conflict = () => new Prisma.PrismaClientKnownRequestError('Serialization conflict', { code: 'P2034', clientVersion: '7.10.0' });
type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;

beforeAll(async () => { await jest.requireMock('@/lib/prisma').__initialize?.(); }, 120000);
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.contentReport.deleteMany();
  await prisma.spaceMission.deleteMany();
  await prisma.spaceMember.deleteMany();
  await prisma.space.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN', name: 'Admin' },
    { id: 'admin2', email: 'admin2@example.invalid', role: 'ADMIN' },
    { id: 'moderator', email: 'mod@example.invalid', role: 'MODERATOR' },
    { id: 'instructor', email: 'instructor@example.invalid', role: 'INSTRUCTOR' },
    { id: 'outsider', email: 'outsider@example.invalid', role: 'USER' },
    ...Array.from({ length: 7 }, (_, i) => ({ id: `learner${i}`, email: `learner${i}@example.invalid`, role: 'USER' as const, name: `Learner ${i}` })),
  ] });
  await prisma.space.createMany({ data: [
    { id: 'private', name: 'Private', description: 'Private group', visibility: 'PRIVATE' },
    { id: 'other', name: 'Other', description: 'Other private group', visibility: 'PRIVATE' },
    { id: 'public', name: 'Public', description: 'Public group', visibility: 'PUBLIC' },
  ] });
  await prisma.spaceMember.createMany({ data: ['admin', 'moderator', 'instructor', ...Array.from({ length: 7 }, (_, i) => `learner${i}`)]
    .flatMap(userId => [{ spaceId: 'private', userId }, { spaceId: 'public', userId }]) });
  session();
});
afterAll(async () => { await prisma.$disconnect(); await jest.requireMock('@/lib/prisma').__finalize?.(); });

test('creates immutable sanitized mission text, scoped replay and one open mission', async () => {
  const first = await create({ ...input(), title: '  <b>Teach-back</b> relay ' });
  expect(first).toMatchObject({ title: 'Teach-back relay', creator: { id: 'admin', name: 'Admin' },
    participants: [], participantLimit: 5, participation: { epoch: 0, active: false }, canManage: true, canJoin: false });
  expect(first).not.toHaveProperty('requestId');
  expect(first).not.toHaveProperty('payloadDigest');
  expect(JSON.stringify(first)).not.toMatch(/email|password|completed|grade|reward/i);
  const replay = await createMission(request('POST', input()), space());
  expect(replay.status).toBe(200);
  expect((await replay.json()).id).toBe(first.id);
  expect((await createMission(request('POST', { ...input(), prompt: 'A changed request payload.' }), space())).status).toBe(409);
  expect((await createMission(request('POST', input('another')), space())).status).toBe(409);
  session('admin2');
  expect((await createMission(request('POST', input()), space())).status).toBe(409);
  expect(await prisma.spaceMission.count()).toBe(1);
});

test.each(['outsider', 'missing', 'learner0', 'moderator', 'instructor'])('current account %s cannot create despite stale ADMIN claims', async id => {
  session(id);
  expect((await createMission(request('POST', input()), space())).status).toBe(id === 'outsider' || id === 'missing' ? 404 : 403);
  expect(await prisma.spaceMission.count()).toBe(0);
});

test.each(['public', 'missing'])('missions are unavailable in %s Spaces, including to admins', async spaceId => {
  expect((await listMissions(request('GET'), space(spaceId))).status).toBe(404);
  expect((await createMission(request('POST', input()), space(spaceId))).status).toBe(404);
});

test('anonymous, nonmember, removed and deleted callers cannot infer missions or cursors', async () => {
  const item = await create();
  session(null);
  expect((await read(item.id)).status).toBe(401);
  expect((await listMissions(request('GET'), space())).status).toBe(401);
  for (const id of ['outsider', 'missing']) {
    session(id);
    const hidden = await read(item.id);
    const missing = await read('missing');
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual(await missing.json());
    expect(hidden.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await listMissions(request('GET', undefined, '/api/spaces/private/missions?cursor=bad'), space())).status).toBe(404);
    expect((await join(item.id)).status).toBe(404);
  }
  session('learner0');
  expect((await read(item.id, 'other')).status).toBe(404);
  await prisma.spaceMember.delete({ where: { spaceId_userId: { spaceId: 'private', userId: 'learner0' } } });
  expect((await read(item.id)).status).toBe(404);
  await prisma.user.delete({ where: { id: 'admin' } });
  session('admin');
  expect((await read(item.id)).status).toBe(404);
});

test('joins and leaves only the caller, with idempotent epochs and stale-action protection', async () => {
  const item = await create();
  session('learner0');
  const joined = await join(item.id);
  expect(joined.status).toBe(200);
  expect(await joined.json()).toMatchObject({ participants: [{ id: 'learner0', name: 'Learner 0' }], participation: { epoch: 1, active: true }, canJoin: false });
  expect((await join(item.id)).status).toBe(200);
  expect((await join(item.id, 1)).status).toBe(409);
  expect((await leave(item.id)).status).toBe(200);
  expect((await leave(item.id)).status).toBe(200);
  expect((await join(item.id)).status).toBe(409);
  expect((await join(item.id, 1)).status).toBe(200);
  expect((await leave(item.id)).status).toBe(409);
  expect((await read(item.id).then(r => r.json())).participation).toMatchObject({ epoch: 2, active: true });
  expect(await prisma.spaceMissionParticipation.count()).toBe(1);
});

test.each(['admin', 'admin2', 'moderator', 'instructor', 'outsider'])('%s cannot join on behalf of a learner or as an ineligible account', async id => {
  const item = await create();
  session(id, 'USER');
  expect((await join(item.id)).status).toBe(404);
  expect((await joinMission(request('POST', { expectedEpoch: 0, userId: 'learner0' }), mission(item.id))).status).toBe(400);
  expect(await prisma.spaceMissionParticipation.count()).toBe(0);
});

test('capacity fails closed for ineligible unrevoked consent without showing or crediting it', async () => {
  const item = await create();
  for (let i = 0; i < 5; i++) { session(`learner${i}`); expect((await join(item.id)).status).toBe(200); }
  session('learner5');
  expect((await join(item.id)).status).toBe(409);
  await prisma.user.update({ where: { id: 'learner0' }, data: { role: 'INSTRUCTOR' } });
  expect((await join(item.id)).status).toBe(409);
  const projected = await (await read(item.id)).json();
  expect(projected.participants).toHaveLength(4);
  expect(projected.participants.map((p: { id: string }) => p.id)).not.toContain('learner0');
  expect(projected).not.toHaveProperty('completedAt');
  expect(projected.canJoin).toBe(false);
});

test('private member removal revokes consent atomically and re-add requires a fresh explicit join', async () => {
  const item = await create();
  session('learner0'); await join(item.id);
  session();
  expect((await removeMember(request('DELETE'), { params: Promise.resolve({ spaceId: 'private', userId: 'learner0' }) })).status).toBe(200);
  expect(await prisma.spaceMissionParticipation.findUnique({ where: { missionId_userId: { missionId: item.id, userId: 'learner0' } } })).toMatchObject({ epoch: 1, optedOutAt: expect.any(Date) });
  await prisma.spaceMember.create({ data: { spaceId: 'private', userId: 'learner0' } });
  session('learner0');
  expect((await read(item.id).then(r => r.json())).participation).toMatchObject({ epoch: 1, active: false });
  expect((await join(item.id)).status).toBe(409);
  expect((await join(item.id, 1)).status).toBe(200);
});

test('a failed membership-removal transaction cannot leave a partial opt-out', async () => {
  const item = await create();
  session('learner0'); await join(item.id);
  session();
  const transact = prisma.$transaction.bind(prisma);
  jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) =>
    transact(async tx => { await work(tx); throw new Error('rollback after member removal'); }, options as never)) as never);
  expect((await removeMember(request('DELETE'), { params: Promise.resolve({ spaceId: 'private', userId: 'learner0' }) })).status).toBe(500);
  expect(await prisma.spaceMember.count({ where: { spaceId: 'private', userId: 'learner0' } })).toBe(1);
  expect(await prisma.spaceMissionParticipation.findUnique({ where: { missionId_userId: { missionId: item.id, userId: 'learner0' } } })).toMatchObject({ optedOutAt: null });
});

test('close is admin-only/idempotent, blocks new joins, permits leave and a later new mission', async () => {
  const item = await create();
  session('learner0'); await join(item.id);
  expect((await closeMission(request('PATCH', { closed: true }), mission(item.id))).status).toBe(403);
  session();
  const closed = await closeMission(request('PATCH', { closed: true }), mission(item.id));
  expect(closed.status).toBe(200);
  const closedAt = (await closed.json()).closedAt;
  expect((await closeMission(request('PATCH', { closed: true }), mission(item.id)).then(r => r.json())).closedAt).toBe(closedAt);
  expect((await closeMission(request('PATCH', { closed: false }), mission(item.id))).status).toBe(400);
  await create(input('second-mission'));
  expect((await createMission(request('POST', input()), space()).then(r => r.json())).closedAt).toBe(closedAt);
  session('learner1'); expect((await join(item.id)).status).toBe(409);
  session('learner0'); expect((await leave(item.id)).status).toBe(200);
});

test('all mutation bodies use strict allowlists, bounded text and same-origin protection', async () => {
  for (const body of [ { ...input(), actorId: 'admin' }, { ...input(), completed: true }, { ...input(), title: 'x'.repeat(401) },
    { ...input(), prompt: '<b></b>' }, { ...input(), title: 3 }, { ...input(), requestId: '<script>' } ]) {
    expect((await createMission(request('POST', body), space())).status).toBe(400);
  }
  expect((await createMission(request('POST', input(), undefined, { Origin: 'https://evil.invalid' }), space())).status).toBe(403);
  const item = await create();
  session('learner0');
  for (const body of [{ expectedEpoch: -1 }, { expectedEpoch: 1.1 }, { expectedEpoch: '0' }, { expectedEpoch: 0, active: true }]) {
    expect((await joinMission(request('POST', body), mission(item.id))).status).toBe(400);
  }
  for (const handler of [joinMission, leaveMission]) {
    expect((await handler(request('POST', { expectedEpoch: 0 }, undefined, { 'sec-fetch-site': 'cross-site' }), mission(item.id))).status).toBe(403);
  }
  session();
  expect((await closeMission(request('PATCH', { closed: true }, undefined, { Origin: 'null' }), mission(item.id))).status).toBe(403);
});

test('keyset list is bounded, cursor-scoped, and current private access is checked before cursor parsing', async () => {
  await prisma.spaceMission.createMany({ data: Array.from({ length: 23 }, (_, i) => ({ id: `history${i.toString().padStart(2, '0')}`,
    spaceId: 'private', creatorId: 'admin', requestId: `history${i}`, payloadDigest: 'history', title: 'History', prompt: 'A past prompt',
    createdAt: new Date('2026-10-01'), closedAt: new Date('2026-10-02') })) });
  session('learner0');
  const first = await (await listMissions(request('GET'), space())).json();
  expect(first.items).toHaveLength(20);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await (await listMissions(request('GET', undefined, `/api/spaces/private/missions?cursor=${first.nextCursor}`), space())).json();
  expect(second.items).toHaveLength(3);
  expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map(i => i.id)).size).toBe(23);
  expect((await listMissions(request('GET', undefined, `/api/spaces/other/missions?cursor=${first.nextCursor}`), space('other'))).status).toBe(404);
  expect((await listMissions(request('GET', undefined, '/api/spaces/private/missions?cursor=invalid'), space())).status).toBe(400);
});

test('parallel creates converge to one open mission and same-key retries never disclose payload digests', async () => {
  const responses = await Promise.all(Array.from({ length: 3 }, () => createMission(request('POST', input()), space())));
  expect(responses.filter(r => r.status === 201)).toHaveLength(1);
  expect(responses.every(r => [200, 201, 409].includes(r.status))).toBe(true);
  expect(await prisma.spaceMission.count({ where: { closedAt: null } })).toBe(1);
  for (const response of responses.filter(r => r.ok)) expect(await response.json()).not.toHaveProperty('payloadDigest');
});

test('parallel joins never exceed five active participants', async () => {
  const item = await create();
  const results = await Promise.all(Array.from({ length: 7 }, (_, i) => {
    jest.mocked(getServerSession).mockResolvedValueOnce({ user: { id: `learner${i}`, role: 'ADMIN' } } as never);
    return join(item.id);
  }));
  expect(results.every(r => [200, 409].includes(r.status))).toBe(true);
  expect(await prisma.spaceMissionParticipation.count({ where: { optedOutAt: null } })).toBeLessThanOrEqual(5);
});

test('real database constraints reject a second open mission and invalid participation epochs', async () => {
  const item = await create();
  await expect(prisma.spaceMission.create({ data: { spaceId: 'private', requestId: 'second', payloadDigest: 'x', title: 'Second', prompt: 'Second' } })).rejects.toMatchObject({ code: 'P2002' });
  await expect(prisma.spaceMissionParticipation.create({ data: { missionId: item.id, userId: 'learner0', epoch: 0 } })).rejects.toThrow();
  await prisma.user.delete({ where: { id: 'admin' } });
  expect(await prisma.spaceMission.findUnique({ where: { id: item.id } })).toMatchObject({ creatorId: null });
});

test('serialization retry rereads membership and cannot revive revoked consent', async () => {
  const item = await create();
  session('learner0');
  const transact = prisma.$transaction.bind(prisma);
  let attempts = 0;
  const spy = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) => {
    if (++attempts !== 1) return transact(work, options as never);
    try { return await transact(async tx => { await work(tx); throw conflict(); }, options as never); }
    catch (error) {
      await prisma.spaceMember.delete({ where: { spaceId_userId: { spaceId: 'private', userId: 'learner0' } } });
      throw error;
    }
  }) as never);
  expect((await join(item.id)).status).toBe(404);
  expect(spy).toHaveBeenCalledTimes(2);
  expect(await prisma.spaceMissionParticipation.count()).toBe(0);
});

async function makeRelay() {
  const item = await create();
  session('learner0'); await join(item.id);
  const first = await (await post(item.id)).json();
  const insight0 = first.contributions.find((row: { kind: string }) => row.kind === 'INSIGHT').id;
  session('learner1'); await join(item.id);
  const second = await (await post(item.id, postInput('insight-one'))).json();
  const insight1 = second.contributions.find((row: { author: { id: string }; kind: string }) => row.author.id === 'learner1' && row.kind === 'INSIGHT').id;
  const built = await (await post(item.id, postInput('build-one', 'BUILD_ON', insight0))).json();
  const buildOn = built.contributions.find((row: { kind: string }) => row.kind === 'BUILD_ON').id;
  return { id: item.id, insight0, insight1, buildOn, built };
}

test('two distinct insights plus a valid cross-person build-on derive reversible cooperation only', async () => {
  const { id, built } = await makeRelay();
  expect(built.progress).toEqual({ insightAuthors: 2, hasCrossPersonBuildOn: true, complete: true });
  expect(built.contributions).toHaveLength(3);
  expect(built.contributions.every((row: Record<string, unknown>) => !('epoch' in row) && !('requestId' in row) && !('payloadDigest' in row))).toBe(true);
  for (const table of [prisma.rewardLedger, prisma.learningGoal, prisma.enrollment, prisma.courseCompletionRecord, prisma.userBadge]) {
    expect(await (table.count as () => Promise<number>)()).toBe(0);
  }
  session('learner0'); await leave(id);
  const afterLeave = await (await read(id)).json();
  expect(afterLeave.progress).toEqual({ insightAuthors: 1, hasCrossPersonBuildOn: false, complete: false });
  expect(afterLeave.contributions.map((row: { id: string }) => row.id)).toHaveLength(1);
  expect(afterLeave.ownContributions).toEqual([]);
  await join(id, 1);
  const afterRejoin = await (await read(id)).json();
  expect(afterRejoin.participation).toMatchObject({ epoch: 2, active: true });
  expect(afterRejoin.progress.complete).toBe(false);
  expect(afterRejoin.ownContributions).toEqual([]);
  expect((await post(id, postInput())).status).toBe(409);
  expect((await post(id, postInput('new-epoch-insight', 'INSIGHT', null, 2))).status).toBe(201);
});

test('one insight with cross-person interaction cannot complete the relay', async () => {
  const item = await create();
  session('learner0'); await join(item.id);
  const first = await (await post(item.id)).json();
  session('learner1'); await join(item.id);
  const built = await (await post(item.id, postInput('build-only', 'BUILD_ON', first.contributions[0].id))).json();
  expect(built.progress).toEqual({ insightAuthors: 1, hasCrossPersonBuildOn: true, complete: false });
});

test('moderator hide reverses progress; restore works, withdrawal always wins and invalidated build-ons remain withdrawable', async () => {
  const relay = await makeRelay();
  session();
  expect((await moderatePost(relay.id, relay.insight0)).status).toBe(200);
  let detail = await (await read(relay.id)).json();
  expect(detail.progress.complete).toBe(false);
  expect(detail.contributions.map((r: { id: string }) => r.id)).not.toContain(relay.buildOn);
  expect((await moderatePost(relay.id, relay.insight0, false)).status).toBe(200);
  expect((await read(relay.id).then(r => r.json())).progress.complete).toBe(true);
  session('learner0');
  expect((await withdrawPost(relay.id, relay.insight0)).status).toBe(200);
  expect((await withdrawPost(relay.id, relay.insight0)).status).toBe(200);
  session('learner1');
  detail = await (await read(relay.id)).json();
  expect(detail.progress.complete).toBe(false);
  expect(detail.ownContributions).toContainEqual({ id: relay.buildOn, kind: 'BUILD_ON', hidden: false, targetUnavailable: true, canWithdraw: true });
  expect((await withdrawPost(relay.id, relay.buildOn)).status).toBe(200);
  session();
  expect((await moderatePost(relay.id, relay.insight0)).status).toBe(200);
  expect((await moderatePost(relay.id, relay.insight0, false)).status).toBe(200);
  detail = await (await read(relay.id)).json();
  expect(detail.contributions.map((r: { id: string }) => r.id)).not.toContain(relay.insight0);
  expect(detail.progress.complete).toBe(false);
  const evidence = await (await audit(request('GET'), mission(relay.id))).json();
  expect(evidence.items.find((r: { id: string }) => r.id === relay.insight0)).toMatchObject({ withdrawnAt: expect.any(String), hiddenAt: null });
});

test('contribution request replay is digest-bound, epoch-bound, visible and lifetime-capped', async () => {
  const item = await create();
  session('learner0'); await join(item.id);
  expect((await post(item.id)).status).toBe(201);
  expect((await post(item.id)).status).toBe(200);
  expect((await post(item.id, { ...postInput(), content: 'A changed insight under the same key.' })).status).toBe(409);
  expect((await post(item.id, postInput('duplicate-kind'))).status).toBe(409);
  for (let i = 0; i < 5; i++) {
    const current = await prisma.spaceMissionContribution.findFirstOrThrow({ where: { missionId: item.id, withdrawnAt: null } });
    expect((await withdrawPost(item.id, current.id)).status).toBe(200);
    if (i < 4) expect((await post(item.id, postInput(`retry${i}`))).status).toBe(201);
  }
  expect((await post(item.id, postInput('over-lifetime-cap'))).status).toBe(409);
  expect((await post(item.id)).status).toBe(404);
  expect(await prisma.spaceMissionContribution.count()).toBe(5);
});

test('a hidden contribution permits replacement but cannot be restored over a live same-kind row', async () => {
  const item = await create();
  session('learner0'); await join(item.id);
  const first = await (await post(item.id)).json();
  const original = first.contributions[0].id;
  session(); await moderatePost(item.id, original);
  session('learner0'); expect((await post(item.id, postInput('replacement'))).status).toBe(201);
  expect((await post(item.id)).status).toBe(404);
  session(); expect((await moderatePost(item.id, original, false)).status).toBe(409);
  expect(await prisma.spaceMissionContribution.findUnique({ where: { id: original } })).toMatchObject({ hiddenAt: expect.any(Date) });
});

test('targets must be live other-person insights in the same private mission', async () => {
  const relay = await makeRelay();
  session('learner2'); await join(relay.id);
  for (const target of ['missing', relay.buildOn]) expect((await post(relay.id, postInput(`target-${target}`, 'BUILD_ON', target))).status).toBe(404);
  session('learner0');
  expect((await post(relay.id, postInput('self-build', 'BUILD_ON', relay.insight0))).status).toBe(404);
  session(); await moderatePost(relay.id, relay.insight1);
  session('learner2');
  expect((await post(relay.id, postInput('hidden-target', 'BUILD_ON', relay.insight1))).status).toBe(404);
  expect((await contribute(request('POST', postInput('wrong-mission', 'BUILD_ON', relay.insight0)), mission('missing'))).status).toBe(404);
});

test('learner content mutations are self-only, strictly shaped, no-store and same-origin', async () => {
  const relay = await makeRelay();
  session('learner0');
  expect((await withdrawPost(relay.id, relay.insight1)).status).toBe(404);
  expect((await withdrawPost(relay.id, relay.insight0, 2)).status).toBe(404);
  for (const body of [{ ...postInput(), completed: true }, { ...postInput(), actorId: 'learner1' },
    { ...postInput(), content: 'short' }, { ...postInput(), content: 'x'.repeat(8001) },
    { ...postInput(), targetContributionId: relay.insight1 }, { ...postInput(), kind: 'GRADE' }]) {
    expect((await contribute(request('POST', body), mission(relay.id))).status).toBe(400);
  }
  expect((await contribute(request('POST', postInput(), undefined, { Origin: 'https://evil.invalid' }), mission(relay.id))).status).toBe(403);
  expect((await withdraw(request('DELETE', { epoch: 1 }, undefined, { Origin: 'null' }), contribution(relay.id, relay.insight0))).status).toBe(403);
  session('moderator');
  expect((await moderatePost(relay.id, relay.insight0)).status).toBe(403);
  expect((await audit(request('GET'), mission(relay.id))).status).toBe(403);
  session();
  expect((await moderate(request('PATCH', { hidden: true }, undefined, { Origin: 'https://evil.invalid' }), contribution(relay.id, relay.insight0))).status).toBe(403);
  expect((await moderatePost(relay.id, relay.insight0)).headers.get('Cache-Control')).toBe('private, no-store');
});

test('mission reports stay private to current members/admins, retain withdrawn audit text and exclude ordinary moderators', async () => {
  const relay = await makeRelay();
  const body = { targetType: 'SPACE_MISSION_CONTRIBUTION', targetId: relay.insight0, reason: 'SPAM' };
  session('learner1');
  const created = await report(request('POST', body));
  expect(created.status).toBe(201);
  const reportId = (await created.json()).id;
  expect((await report(request('POST', body))).status).toBe(200);
  session('learner0');
  expect((await report(request('POST', body))).status).toBe(400);
  await withdrawPost(relay.id, relay.insight0);
  session('learner1'); expect((await report(request('POST', body))).status).toBe(404);
  session('outsider'); expect((await report(request('POST', body))).status).toBe(404);
  session('moderator');
  const moderatorQueue = await (await listReports(request('GET'))).json();
  expect(moderatorQueue).toMatchObject({ items: [], total: 0 });
  expect((await reviewReport(request('PATCH', { status: 'DISMISSED', resolutionNote: 'No violation found' }), { params: Promise.resolve({ reportId }) })).status).toBe(404);
  session();
  const queue = await (await listReports(request('GET'))).json();
  expect(queue.items).toContainEqual(expect.objectContaining({ id: reportId, scopeSpaceId: 'private', targetMissionId: relay.id,
    targetWithdrawn: true, targetAvailable: true, targetPreview: 'A specific insight that we can build on.' }));
  await prisma.contentReport.update({ where: { id: reportId }, data: { scopeSpaceId: 'other' } });
  const wrongScope = await (await listReports(request('GET'))).json();
  expect(wrongScope.items[0]).toMatchObject({ targetAvailable: false, targetPreview: null, targetMissionId: null });
});

test('official account role update revokes consent; promotion, replacement and return to USER cannot revive posts or exceed capacity', async () => {
  const relay = await makeRelay();
  for (let i = 2; i < 5; i++) { session(`learner${i}`); await join(relay.id); }
  session();
  const changeRole = (role: string) => updateAccount(request('PUT', { email: 'learner0@example.invalid', name: 'Learner 0', role }), { params: Promise.resolve({ id: 'learner0' }) });
  expect((await changeRole('INSTRUCTOR')).status).toBe(200);
  expect(await prisma.spaceMissionParticipation.findUnique({ where: { missionId_userId: { missionId: relay.id, userId: 'learner0' } } })).toMatchObject({ optedOutAt: expect.any(Date) });
  session('learner5'); expect((await join(relay.id)).status).toBe(200);
  session(); expect((await changeRole('USER')).status).toBe(200);
  session('learner0');
  const after = await (await read(relay.id)).json();
  expect(after.participation).toMatchObject({ epoch: 1, active: false });
  expect(after.progress.complete).toBe(false);
  expect(after.contributions.map((r: { id: string }) => r.id)).not.toContain(relay.insight0);
  expect((await join(relay.id, 1)).status).toBe(409);
  expect(await prisma.spaceMissionParticipation.count({ where: { missionId: relay.id, optedOutAt: null } })).toBe(5);
});

test('account erasure cascades contributions and invalidates dependent activity, retaining scoped report audit', async () => {
  const relay = await makeRelay();
  await prisma.contentReport.create({ data: { reporterId: 'learner1', targetType: 'SPACE_MISSION_CONTRIBUTION', targetId: relay.insight0, scopeSpaceId: 'private', reason: 'SPAM' } });
  await prisma.user.delete({ where: { id: 'learner0' } });
  session('learner1');
  const current = await (await read(relay.id)).json();
  expect(current.progress.complete).toBe(false);
  expect(current.contributions.map((r: { id: string }) => r.id)).toEqual([relay.insight1]);
  expect(await prisma.contentReport.count()).toBe(1);
});

test('parallel contribution retries converge and duplicate live phases are database-enforced', async () => {
  const item = await create();
  session('learner0'); await join(item.id);
  const responses = await Promise.all(Array.from({ length: 3 }, () => post(item.id)));
  expect(responses.filter(r => r.status === 201)).toHaveLength(1);
  expect(responses.every(r => [200, 201, 409].includes(r.status))).toBe(true);
  expect(await prisma.spaceMissionContribution.count()).toBe(1);
  await expect(prisma.spaceMissionContribution.create({ data: { missionId: item.id, authorId: 'learner0', epoch: 1, kind: 'INSIGHT',
    content: 'Competing direct contribution', requestId: 'direct', payloadDigest: 'direct' } })).rejects.toMatchObject({ code: 'P2002' });
});
