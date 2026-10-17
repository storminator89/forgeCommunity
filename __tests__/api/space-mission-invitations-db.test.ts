/** @jest-environment node */

/** Real-adapter contract suite. Disposable fixtures apply the actual complete
 * numbered provider chain, including PR80 lesson context and invitations. No
 * external draft path or extra SQL is needed in ordinary CI. PostgreSQL remains
 * opt-in and restricted to a guarded local forge_test/random-schema fixture. */
import prisma from '@/lib/prisma';
import { invitationErrorResponse, reportInvitationFailure } from '@/lib/server/space-mission-invitation-errors';
import { SpaceApiError, spaceErrorResponse } from '@/lib/server/space-api';
import { InvalidJsonBodyError, InvalidPaginationError } from '@/lib/server/api-input';
import { RequestBodyLimitError } from '@/lib/server/request-body';
import { InvalidSpaceCursorError } from '@/lib/server/space-discussions';
import { Prisma, type PrismaClient } from '@prisma/client';
import { DriverAdapterError } from '@prisma/driver-adapter-utils';
import { createHmac } from 'node:crypto';
import { invitationTransaction } from '@/lib/server/space-mission-invitation-state';
import { getServerSession } from '@/lib/sites-auth/server';
import { readInvitationPreference, setInvitationPreference, invitationCandidates,
  parseInvitationSend, sendMissionInvitation, listMissionInvitations, readMissionInvitation,
  decideMissionInvitation, resolveMissionInvitationTargets } from '@/lib/server/space-mission-invitations';
import { createMission, parseMissionInput, setMissionParticipation, closeMission, readMission,
  contributeToMission, parseMissionContribution, withdrawMissionContribution, moderateMissionContribution } from '@/lib/server/space-missions';
import { resolveNotificationTarget, resolveNotificationTargets } from '@/lib/server/notification-target';
import { GET as getPreference, PUT as putPreference } from '@/app/api/space-missions/invitation-preference/route';
import { GET as getPending } from '@/app/api/space-missions/invitations/route';
import { GET as getCandidates } from '@/app/api/spaces/[spaceId]/missions/[missionId]/invitation-candidates/route';
import { POST as postInvitation } from '@/app/api/spaces/[spaceId]/missions/[missionId]/invitations/route';
import { GET as getInvitation } from '@/app/api/spaces/[spaceId]/missions/[missionId]/invitations/[invitationId]/route';
import { POST as postDecision } from '@/app/api/spaces/[spaceId]/missions/[missionId]/invitations/[invitationId]/decision/route';
import { DELETE as removeMember } from '@/app/api/spaces/[spaceId]/members/[userId]/route';
import { PUT as updateAccount, DELETE as eraseAccount } from '@/app/api/admin/users/[id]/route';
import type { SendMissionInvitation } from '@/types/space-mission-invitations';

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
  const { readFileSync, readdirSync, mkdtempSync, rmSync } = require('node:fs');
  const { join } = require('node:path');
  const queries: string[] = [];
  const observe = (runtime: any) => { runtime.$on('query', (event: { query: string }) => queries.push(event.query)); return runtime; };
  if (process.env.DATABASE_PROVIDER === 'postgresql') {
    if (process.env.SPACE_MISSIONS_POSTGRESQL_DISPOSABLE !== '1') throw Error('Explicit PostgreSQL disposable flag required.');
    const { missionTestDatabaseUrl } = require('../../scripts/space-mission-test-database.cjs');
    const url = missionTestDatabaseUrl(process.env.DATABASE_URL, process.env.DATABASE_PROVIDER);
    const { randomUUID } = require('node:crypto');
    const { Client } = require('pg');
    const { PrismaPg } = jest.requireActual('@prisma/adapter-pg');
    const { spawnSync } = require('node:child_process');
    const schema = `forge_invitation_${randomUUID().replaceAll('-', '_')}`;
    const scoped = new URL(url); scoped.searchParams.set('schema', schema);
    return { __esModule: true, default: observe(new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }), log: [{ emit: 'event', level: 'query' }] })), __queries: queries, __schema: schema,
      __newClient: () => new PrismaClient({ adapter: new PrismaPg({ connectionString: url }, { schema }) }),
      __initialize: async () => {
        const db = new Client({ connectionString: url }); await db.connect();
        try {
          await db.query(`CREATE SCHEMA "${schema}"`);
          const deployment = spawnSync(process.execPath, ['scripts/db-deploy.mjs', '--initialize-empty-schema'], {
            cwd: process.cwd(), encoding: 'utf8', timeout: 120000,
            env: { ...process.env, DATABASE_PROVIDER: 'postgresql', DATABASE_URL: scoped.toString() },
          });
          if (deployment.status !== 0) throw Error(`Disposable predecessor chain failed: ${deployment.error?.message ?? deployment.stderr}`);
          await db.query(`SET search_path TO "${schema}"`);
          const installed = await db.query(`SELECT to_regclass('"SpaceMissionInvitation"') AS invitation`);
          if (!installed.rows[0].invitation) throw Error('Numbered PostgreSQL invitation migration is missing.');
        } finally { await db.end(); }
      },
      __finalize: async () => {
        const db = new Client({ connectionString: url }); await db.connect();
        try { await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); } finally { await db.end(); }
      },
    };
  }
  if (process.env.DATABASE_PROVIDER && process.env.DATABASE_PROVIDER !== 'sqlite') throw Error('Unsupported invitation fixture provider.');
  const { DatabaseSync } = require('node:sqlite');
  const { PrismaBetterSqlite3 } = jest.requireActual('@prisma/adapter-better-sqlite3');
  const directory = mkdtempSync('/tmp/forge-invitation-fixture-');
  const path = join(directory, 'test.db'); const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA foreign_keys = ON'); db.exec('PRAGMA journal_mode = WAL');
    const migrations = join(process.cwd(), 'prisma/sqlite-migrations');
    for (const name of readdirSync(migrations).filter((name: string) => /^\d+_.*\.sql$/.test(name)).sort()) db.exec(readFileSync(join(migrations, name), 'utf8'));
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='SpaceMissionInvitation'").get()) throw Error('Numbered SQLite invitation migration is missing.');
    if (db.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw Error('Fixture FK enforcement missing');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Fixture FK violations');
  } finally { db.close(); }
  return { __esModule: true, default: observe(new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}`, timeout: 10 }), log: [{ emit: 'event', level: 'query' }] })), __queries: queries, __path: path,
    __newClient: () => new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}`, timeout: 10 }) }),
    __finalize: async () => rmSync(directory, { recursive: true, force: true }) };
});

const secret = 'synthetic-private-mission-invitation-test-secret-only';
const session = (id: string | null = 'admin', role = 'ADMIN') => jest.mocked(getServerSession).mockResolvedValue(id ? { user: { id, role } } as never : null);
const request = (method = 'GET', body?: object, path = '/api/space-missions/invitations', headers = {}) => new Request(`http://localhost${path}`, {
  method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}),
}) as never;
const context = (missionId: string, spaceId = 'private') => ({ params: Promise.resolve({ missionId, spaceId }) });
const detailContext = (missionId: string, invitationId: string, spaceId = 'private') => ({ params: Promise.resolve({ missionId, spaceId, invitationId }) });
const join = (missionId: string, userId: string, epoch = 0, spaceId = 'private') => setMissionParticipation(spaceId, missionId, userId, epoch, true);
const leave = (missionId: string, userId: string, epoch = 1, spaceId = 'private') => setMissionParticipation(spaceId, missionId, userId, epoch, false);
const mission = async (spaceId = 'private', requestId = 'create-one') => (await createMission(spaceId, 'admin', parseMissionInput({
  title: 'Private synthetic mission canary', prompt: 'Share an insight and build on a current peer insight.', requestId,
}))).item;
const enable = async (userId = 'learner1') => {
  const current = await readInvitationPreference(userId);
  return setInvitationPreference(userId, { enabled: true, expectedRevision: current.revision });
};
const candidate = (missionId: string, senderId = 'learner0', q = 'Learner', spaceId = 'private') =>
  invitationCandidates(spaceId, missionId, senderId, request('GET', undefined, `/?q=${encodeURIComponent(q)}`));
const sendInput = async (missionId: string, recipientId = 'learner1', requestId = 'invite-one', senderId = 'learner0', spaceId = 'private'): Promise<SendMissionInvitation> => {
  const candidates = await candidate(missionId, senderId, recipientId.replace('learner', 'Learner '), spaceId);
  const selected = candidates.items.find(item => item.user.id === recipientId);
  expect(selected).toBeDefined();
  return { recipientId, requestId, senderEpoch: candidates.senderEpoch, senderAccessEpoch: candidates.senderAccessEpoch, selection: selected!.selection };
};
const send = (missionId: string, body: SendMissionInvitation, senderId = 'learner0', spaceId = 'private') => sendMissionInvitation(spaceId, missionId, senderId, parseInvitationSend(body as unknown as Record<string, unknown>));
const pending = (userId = 'learner1') => listMissionInvitations(userId, request());
const delivered = async (recipientId = 'learner1') => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(recipientId);
  const body = await sendInput(m.id, recipientId); await send(m.id, body);
  const row = await prisma.spaceMissionInvitation.findFirstOrThrow({ where: { missionId: m.id, recipientId } });
  return { m, body, row };
};
const decision = (missionId: string, invitationId: string, decision: 'ACCEPT' | 'DECLINE' = 'ACCEPT', userId = 'learner1', expectedRevision = 1) =>
  decideMissionInvitation('private', missionId, invitationId, userId, { decision, expectedRevision });
const terminalFields = ['senderId', 'createdAt', 'expiresAt', 'senderEpoch', 'senderAccessEpoch', 'senderAccountEpoch',
  'recipientAccessEpoch', 'recipientAccountEpoch', 'recipientSettingRevision', 'recipientEpoch'] as const;
const assertTerminal = async (id: string, state: string) => {
  const row = await prisma.spaceMissionInvitation.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ state, revision: 2 });
  for (const field of terminalFields) expect(row[field]).toBeNull();
  expect(await prisma.notification.count({ where: { targetType: 'SPACE_MISSION_INVITATION', targetId: id } })).toBe(0);
  return row;
};
const remove = async (userId: string) => {
  session(); const response = await removeMember(request('DELETE'), { params: Promise.resolve({ spaceId: 'private', userId }) });
  expect(response.status).toBe(200);
};
const role = async (userId: string, value: string) => {
  session(); const response = await updateAccount(request('PUT', { email: `${userId}@example.test`, name: `Learner ${userId.replace('learner', '')}`, role: value }), { params: Promise.resolve({ id: userId }) });
  expect(response.status).toBe(200);
};
const erase = async (userId: string) => {
  session(); const response = await eraseAccount(request('DELETE'), { params: Promise.resolve({ id: userId }) });
  expect(response.status).toBe(200);
};

beforeAll(async () => { await jest.requireMock('@/lib/prisma').__initialize?.(); }, 120000);
beforeEach(async () => {
  jest.restoreAllMocks(); jest.clearAllMocks(); process.env.NEXTAUTH_SECRET = secret;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await prisma.notification.deleteMany(); await prisma.contentReport.deleteMany(); await prisma.spaceMission.deleteMany();
  await prisma.spaceMember.deleteMany(); await prisma.space.deleteMany(); await prisma.user.deleteMany();
  await prisma.user.createMany({ data: [
    { id: 'admin', email: 'admin@example.test', role: 'ADMIN', name: 'Admin' },
    { id: 'moderator', email: 'mod@example.test', role: 'MODERATOR', name: 'Moderator' },
    { id: 'instructor', email: 'instructor@example.test', role: 'INSTRUCTOR', name: 'Instructor' },
    { id: 'outsider', email: 'outsider@example.test', role: 'USER', name: 'Learner outsider' },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `learner${i}`, email: `learner${i}@example.test`, role: 'USER' as const, name: `Learner ${i}` })),
  ] });
  await prisma.space.createMany({ data: ['private', 'other', 'public'].map(id => ({ id, name: id, description: 'Synthetic isolated fixture', visibility: id === 'public' ? 'PUBLIC' as const : 'PRIVATE' as const })) });
  await prisma.spaceMember.createMany({ data: ['admin', 'moderator', 'instructor', ...Array.from({ length: 9 }, (_, i) => `learner${i}`)]
    .flatMap(userId => [{ spaceId: 'private', userId }, { spaceId: 'public', userId }]) });
  session();
});
afterAll(async () => { await prisma.$disconnect(); await jest.requireMock('@/lib/prisma').__finalize?.(); });

test('quiet control defaults off and authorized GET/candidate issuance are write-free with fresh canonical nonces', async () => {
  const m = await mission(); await join(m.id, 'learner0');
  expect(await readInvitationPreference('learner1')).toEqual({ enabled: false, revision: 0 });
  const first = await candidate(m.id); const second = await candidate(m.id);
  expect(first.items.map(item => item.user.id)).toEqual(second.items.map(item => item.user.id));
  expect(first.items).toHaveLength(8);
  for (let i = 0; i < first.items.length; i++) {
    expect(Object.keys(first.items[i].user).sort()).toEqual(['id', 'image', 'name']);
    expect(Buffer.from(first.items[i].selection.nonce, 'base64url')).toHaveLength(16);
    expect(first.items[i].selection.nonce).not.toBe(second.items[i].selection.nonce);
    expect(first.items[i].selection.token).not.toBe(second.items[i].selection.token);
  }
  expect(await prisma.spaceMissionInvitationSetting.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationAccess.count()).toBe(0);
  await enable();
  expect((await candidate(m.id)).items.map(item => item.user.id)).toEqual(first.items.map(item => item.user.id));
});

test('default-off stores only bounded sender receipt and generic acknowledgment; old retry never delivers after opt-in', async () => {
  const m = await mission(); await join(m.id, 'learner0'); const old = await sendInput(m.id);
  expect(await send(m.id, old)).toEqual({ requestId: old.requestId, processed: true });
  expect(await prisma.spaceMissionInvitation.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionParticipation.count()).toBe(1);
  const receipt = await prisma.spaceMissionInvitationRequest.findFirstOrThrow();
  expect(Object.keys(receipt).sort()).toEqual(['missionId', 'payloadDigest', 'requestId', 'senderId']);
  expect(receipt.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
  await enable(); expect(await send(m.id, old)).toEqual({ requestId: old.requestId, processed: true });
  expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  const fresh = await sendInput(m.id, 'learner1', 'explicit-new');
  expect(await send(m.id, fresh)).toEqual({ requestId: 'explicit-new', processed: true });
  expect(await prisma.spaceMissionInvitation.count()).toBe(1);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 2 });
});

test('delivery, invalid target, already delivered and changed-token suppression have exactly the same sender shape', async () => {
  const { m, body } = await delivered();
  for (const extra of [body, { ...body, recipientId: 'missing', requestId: 'missing-target' },
    { ...body, recipientId: 'outsider', requestId: 'outsider-target' }, { ...body, requestId: 'delivered-again' }]) {
    expect(await send(m.id, extra)).toEqual({ requestId: extra.requestId, processed: true });
  }
  const row = await prisma.spaceMissionInvitation.findFirstOrThrow();
  const notice = await prisma.notification.findFirstOrThrow();
  expect(notice).toMatchObject({ userId: 'learner1', type: 'SYSTEM', targetType: 'SPACE_MISSION_INVITATION', targetId: row.id,
    content: 'Du hast eine Einladung zu einer Space-Mission.' });
  expect(await prisma.notification.count()).toBe(1);
  expect(row.expiresAt!.getTime() - row.createdAt!.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
});

test('same receipt permits exact replay only and no changed recipient/nonce can reuse its identity', async () => {
  const { m, body } = await delivered();
  await expect(send(m.id, { ...body, recipientId: 'learner2' })).rejects.toMatchObject({ status: 409 });
  const changed = { ...body, selection: { ...body.selection, nonce: Buffer.alloc(16, 7).toString('base64url') } };
  await expect(send(m.id, changed)).rejects.toMatchObject({ status: 409 });
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 1 });
});

test('recipient list/detail and both inbox resolvers are self-only, read-only, and reveal no receipt or email', async () => {
  const { m, row } = await delivered();
  expect((await pending()).items).toHaveLength(1);
  expect(await pending('learner2')).toEqual({ items: [], nextCursor: null });
  for (const user of ['learner0', 'learner2', 'admin', 'moderator', 'instructor', 'outsider']) {
    await expect(readMissionInvitation('private', m.id, row.id, user)).rejects.toMatchObject({ status: 404 });
    expect((await resolveMissionInvitationTargets([row.id], user)).size).toBe(0);
    await expect(decision(m.id, row.id, 'ACCEPT', user)).rejects.toMatchObject({ status: 404 });
  }
  const detail = await readMissionInvitation('private', m.id, row.id, 'learner1');
  expect(detail).toMatchObject({ state: 'PENDING', invitation: { id: row.id, canAccept: true, unavailableReason: null, sender: { id: 'learner0' } } });
  expect(JSON.stringify(detail)).not.toMatch(/email|setting|accountEpoch|payloadDigest|requestId/);
  const target = { type: 'SYSTEM', targetType: 'SPACE_MISSION_INVITATION', targetId: row.id };
  expect(await resolveNotificationTarget(target as never, 'learner1')).toEqual({
    href: `/community/spaces/private/missions/${m.id}?invitation=${row.id}#mission-invitation`, label: 'Einladung ansehen' });
  expect(await resolveNotificationTargets([target, { type: 'FOLLOW', targetType: 'USER', targetId: 'learner2' },
    { ...target, type: 'FOLLOW' }, { ...target, targetId: 'missing' }] as never, 'learner1')).toEqual([
      expect.objectContaining({ label: 'Einladung ansehen' }), { href: '/profile/learner2', label: 'Profil ansehen' }, null, null,
    ]);
  expect(await prisma.spaceMissionParticipation.count()).toBe(1);
});

test('explicit acceptance joins once, scrubs all source fields, and exact replay after leave never rejoins', async () => {
  const { m, row } = await delivered();
  const accepted = await decision(m.id, row.id);
  expect(accepted).toMatchObject({ invitation: { id: row.id, state: 'ACCEPTED', revision: 2 }, mission: { participation: { epoch: 1, active: true } } });
  await assertTerminal(row.id, 'ACCEPTED');
  expect(await decision(m.id, row.id)).toMatchObject({ invitation: { state: 'ACCEPTED' } });
  await leave(m.id, 'learner1');
  expect(await decision(m.id, row.id)).toMatchObject({ mission: { participation: { epoch: 1, active: false } } });
  await expect(decision(m.id, row.id, 'DECLINE')).rejects.toMatchObject({ status: 409 });
  await expect(decision(m.id, row.id, 'ACCEPT', 'learner1', 2)).rejects.toMatchObject({ status: 409 });
  expect(await prisma.spaceMissionParticipation.count({ where: { missionId: m.id, optedOutAt: null } })).toBe(1);
});

test('private decline never joins; exact replay works and another sender cannot replace its lifetime tombstone', async () => {
  const { m, row } = await delivered();
  expect(await decision(m.id, row.id, 'DECLINE')).toMatchObject({ invitation: { state: 'DECLINED', revision: 2 } });
  await assertTerminal(row.id, 'DECLINED'); await decision(m.id, row.id, 'DECLINE');
  await expect(decision(m.id, row.id)).rejects.toMatchObject({ status: 409 });
  await join(m.id, 'learner2'); const second = await sendInput(m.id, 'learner1', 'alternate-sender', 'learner2');
  expect(await send(m.id, second, 'learner2')).toEqual({ requestId: 'alternate-sender', processed: true });
  expect(await prisma.spaceMissionInvitation.count()).toBe(1); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionParticipation.count({ where: { userId: 'learner1' } })).toBe(0);
});

test('notice read/deletion is independent of list and exact send replay never recreates a notice or joins', async () => {
  const { m, row, body } = await delivered();
  await prisma.notification.updateMany({ data: { isRead: true } });
  expect((await pending()).items[0].id).toBe(row.id);
  await prisma.notification.deleteMany();
  expect((await pending()).items[0].id).toBe(row.id);
  await send(m.id, body); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionParticipation.count()).toBe(1);
});

test('disable is revision-CAS, scrubs incoming only, and cannot revive a terminal row on re-enable', async () => {
  const { m, row } = await delivered();
  await join(m.id, 'learner1'); await leave(m.id, 'learner1');
  // Fresh fixture proves outgoing invitations survive disabling the sender.
  await enable('learner0'); await enable('learner2');
  const outgoing = await sendInput(m.id, 'learner2', 'outgoing'); await send(m.id, outgoing);
  expect(await setInvitationPreference('learner0', { enabled: false, expectedRevision: 1 })).toEqual({ enabled: false, revision: 2 });
  expect(await prisma.spaceMissionInvitation.findFirstOrThrow({ where: { recipientId: 'learner2' } })).toMatchObject({ state: 'PENDING' });
  await expect(setInvitationPreference('learner1', { enabled: false, expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
  await setInvitationPreference('learner1', { enabled: false, expectedRevision: 1 });
  await assertTerminal(row.id, 'REVOKED');
  await enable('learner1'); expect(await pending()).toEqual({ items: [], nextCursor: null });
});

test('disabling receiving settles an effective pending invitation atomically without changing participation', async () => {
  const { row } = await delivered();
  await setInvitationPreference('learner1', { enabled: false, expectedRevision: 1 });
  await assertTerminal(row.id, 'REVOKED');
  expect(await prisma.spaceMissionParticipation.count()).toBe(1);
  await enable(); await expect(decision(row.missionId, row.id)).rejects.toMatchObject({ status: 409 });
});

test('full send suppression is receipted; freeing capacity and retrying the same request never dispatches', async () => {
  const m = await mission(); for (let i = 0; i < 5; i++) await join(m.id, `learner${i}`);
  await enable('learner5'); const body = await sendInput(m.id, 'learner5');
  expect(await send(m.id, body)).toEqual({ requestId: body.requestId, processed: true });
  expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  await leave(m.id, 'learner4'); await send(m.id, body);
  expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  await send(m.id, await sendInput(m.id, 'learner5', 'manual-new'));
  expect(await prisma.spaceMissionInvitation.count()).toBe(1);
});

test('a valid invitation reserves no place; full accept is atomic and explicit retry after a slot frees works', async () => {
  const { m, row } = await delivered(); for (let i = 2; i <= 5; i++) await join(m.id, `learner${i}`);
  expect((await pending()).items[0]).toMatchObject({ canAccept: false, unavailableReason: 'FULL' });
  await expect(decision(m.id, row.id)).rejects.toMatchObject({ status: 409, code: 'MISSION_FULL' });
  expect(await prisma.spaceMissionInvitation.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: 'PENDING', revision: 1 });
  expect(await prisma.spaceMissionParticipation.count({ where: { userId: 'learner1' } })).toBe(0);
  expect(await prisma.notification.count()).toBe(1);
  await leave(m.id, 'learner5'); await decision(m.id, row.id);
  await assertTerminal(row.id, 'ACCEPTED');
});

test('ineligible raw unrevoked consents still reserve capacity and full pending invitations remain declinable', async () => {
  const { m, row } = await delivered(); for (let i = 2; i <= 5; i++) await join(m.id, `learner${i}`);
  await prisma.user.update({ where: { id: 'learner5' }, data: { role: 'INSTRUCTOR' } });
  expect((await readMission('private', m.id, 'learner1')).participants).toHaveLength(4);
  await expect(decision(m.id, row.id)).rejects.toMatchObject({ code: 'MISSION_FULL' });
  await decision(m.id, row.id, 'DECLINE'); await assertTerminal(row.id, 'DECLINED');
});

test('exact expiry is unavailable on write-free GET and the authorized failed decision commits EXPIRED scrubbing', async () => {
  const { m, row } = await delivered(); const boundary = new Date(Date.now() - 1);
  await prisma.spaceMissionInvitation.update({ where: { id: row.id }, data: { expiresAt: boundary } });
  expect(await pending()).toEqual({ items: [], nextCursor: null });
  expect(await readMissionInvitation('private', m.id, row.id, 'learner1')).toEqual({ state: 'UNAVAILABLE', invitation: null });
  expect(await prisma.spaceMissionInvitation.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: 'PENDING', revision: 1 });
  await expect(decision(m.id, row.id)).rejects.toMatchObject({ status: 404 });
  await assertTerminal(row.id, 'EXPIRED');
});

test('sender leave/rejoin scrubs outgoing pending and rejects old epoch replay without replenishing receipts', async () => {
  const { m, row, body } = await delivered();
  await leave(m.id, 'learner0'); await assertTerminal(row.id, 'REVOKED');
  await join(m.id, 'learner0', 1);
  await expect(send(m.id, body)).rejects.toMatchObject({ status: 409 });
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1);
  expect(await pending()).toEqual({ items: [], nextCursor: null });
});

test('normal self-join revokes incoming pending instead of claiming acceptance; later leave cannot revive', async () => {
  const { m, row } = await delivered(); await join(m.id, 'learner1');
  await assertTerminal(row.id, 'REVOKED'); await leave(m.id, 'learner1');
  await expect(decision(m.id, row.id)).rejects.toMatchObject({ status: 409 });
  expect(await pending()).toEqual({ items: [], nextCursor: null });
});

test.each(['learner0', 'learner1'])('official membership removal for %s revokes pending and retains monotone access after re-add', async userId => {
  const { m, row, body } = await delivered(); await remove(userId);
  await assertTerminal(row.id, 'REVOKED');
  expect(await prisma.spaceMissionInvitationAccess.findUniqueOrThrow({ where: { missionId_userId: { missionId: m.id, userId } } })).toMatchObject({ epoch: 1 });
  await prisma.spaceMember.create({ data: { spaceId: 'private', userId } });
  if (userId === 'learner0') { await join(m.id, userId, 1); await expect(send(m.id, body)).rejects.toMatchObject({ status: 409 }); }
  else { await expect(decision(m.id, row.id)).rejects.toMatchObject({ status: 409 }); }
  expect(await pending()).toEqual({ items: [], nextCursor: null });
});

test('absent-zero first recipient fence is advanced even before any invitation, invalidating an old selection on return', async () => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  expect(await prisma.spaceMissionInvitationAccess.count({ where: { userId: 'learner1' } })).toBe(0);
  await remove('learner1'); await prisma.spaceMember.create({ data: { spaceId: 'private', userId: 'learner1' } });
  expect(await send(m.id, body)).toEqual({ requestId: body.requestId, processed: true });
  expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationAccess.findUniqueOrThrow({ where: { missionId_userId: { missionId: m.id, userId: 'learner1' } } })).toMatchObject({ epoch: 1 });
});

test.each(['learner0', 'learner1'])('official USER loss/return for %s preserves account fence and cannot restore old invitation', async userId => {
  const { m, row, body } = await delivered(); await role(userId, 'INSTRUCTOR');
  await assertTerminal(row.id, 'REVOKED');
  expect(await prisma.spaceMissionInvitationSetting.findUniqueOrThrow({ where: { userId } })).toMatchObject({ enabled: false, accountEpoch: 1 });
  await role(userId, 'USER');
  expect(await prisma.spaceMissionInvitationSetting.findUniqueOrThrow({ where: { userId } })).toMatchObject({ accountEpoch: 1 });
  if (userId === 'learner0') { await join(m.id, userId, 1); await expect(send(m.id, body)).rejects.toMatchObject({ status: 409 }); }
  else { await enable(); await expect(decision(m.id, row.id)).rejects.toMatchObject({ status: 409 }); }
});

test('official sender erasure removes other recipients notices and receipts, retaining only recipient-private tombstone', async () => {
  const { m, row } = await delivered(); await erase('learner0');
  await assertTerminal(row.id, 'REVOKED');
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationSetting.count({ where: { userId: 'learner0' } })).toBe(0);
  expect(await prisma.spaceMissionInvitationAccess.count({ where: { userId: 'learner0' } })).toBe(0);
  await expect(readInvitationPreference('learner0')).rejects.toMatchObject({ status: 401 });
  await join(m.id, 'learner2'); await send(m.id, await sendInput(m.id, 'learner1', 'alternate', 'learner2'), 'learner2');
  expect(await prisma.spaceMissionInvitation.count()).toBe(1);
  expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 2 });
  await erase('learner1');
  expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationSetting.count({ where: { userId: { in: ['learner0', 'learner1'] } } })).toBe(0);
});

test('official recipient erasure deletes identity and own invitation while surviving sender receipt remains target-free', async () => {
  const { m, body } = await delivered(); await erase('learner1');
  expect(await prisma.spaceMissionInvitation.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationSetting.count({ where: { userId: 'learner1' } })).toBe(0);
  const receipt = await prisma.spaceMissionInvitationRequest.findFirstOrThrow();
  expect(Object.keys(receipt).sort()).toEqual(['missionId', 'payloadDigest', 'requestId', 'senderId']);
  expect(await send(m.id, body)).toEqual({ requestId: body.requestId, processed: true });
  await expect(send(m.id, { ...body, recipientId: 'learner2' })).rejects.toMatchObject({ status: 409 });
  const replacement = await prisma.user.create({ data: { email: 'learner1@example.test', role: 'USER', name: 'Learner replacement' } });
  expect(replacement.id).not.toBe('learner1');
  await prisma.spaceMember.create({ data: { spaceId: 'private', userId: replacement.id } }); await enable(replacement.id);
  await send(m.id, { ...body, requestId: 'old-target-fresh-key' });
  expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  const list = await candidate(m.id, 'learner0', 'replacement'); const selected = list.items[0];
  await send(m.id, { recipientId: replacement.id, requestId: 'fresh-new-account', senderEpoch: list.senderEpoch,
    senderAccessEpoch: list.senderAccessEpoch, selection: selected.selection });
  expect(await prisma.spaceMissionInvitation.count({ where: { recipientId: replacement.id } })).toBe(1);
});

test('sender-four lifetime quota survives leave/rejoin and target erasure', async () => {
  const m = await mission(); await join(m.id, 'learner0');
  const attempts = [];
  for (let i = 1; i <= 5; i++) { const body = await sendInput(m.id, `learner${i}`, `attempt-${i}`); attempts.push(body); await send(m.id, body); }
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(4);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 4 });
  await erase('learner1'); expect(await prisma.spaceMissionInvitationRequest.count()).toBe(4);
  await enable('learner5'); await send(m.id, attempts[4]);
  await leave(m.id, 'learner0'); await join(m.id, 'learner0', 1);
  await send(m.id, await sendInput(m.id, 'learner5', 'after-rejoin'));
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(4); expect(await prisma.spaceMissionInvitation.count()).toBe(0);
});

test('non-personal mission-twenty aggregate never decreases on sender erasure or permits saturated unrecorded keys later', async () => {
  const m = await mission();
  for (let i = 0; i < 5; i++) await join(m.id, `learner${i}`);
  for (let sender = 0; sender < 5; sender++) for (let i = 0; i < 4; i++) {
    await send(m.id, await sendInput(m.id, 'learner8', `quota-${sender}-${i}`, `learner${sender}`), `learner${sender}`);
  }
  await leave(m.id, 'learner4'); await join(m.id, 'learner5'); await enable('learner8');
  const unrecorded = await sendInput(m.id, 'learner8', 'saturated-key', 'learner5'); await send(m.id, unrecorded, 'learner5');
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(20);
  await erase('learner0');
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(16);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 20 });
  await send(m.id, unrecorded, 'learner5');
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(16); expect(await prisma.spaceMissionInvitation.count()).toBe(0);
});

test('recipient effective-pending cap spans missions without exposing suppression and expired slots are latched/scrubbed on next send', async () => {
  await enable(); const missions = [];
  for (let i = 0; i < 11; i++) {
    const spaceId = `scope${i}`; await prisma.space.create({ data: { id: spaceId, name: spaceId, description: 'Synthetic cap fixture', visibility: 'PRIVATE' } });
    await prisma.spaceMember.createMany({ data: ['learner0', 'learner1'].map(userId => ({ spaceId, userId })) });
    const m = await mission(spaceId); missions.push(m); await join(m.id, 'learner0', 0, spaceId);
    const body = await sendInput(m.id, 'learner1', 'cap-attempt', 'learner0', spaceId);
    expect(await send(m.id, body, 'learner0', spaceId)).toEqual({ requestId: 'cap-attempt', processed: true });
  }
  expect((await pending()).items).toHaveLength(10); expect(await prisma.spaceMissionInvitation.count()).toBe(10);
  const oldest = await prisma.spaceMissionInvitation.findFirstOrThrow({ where: { missionId: missions[0].id } });
  await prisma.spaceMissionInvitation.update({ where: { id: oldest.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  const last = missions[10]; const body = await sendInput(last.id, 'learner1', 'new-explicit-cap-attempt', 'learner0', last.spaceId);
  await send(last.id, body, 'learner0', last.spaceId);
  await assertTerminal(oldest.id, 'EXPIRED'); expect((await pending()).items).toHaveLength(10);
});

test('close atomically purges all mission-private rows/notices and checks closed before late zero-token or accepted replay', async () => {
  const { m, row, body } = await delivered(); await decision(m.id, row.id);
  await closeMission('private', m.id, 'admin');
  expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationAccess.count()).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
  await expect(send(m.id, body)).rejects.toMatchObject({ code: 'MISSION_CLOSED' });
  await expect(decision(m.id, row.id)).rejects.toMatchObject({ code: 'MISSION_CLOSED' });
  expect(await readMissionInvitation('private', m.id, row.id, 'learner1')).toEqual({ state: 'UNAVAILABLE', invitation: null });
  const fresh = await mission('private', 'new-mission'); expect(fresh.id).not.toBe(m.id);
  await join(fresh.id, 'learner0'); await send(fresh.id, await sendInput(fresh.id));
  expect(await prisma.spaceMissionInvitation.count()).toBe(1);
});

// No mocked transactions below: these races exercise the actual Prisma driver.
test('parallel exact sends commit one receipt/counter/invitation/notice', async () => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => send(m.id, body)));
  expect(outcomes).toEqual(Array(4).fill({ requestId: body.requestId, processed: true }));
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1); expect(await prisma.spaceMissionInvitation.count()).toBe(1);
  expect(await prisma.notification.count()).toBe(1);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 1 });
});

test('different actual senders racing one recipient each keep generic receipt with one invitation/notice maximum', async () => {
  const m = await mission(); await join(m.id, 'learner0'); await join(m.id, 'learner2'); await enable();
  const [a, b] = await Promise.all([sendInput(m.id), sendInput(m.id, 'learner1', 'other-sender', 'learner2')]);
  const outcomes = await Promise.all([send(m.id, a), send(m.id, b, 'learner2')]);
  expect(outcomes).toEqual([{ requestId: a.requestId, processed: true }, { requestId: b.requestId, processed: true }]);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(2); expect(await prisma.spaceMissionInvitation.count()).toBe(1);
  expect(await prisma.notification.count()).toBe(1);
});

test('accept versus decline has exactly one committed winner and no second participation mutation', async () => {
  const { m, row } = await delivered();
  const outcomes = await Promise.allSettled([decision(m.id, row.id), decision(m.id, row.id, 'DECLINE')]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejection = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
  expect(rejection.reason).toMatchObject({ status: 409 });
  const current = await prisma.spaceMissionInvitation.findUniqueOrThrow({ where: { id: row.id } });
  expect(['ACCEPTED', 'DECLINED']).toContain(current.state); await assertTerminal(row.id, current.state);
  expect(await prisma.spaceMissionParticipation.count({ where: { userId: 'learner1', optedOutAt: null } })).toBe(current.state === 'ACCEPTED' ? 1 : 0);
});

test('normal last-slot join versus two accepts cannot exceed five raw unopted consents', async () => {
  const { m, row } = await delivered(); await enable('learner2');
  await send(m.id, await sendInput(m.id, 'learner2', 'second-pending'));
  const second = await prisma.spaceMissionInvitation.findFirstOrThrow({ where: { recipientId: 'learner2' } });
  for (let i = 3; i <= 5; i++) await join(m.id, `learner${i}`);
  const outcomes = await Promise.allSettled([decision(m.id, row.id), decision(m.id, second.id, 'ACCEPT', 'learner2'), join(m.id, 'learner6')]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(await prisma.spaceMissionParticipation.count({ where: { missionId: m.id, optedOutAt: null } })).toBe(5);
  expect(await prisma.spaceMissionInvitation.count({ where: { state: 'ACCEPTED' } })).toBeLessThanOrEqual(1);
});

test.each(['disable-first', 'send-first'])('recipient disable/send both real commit orders end scrubbed and never reactivate: %s', async order => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  const disable = () => setInvitationPreference('learner1', { enabled: false, expectedRevision: 1 });
  if (order === 'disable-first') { await disable(); await send(m.id, body); }
  else { await send(m.id, body); await disable(); }
  await enable(); await send(m.id, body);
  expect((await pending()).items).toHaveLength(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionInvitation.count({ where: { state: 'PENDING' } })).toBe(0);
});

test.each(['erase-first', 'send-first'])('recipient erasure/send both real commit orders prevent post-erasure invitation recreation: %s', async order => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  if (order === 'erase-first') { await erase('learner1'); await send(m.id, body); }
  else { await send(m.id, body); await erase('learner1'); }
  await send(m.id, body);
  expect(await prisma.spaceMissionInvitation.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1);
});

test('missing secret fails closed; key rotation/stale or tampered selection is generically receipted without delivery', async () => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  delete process.env.NEXTAUTH_SECRET; await expect(candidate(m.id)).rejects.toMatchObject({ status: 503 });
  await expect(send(m.id, body)).rejects.toMatchObject({ status: 503 });
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0);
  process.env.NEXTAUTH_SECRET = `${secret}-rotated`; await send(m.id, body);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1); expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  process.env.NEXTAUTH_SECRET = secret;
  const fresh = await sendInput(m.id, 'learner1', 'tampered');
  fresh.selection.token = Buffer.alloc(32, 5).toString('base64url'); await send(m.id, fresh);
  expect(await prisma.spaceMissionInvitation.count()).toBe(0);
});

test('own cursor is bound to live account and preference revision, rejecting stale/cross-account or noncanonical cursor', async () => {
  const { row } = await delivered();
  const createdAt = row.createdAt!.toISOString();
  const proof = createHmac('sha256', secret).update(JSON.stringify(['own-mission-invitations/v1', 'learner1', 0, 1, row.id, createdAt])).digest('base64url');
  const raw = Buffer.from(JSON.stringify({ v: 1, kind: 'own-mission-invitations', id: row.id, createdAt, proof })).toString('base64url');
  const req = (cursor: string) => request('GET', undefined, `/?cursor=${cursor}`);
  expect(await listMissionInvitations('learner1', req(raw))).toEqual({ items: [], nextCursor: null });
  await expect(listMissionInvitations('learner2', req(raw))).rejects.toMatchObject({ status: 400 });
  await setInvitationPreference('learner1', { enabled: false, expectedRevision: 1 });
  await enable();
  await expect(listMissionInvitations('learner1', req(raw))).rejects.toMatchObject({ status: 400 });
  await expect(listMissionInvitations('admin', req('bad'))).rejects.toMatchObject({ status: 404 });
  await expect(listMissionInvitations('missing', req('bad'))).rejects.toMatchObject({ status: 401 });
  await expect(listMissionInvitations('learner1', req(`${raw}=`))).rejects.toMatchObject({ status: 400 });
});

test.each(['admin', 'moderator', 'instructor', 'outsider', 'missing'])('live %s cannot send despite stale session claims and malformed cursor/query does not bypass scope', async userId => {
  const { m, body } = await delivered(); session(userId, 'USER');
  const response = await postInvitation(request('POST', body), context(m.id));
  expect(response.status).toBe(userId === 'missing' ? 401 : 404);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const result = await getCandidates(request('GET', undefined, '/?q=x&q=bad'), context(m.id));
  expect(result.status).toBe(userId === 'missing' ? 401 : 404);
});

test('all invitation routes return private no-store and strict bounded origin/body errors', async () => {
  const { m, row, body } = await delivered(); session('learner1', 'ADMIN');
  const ownContext = detailContext(m.id, row.id);
  const reads = [await getPreference(), await getPending(request()), await getInvitation(request(), ownContext)];
  expect(reads.map(response => response.status)).toEqual([200, 200, 200]);
  for (const response of reads) expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  for (const bad of [{ enabled: false, expectedRevision: 1, userId: 'learner2' }, { enabled: 'true', expectedRevision: 1 }, { enabled: false, expectedRevision: 1.5 }]) {
    const response = await putPreference(request('PUT', bad)); expect(response.status).toBe(400); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  }
  expect((await putPreference(request('PUT', { enabled: false, expectedRevision: 1 }, '/', { Origin: 'https://evil.invalid' }))).status).toBe(403);
  expect((await postDecision(request('POST', { decision: 'ACCEPT', expectedRevision: 1, recipientId: 'learner1' }), ownContext)).status).toBe(400);
  expect((await postDecision(request('POST', { decision: 'ACCEPT', expectedRevision: 1 }, '/', { Origin: 'https://evil.invalid' }), ownContext)).status).toBe(403);
  session('learner0');
  const malformed = [
    { ...body, recipientId: 'x'.repeat(101) }, { ...body, senderEpoch: 0 }, { ...body, invitationId: row.id },
    { ...body, selection: { ...body.selection, extra: true } },
    { ...body, selection: { ...body.selection, nonce: 'a'.repeat(23) } },
    { ...body, selection: { ...body.selection, token: 'a'.repeat(5000) } },
    { ...body, selection: { ...body.selection, validUntil: '2026-10-17T03:00:00Z' } },
  ];
  for (const bad of malformed) {
    const response = await postInvitation(request('POST', bad), context(m.id)); expect(response.status).toBe(JSON.stringify(bad).length > 2048 ? 413 : 400); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  }
  expect((await getCandidates(request('GET', undefined, '/?q=x'), context(m.id))).status).toBe(400);
  expect((await getCandidates(request('GET', undefined, '/?q=Learner&q=Learner'), context(m.id))).status).toBe(400);
  session(null); const anonymous = await getPending(request()); expect(anonymous.status).toBe(401); expect(anonymous.headers.get('Cache-Control')).toBe('private, no-store');
});

test('provider guard rejects unsafe URLs before any connection and preserves canonical parameter-free local forge_test', () => {
  const { missionTestDatabaseUrl } = require('../../scripts/space-mission-test-database.cjs');
  expect(missionTestDatabaseUrl('postgresql://test:test@127.0.0.1:5432/forge_test', 'postgresql')).toBe('postgresql://test:test@127.0.0.1:5432/forge_test');
  for (const url of ['postgresql://test:test@example.com/forge_test', 'postgresql://test:test@localhost/forge',
    'postgresql://test:test@localhost/forge_test?host=example.com', 'postgresql://test:test@localhost/forge_test?options=-csearch_path%3Dpublic',
    'postgresql://test:test@localhost/forge_test#public', 'postgresql:///forge_test?host=/tmp', 'file:/tmp/test.db']) {
    expect(() => missionTestDatabaseUrl(url, 'postgresql')).toThrow('local forge_test');
  }
  expect(() => missionTestDatabaseUrl('postgresql://test:test@localhost/forge_test', 'sqlite')).toThrow('DATABASE_PROVIDER');
});

const post = async (missionId: string, authorId: string, requestId: string, kind: 'INSIGHT' | 'BUILD_ON' = 'INSIGHT', targetContributionId: string | null = null) => {
  await contributeToMission('private', missionId, authorId, parseMissionContribution({ kind, content: `A concrete synthetic insight ${requestId}.`, epoch: 1, requestId, targetContributionId }));
  return prisma.spaceMissionContribution.findFirstOrThrow({ where: { missionId, authorId, requestId } });
};

test('self-only next action follows deliberate insight/build-on loop and reverses after peer leave; soft week never gates it', async () => {
  const m = await mission(); await join(m.id, 'learner0'); await join(m.id, 'learner1');
  expect((await readMission('private', m.id, 'admin')).myNextAction).toBeNull();
  expect((await readMission('private', m.id, 'learner2')).myNextAction).toBeNull();
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'SHARE_INSIGHT' });
  await post(m.id, 'learner0', 'insight0');
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'WAIT_FOR_PEER' });
  const target = await post(m.id, 'learner1', 'insight1');
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'BUILD_ON', targetContributionId: target.id });
  const build = await post(m.id, 'learner0', 'build0', 'BUILD_ON', target.id);
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'CURRENT_GOAL_REACHED' });
  await leave(m.id, 'learner1');
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'REVIEW_BUILD_ON', contributionId: build.id });
  await withdrawMissionContribution('private', m.id, build.id, 'learner0', 1);
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'WAIT_FOR_PEER' });
  await closeMission('private', m.id, 'admin');
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'CLOSED' });
  expect(await prisma.rewardLedger.count()).toBe(0); expect(await prisma.courseContentProgress.count()).toBe(0);
});

test('hidden insight allows replacement while fifth lifetime insight attempt yields LIMIT_REACHED after withdrawal', async () => {
  const m = await mission(); await join(m.id, 'learner0');
  for (let i = 0; i < 5; i++) {
    const row = await post(m.id, 'learner0', `insight-${i}`);
    if (i === 0) { await moderateMissionContribution('private', m.id, row.id, 'admin', true);
      expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'SHARE_INSIGHT' }); }
    else await withdrawMissionContribution('private', m.id, row.id, 'learner0', 1);
  }
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'LIMIT_REACHED' });
  await expect(post(m.id, 'learner0', 'impossible-sixth')).rejects.toMatchObject({ status: 409 });
});

test('unhidden invalid build-on blocks live-kind until withdrawal; fifth lifetime build-on never suggests sixth', async () => {
  const m = await mission(); await join(m.id, 'learner0'); await join(m.id, 'learner1');
  await post(m.id, 'learner0', 'own-insight'); const target = await post(m.id, 'learner1', 'peer-insight');
  for (let i = 0; i < 5; i++) { const build = await post(m.id, 'learner0', `build-${i}`, 'BUILD_ON', target.id);
    if (i === 0) {
      await moderateMissionContribution('private', m.id, target.id, 'admin', true);
      expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'REVIEW_BUILD_ON', contributionId: build.id });
      await expect(post(m.id, 'learner0', 'blocked-build', 'BUILD_ON', target.id)).rejects.toMatchObject({ status: 404 });
      await moderateMissionContribution('private', m.id, target.id, 'admin', false);
    }
    await withdrawMissionContribution('private', m.id, build.id, 'learner0', 1);
  }
  expect((await readMission('private', m.id, 'learner0')).myNextAction).toEqual({ kind: 'LIMIT_REACHED' });
});


test('resolver SQL work is measured and bounded for one/ten/fifty invitation targets and mixed legacy page', async () => {
  await enable(); const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const spaceId = `queryscope${i}`; await prisma.space.create({ data: { id: spaceId, name: spaceId, description: 'Synthetic query fixture', visibility: 'PRIVATE' } });
    await prisma.spaceMember.createMany({ data: ['learner0', 'learner1'].map(userId => ({ spaceId, userId })) });
    const m = await mission(spaceId); await join(m.id, 'learner0', 0, spaceId);
    await send(m.id, await sendInput(m.id, 'learner1', 'query-attempt', 'learner0', spaceId), 'learner0', spaceId);
    ids.push((await prisma.spaceMissionInvitation.findFirstOrThrow({ where: { missionId: m.id } })).id);
  }
  const queries: string[] = jest.requireMock('@/lib/prisma').__queries;
  const measure = async (work: () => Promise<unknown>) => { queries.length = 0; await work(); return {
    statements: queries.length, selects: queries.filter(query => /^\s*SELECT\b/i.test(query)).length,
  }; };
  const single = await measure(() => resolveMissionInvitationTargets(ids.slice(0, 1), 'learner1'));
  const ten = await measure(() => resolveMissionInvitationTargets(ids, 'learner1'));
  const fifty = await measure(() => resolveMissionInvitationTargets(Array.from({ length: 50 }, (_, i) => ids[i % ids.length]), 'learner1'));
  const mixedTargets = [
    ...ids.map(targetId => ({ type: 'SYSTEM', targetType: 'SPACE_MISSION_INVITATION', targetId })),
    ...Array.from({ length: 10 }, () => ({ type: 'FOLLOW', targetType: 'USER', targetId: 'learner2' })),
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'COMMENT', targetType: 'COMMENT', targetId: `missing-comment-${i}` })),
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'CHAT_MESSAGE', targetType: 'CHAT_MESSAGE', targetId: `missing-chat-${i}` })),
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'EVENT', targetType: 'EVENT', targetId: `missing-event-${i}` })),
  ];
  const mixed = await measure(() => resolveNotificationTargets(mixedTargets as never, 'learner1'));
  expect(ten.selects).toBe(single.selects); expect(fifty.selects).toBe(single.selects);
  expect(mixed.selects).toBe(fifty.selects + 4);
  process.stdout.write(`INVITATION_RESOLVER_SQL ${JSON.stringify({ provider: process.env.DATABASE_PROVIDER ?? 'sqlite', single, ten, fifty, mixed })}\n`);
});


test('same-value preference CAS remains write-free, preserves revision and existing effective pending invitation', async () => {
  expect(await setInvitationPreference('learner2', { enabled: false, expectedRevision: 0 })).toEqual({ enabled: false, revision: 0 });
  expect(await prisma.spaceMissionInvitationSetting.count({ where: { userId: 'learner2' } })).toBe(0);
  const { row } = await delivered();
  const queries: string[] = jest.requireMock('@/lib/prisma').__queries; queries.length = 0;
  expect(await setInvitationPreference('learner1', { enabled: true, expectedRevision: 1 })).toEqual({ enabled: true, revision: 1 });
  expect(queries.filter(query => /^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(query))).toHaveLength(0);
  expect((await pending()).items[0].id).toBe(row.id);
  await expect(setInvitationPreference('learner1', { enabled: true, expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
});

test('real unrelated User email P2002 is returned directly, never retried as invitation fence conflict', async () => {
  let attempts = 0;
  await expect(invitationTransaction(tx => { attempts++; return tx.user.create({ data: { email: 'learner1@example.test', role: 'USER' } }); }))
    .rejects.toMatchObject({ code: 'P2002' });
  expect(attempts).toBe(1);
});


/** Only scheduling is instrumented: every read/write/rollback/error comes from
 * two independent actual adapters. WAL permits the first writer to commit while
 * the held reader has an old snapshot, forcing a genuine stale-snapshot retry. */
async function controlledRealCommitOrder(operations: [() => Promise<unknown>, () => Promise<unknown>], winner: 0 | 1) {
  const clients: PrismaClient[] = [jest.requireMock('@/lib/prisma').__newClient(), jest.requireMock('@/lib/prisma').__newClient()];
  const releases: Array<() => void> = [];
  const gates = [0, 1].map(i => new Promise<void>(resolve => { releases[i] = resolve; }));
  let arrived = 0; let releaseArrivals!: () => void; let attempts = 0;
  const arrivals = new Promise<void>(resolve => { releaseArrivals = resolve; });
  const failures: unknown[] = [];
  type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;
  const transaction = jest.spyOn(prisma, '$transaction').mockImplementation((async (work: Work, options: unknown) => {
    const ordinal = attempts++;
    return clients[ordinal % 2].$transaction(async tx => {
      if (ordinal < 2) {
        const find = tx.user.findUnique.bind(tx.user); let held = false;
        jest.spyOn(tx.user, 'findUnique').mockImplementation((async (args: unknown) => {
          const row = await find(args as never);
          if (!held) { held = true; if (++arrived === 2) releaseArrivals(); await gates[ordinal]; }
          return row;
        }) as never);
      }
      return work(tx);
    }, options as never).catch(error => { failures.push(error); throw error; });
  }) as never);
  const outcomes = operations.map(operation => operation().then(value => ({ status: 'fulfilled' as const, value }), reason => ({ status: 'rejected' as const, reason })));
  try {
    await arrivals; releases[winner](); const first = await outcomes[winner]; releases[1 - winner]();
    const results = await Promise.all(outcomes);
    expect(first.status).toBe('fulfilled'); expect(attempts).toBeGreaterThanOrEqual(3); expect(failures.length).toBeGreaterThanOrEqual(1);
    expect(failures.some(error => error instanceof Prisma.PrismaClientKnownRequestError || error instanceof DriverAdapterError)).toBe(true);
    process.stdout.write(`INVITATION_REAL_RACE ${JSON.stringify({ provider: process.env.DATABASE_PROVIDER ?? 'sqlite', winner, attempts, failures: failures.map((error: any) => ({ code: error.code, kind: error.cause?.kind ?? error.meta?.driverAdapterError?.cause?.kind, originalCode: error.cause?.originalCode ?? error.meta?.driverAdapterError?.cause?.originalCode })) })}\n`);
    return results;
  } finally { releases.forEach(release => release()); transaction.mockRestore(); await Promise.all(clients.map(client => client.$disconnect())); }
}

test.each([0, 1] as const)('independent actual adapters: same-key send stale reader retries, forced commit winner %i', async winner => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  const results = await controlledRealCommitOrder([() => send(m.id, body), () => send(m.id, body)], winner);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1); expect(await prisma.spaceMissionInvitation.count()).toBe(1); expect(await prisma.notification.count()).toBe(1);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 1 });
});

const invalidations = ['sender-leave', 'recipient-remove', 'sender-remove', 'recipient-role-loss', 'sender-role-loss', 'disable', 'close', 'recipient-erasure', 'sender-erasure'] as const;
test.each(invalidations.flatMap(invalidation => [0, 1].map(winner => ({ invalidation, winner: winner as 0 | 1 }))))(
  'independent actual adapters: send versus $invalidation, forced commit winner $winner', async ({ invalidation, winner }) => {
    const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
    const invalidate = async () => {
      if (invalidation === 'sender-leave') return leave(m.id, 'learner0');
      if (invalidation === 'recipient-remove') return remove('learner1');
      if (invalidation === 'sender-remove') return remove('learner0');
      if (invalidation === 'recipient-role-loss') return role('learner1', 'INSTRUCTOR');
      if (invalidation === 'sender-role-loss') return role('learner0', 'INSTRUCTOR');
      if (invalidation === 'disable') return setInvitationPreference('learner1', { enabled: false, expectedRevision: 1 });
      if (invalidation === 'close') return closeMission('private', m.id, 'admin');
      if (invalidation === 'recipient-erasure') return erase('learner1');
      return erase('learner0');
    };
    const results = await controlledRealCommitOrder([() => send(m.id, body), invalidate], winner);
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'rejected') expect([401, 404, 409]).toContain(results[0].reason.status);
    expect(await prisma.spaceMissionInvitation.count({ where: { state: 'PENDING' } })).toBe(0); expect(await prisma.notification.count()).toBe(0);
    if (invalidation.includes('remove')) {
      const userId = invalidation === 'sender-remove' ? 'learner0' : 'learner1';
      await prisma.spaceMember.create({ data: { spaceId: 'private', userId } });
      expect(await prisma.spaceMissionInvitationAccess.findUniqueOrThrow({ where: { missionId_userId: { missionId: m.id, userId } } })).toMatchObject({ epoch: 1 });
    }
  });

test.each([0, 1] as const)('independent actual adapters: acceptance versus close, forced commit winner %i', async winner => {
  const { m, row } = await delivered();
  const results = await controlledRealCommitOrder([() => decision(m.id, row.id), () => closeMission('private', m.id, 'admin')], winner);
  expect(results[1].status).toBe('fulfilled');
  expect(await prisma.spaceMissionInvitation.count()).toBe(0); expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionParticipation.count({ where: { userId: 'learner1', optedOutAt: null } })).toBe(winner === 0 ? 1 : 0);
});

test('real admin email collision after preliminary duplicate check maps to email409 without invitation-fence retry', async () => {
  session(); const actual = prisma.user.findFirst.bind(prisma.user); let injected = false;
  const check = jest.spyOn(prisma.user, 'findFirst').mockImplementation((async (args: unknown) => {
    const result = await actual(args as never);
    if (!injected) { injected = true; expect(result).toBeNull(); await prisma.user.create({ data: { id: 'email-racer', email: 'race@example.test', role: 'USER' } }); }
    return result;
  }) as never);
  try {
    const response = await updateAccount(request('PUT', { email: 'race@example.test', name: 'Learner 1', role: 'INSTRUCTOR' }), { params: Promise.resolve({ id: 'learner1' }) });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Diese E-Mail-Adresse wird bereits verwendet' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: 'learner1' } })).toMatchObject({ role: 'USER', email: 'learner1@example.test' });
    expect(await prisma.spaceMissionInvitationSetting.count()).toBe(0);
  } finally { check.mockRestore(); }
});


const sqliteTest = process.env.DATABASE_PROVIDER !== 'postgresql' ? test : test.skip;
sqliteTest('genuine independent SQLite writer BUSY exhausts closed with no partial receipt/counter/invitation/notice', async () => {
  const Database = require('better-sqlite3'); const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  const lock = new Database(jest.requireMock('@/lib/prisma').__path); lock.exec('BEGIN IMMEDIATE');
  try { await expect(send(m.id, body)).rejects.toMatchObject({ status: 409 }); }
  finally { lock.exec('ROLLBACK'); lock.close(); }
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0); expect(await prisma.spaceMissionInvitation.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 0 });
  await send(m.id, body); expect(await prisma.spaceMissionInvitation.count()).toBe(1);
});

sqliteTest('genuine SQLite BUSY recovery reruns authorized reads and commits one complete delivery after writer releases', async () => {
  const Database = require('better-sqlite3'); const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  const lock = new Database(jest.requireMock('@/lib/prisma').__path); lock.exec('BEGIN IMMEDIATE'); let released = false;
  const release = () => { if (!released) { released = true; lock.exec('ROLLBACK'); lock.close(); } };
  const timer = setTimeout(release, 15); const queries: string[] = jest.requireMock('@/lib/prisma').__queries; queries.length = 0;
  try { expect(await send(m.id, body)).toEqual({ requestId: body.requestId, processed: true }); }
  finally { clearTimeout(timer); release(); }
  expect(queries.filter(query => /^\s*SELECT\b/i.test(query) && query.includes('SpaceMissionInvitationRequest')).length).toBeGreaterThanOrEqual(2);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1); expect(await prisma.spaceMissionInvitation.count()).toBe(1); expect(await prisma.notification.count()).toBe(1);
});

sqliteTest('actual notice-insert failure rolls back receipt, aggregate, fences and invitation together', async () => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_test_invitation_notice BEFORE INSERT ON "Notification" WHEN NEW."targetType" = 'SPACE_MISSION_INVITATION' BEGIN SELECT RAISE(ABORT, 'synthetic notice insert failure'); END`);
  try { await expect(send(m.id, body)).rejects.toBeDefined(); }
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_test_invitation_notice'); }
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0); expect(await prisma.spaceMissionInvitation.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationAccess.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationSetting.count()).toBe(1);
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ invitationAttemptCount: 0 });
});

sqliteTest.each(['member-remove', 'role-loss', 'sender-erasure', 'close'])('real provider failure during %s rolls back hook and every private cleanup', async hook => {
  const { m, row } = await delivered();
  const operation = hook === 'close' ? 'DELETE' : 'UPDATE';
  await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_test_invitation_cleanup BEFORE ${operation} ON "SpaceMissionInvitation" BEGIN SELECT RAISE(ABORT, 'synthetic cleanup failure'); END`);
  try {
    session();
    if (hook === 'member-remove') expect((await removeMember(request('DELETE'), { params: Promise.resolve({ spaceId: 'private', userId: 'learner0' }) })).status).toBe(500);
    if (hook === 'role-loss') expect((await updateAccount(request('PUT', { email: 'learner0@example.test', name: 'Learner 0', role: 'INSTRUCTOR' }), { params: Promise.resolve({ id: 'learner0' }) })).status).toBe(500);
    if (hook === 'sender-erasure') expect((await eraseAccount(request('DELETE'), { params: Promise.resolve({ id: 'learner0' }) })).status).toBe(500);
    if (hook === 'close') await expect(closeMission('private', m.id, 'admin')).rejects.toBeDefined();
  } finally { await prisma.$executeRawUnsafe('DROP TRIGGER reject_test_invitation_cleanup'); }
  expect(await prisma.spaceMissionInvitation.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: 'PENDING', senderId: 'learner0', revision: 1 });
  expect(await prisma.notification.count()).toBe(1); expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1);
  expect(await prisma.user.findUniqueOrThrow({ where: { id: 'learner0' } })).toMatchObject({ role: 'USER' });
  expect(await prisma.spaceMember.count({ where: { spaceId: 'private', userId: 'learner0' } })).toBe(1);
  expect(await prisma.spaceMissionInvitationAccess.findUniqueOrThrow({ where: { missionId_userId: { missionId: m.id, userId: 'learner0' } } })).toMatchObject({ epoch: 0 });
  expect(await prisma.spaceMissionParticipation.findUniqueOrThrow({ where: { missionId_userId: { missionId: m.id, userId: 'learner0' } } })).toMatchObject({ optedOutAt: null });
  expect(await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ closedAt: null, invitationAttemptCount: 1 });
});


test.each([0, 1] as const)('independent actual senders competing for one recipient settle exactly once, commit winner %i', async winner => {
  const m = await mission(); await join(m.id, 'learner0'); await join(m.id, 'learner2'); await enable();
  const [a, b] = await Promise.all([sendInput(m.id), sendInput(m.id, 'learner1', 'independent-other', 'learner2')]);
  const results = await controlledRealCommitOrder([() => send(m.id, a), () => send(m.id, b, 'learner2')], winner);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(2); expect(await prisma.spaceMissionInvitation.count()).toBe(1); expect(await prisma.notification.count()).toBe(1);
});

test.each([0, 1] as const)('independent accept versus decline has one winner at forced commit order %i', async winner => {
  const { m, row } = await delivered();
  const results = await controlledRealCommitOrder([() => decision(m.id, row.id), () => decision(m.id, row.id, 'DECLINE')], winner);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  await assertTerminal(row.id, winner === 0 ? 'ACCEPTED' : 'DECLINED');
});

test.each([0, 1] as const)('independent last-slot accepts never exceed five raw consents, forced commit order %i', async winner => {
  const { m, row } = await delivered(); await enable('learner2');
  await send(m.id, await sendInput(m.id, 'learner2', 'independent-second'));
  const second = await prisma.spaceMissionInvitation.findFirstOrThrow({ where: { recipientId: 'learner2' } });
  for (let i = 3; i <= 5; i++) await join(m.id, `learner${i}`);
  const results = await controlledRealCommitOrder([() => decision(m.id, row.id), () => decision(m.id, second.id, 'ACCEPT', 'learner2')], winner);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find(result => result.status === 'rejected') as { reason: { code: string } }; expect(rejected.reason.code).toBe('MISSION_FULL');
  expect(await prisma.spaceMissionParticipation.count({ where: { missionId: m.id, optedOutAt: null } })).toBe(5);
  expect(await prisma.spaceMissionInvitation.count({ where: { state: 'ACCEPTED' } })).toBe(1);
  expect(await prisma.spaceMissionInvitation.count({ where: { state: 'PENDING' } })).toBe(1);
});

test.each(['sender-leave', 'recipient-remove', 'sender-remove', 'recipient-role-loss', 'sender-role-loss', 'disable', 'recipient-erasure', 'sender-erasure']
  .flatMap(invalidation => [0, 1].map(winner => ({ invalidation, winner: winner as 0 | 1 }))))(
  'independent actual acceptance versus $invalidation, forced commit winner $winner', async ({ invalidation, winner }) => {
    const { m, row } = await delivered();
    const invalidate = async () => {
      if (invalidation === 'sender-leave') return leave(m.id, 'learner0');
      if (invalidation === 'recipient-remove') return remove('learner1');
      if (invalidation === 'sender-remove') return remove('learner0');
      if (invalidation === 'recipient-role-loss') return role('learner1', 'INSTRUCTOR');
      if (invalidation === 'sender-role-loss') return role('learner0', 'INSTRUCTOR');
      if (invalidation === 'disable') return setInvitationPreference('learner1', { enabled: false, expectedRevision: 1 });
      if (invalidation === 'recipient-erasure') return erase('learner1');
      return erase('learner0');
    };
    const results = await controlledRealCommitOrder([() => decision(m.id, row.id), invalidate], winner);
    expect(results[1].status).toBe('fulfilled');
    if (winner === 1) expect(results[0].status).toBe('rejected');
    expect(await prisma.spaceMissionInvitation.count({ where: { state: 'PENDING' } })).toBe(0); expect(await prisma.notification.count()).toBe(0);
    if (invalidation !== 'recipient-erasure') {
      const current = await prisma.spaceMissionInvitation.findUniqueOrThrow({ where: { id: row.id } });
      expect(current.state).toBe(winner === 0 ? 'ACCEPTED' : 'REVOKED');
      for (const field of terminalFields) expect(current[field]).toBeNull();
    }
  });

test('absent-zero account fence is materialized on official role loss before first send and never resets on return', async () => {
  const m = await mission(); await join(m.id, 'learner0'); const body = await sendInput(m.id);
  expect(await prisma.spaceMissionInvitationSetting.count({ where: { userId: 'learner0' } })).toBe(0);
  await role('learner0', 'INSTRUCTOR'); await role('learner0', 'USER'); await join(m.id, 'learner0', 1);
  expect(await prisma.spaceMissionInvitationSetting.findUniqueOrThrow({ where: { userId: 'learner0' } })).toMatchObject({ enabled: false, accountEpoch: 1, revision: 1 });
  await expect(send(m.id, body)).rejects.toMatchObject({ status: 409 });
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0);
});

test('expiry exact instant uses strict boundary while GET remains write-free, then authorized decision latches expired', async () => {
  const { m, row } = await delivered();
  jest.useFakeTimers({ doNotFake: ['performance', 'hrtime', 'queueMicrotask', 'nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  try {
    jest.setSystemTime(new Date(row.expiresAt!.getTime() - 1)); expect((await pending()).items).toHaveLength(1);
    jest.setSystemTime(row.expiresAt!); expect((await pending()).items).toHaveLength(0);
    expect(await prisma.spaceMissionInvitation.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: 'PENDING' });
    await expect(decision(m.id, row.id)).rejects.toMatchObject({ status: 404 }); await assertTerminal(row.id, 'EXPIRED');
  } finally { jest.useRealTimers(); }
});

/** Historical expired rows can exceed the effective-pending10 cap without a
 * cleanup scheduler. Large fixtures must be bounded during an authorized write. */
async function seedExpiredInvitationHistory(count = 205) {
  await enable();
  const createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(createdAt.getTime() + 7 * 24 * 60 * 60 * 1000);
  const spaceIds = Array.from({ length: count }, (_, i) => `bulk-scope-${i}`);
  const missionIds = Array.from({ length: count }, (_, i) => `bulk-mission-${i}`);
  const invitationIds = Array.from({ length: count }, (_, i) => `bulk-invitation-${i}`);
  await prisma.space.createMany({ data: spaceIds.map(id => ({ id, name: id, description: 'Synthetic expired invitation history', visibility: 'PRIVATE' })) });
  await prisma.spaceMember.createMany({ data: spaceIds.flatMap(spaceId => ['learner0', 'learner1'].map(userId => ({ spaceId, userId }))) });
  await prisma.spaceMission.createMany({ data: missionIds.map((id, i) => ({ id, spaceId: spaceIds[i], creatorId: 'admin',
    title: 'Synthetic old invitation mission', prompt: 'A synthetic historical prompt.', requestId: 'bulk-create', payloadDigest: 'a'.repeat(64), invitationAttemptCount: 1 })) });
  await prisma.spaceMissionParticipation.createMany({ data: missionIds.map(missionId => ({ missionId, userId: 'learner0', epoch: 1 })) });
  await prisma.spaceMissionInvitationRequest.createMany({ data: missionIds.map(missionId => ({ missionId, senderId: 'learner0', requestId: 'bulk-request', payloadDigest: 'b'.repeat(64) })) });
  await prisma.spaceMissionInvitation.createMany({ data: invitationIds.map((id, i) => ({ id, missionId: missionIds[i], recipientId: 'learner1', senderId: 'learner0',
    state: 'PENDING', revision: 1, createdAt, expiresAt, senderEpoch: 1, senderAccessEpoch: 0, senderAccountEpoch: 0,
    recipientAccessEpoch: 0, recipientAccountEpoch: 0, recipientSettingRevision: 1, recipientEpoch: 0 })) });
  await prisma.notification.createMany({ data: invitationIds.map(targetId => ({ userId: 'learner1', type: 'SYSTEM', targetType: 'SPACE_MISSION_INVITATION',
    targetId, content: 'Du hast eine Einladung zu einer Space-Mission.' })) });
  return { spaceIds, missionIds, invitationIds };
}

test('new authorized send batch-settles more than200 expired incoming rows before loading current actor/fence snapshot', async () => {
  const history = await seedExpiredInvitationHistory();
  expect((await pending()).items).toHaveLength(0);
  expect(await prisma.spaceMissionInvitation.count({ where: { state: 'PENDING' } })).toBe(205);
  const m = await mission(); await join(m.id, 'learner0'); const body = await sendInput(m.id);
  const queries: string[] = jest.requireMock('@/lib/prisma').__queries; queries.length = 0;
  await send(m.id, body);
  expect(queries.filter(query => /^\s*DELETE\b/i.test(query) && query.includes('Notification')).length).toBeGreaterThanOrEqual(2);
  expect(await prisma.spaceMissionInvitation.count({ where: { id: { in: history.invitationIds }, state: 'EXPIRED', senderId: null,
    createdAt: null, expiresAt: null, senderEpoch: null, senderAccessEpoch: null, senderAccountEpoch: null,
    recipientAccessEpoch: null, recipientAccountEpoch: null, recipientSettingRevision: null, recipientEpoch: null, revision: 2 } })).toBe(205);
  expect((await pending()).items).toHaveLength(1); expect(await prisma.notification.count()).toBe(1);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(206);
});

test('official recipient erasure batches more than200 invitation notices and rows atomically while sender-only receipts survive', async () => {
  const history = await seedExpiredInvitationHistory();
  const queries: string[] = jest.requireMock('@/lib/prisma').__queries; queries.length = 0;
  await erase('learner1');
  expect(queries.filter(query => /^\s*DELETE\b/i.test(query) && query.includes('SpaceMissionInvitation') && !query.includes('Request') && !query.includes('Access') && !query.includes('Setting')).length).toBeGreaterThanOrEqual(2);
  expect(await prisma.spaceMissionInvitation.count()).toBe(0); expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationSetting.count({ where: { userId: 'learner1' } })).toBe(0);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(205);
  expect(await prisma.spaceMission.count({ where: { id: { in: history.missionIds }, invitationAttemptCount: 1 } })).toBe(205);
});

test('official sender then recipient erasure batches more than200 source rows without retaining account-linked records', async () => {
  const history = await seedExpiredInvitationHistory(); await erase('learner0');
  expect(await prisma.spaceMissionInvitation.count({ where: { state: 'REVOKED', revision: 2, senderId: null, createdAt: null, expiresAt: null } })).toBe(205);
  expect(await prisma.notification.count()).toBe(0); expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0);
  await erase('learner1'); expect(await prisma.spaceMissionInvitation.count()).toBe(0);
  expect(await prisma.spaceMissionInvitationSetting.count()).toBe(0); expect(await prisma.spaceMissionInvitationAccess.count()).toBe(0);
  expect(await prisma.spaceMission.count({ where: { id: { in: history.missionIds }, invitationAttemptCount: 1 } })).toBe(205);
});

test.each([0, 1] as const)('independent normal last-slot join versus invitation accept, forced commit winner %i', async winner => {
  const { m, row } = await delivered(); for (let i = 2; i <= 4; i++) await join(m.id, `learner${i}`);
  const results = await controlledRealCommitOrder([() => decision(m.id, row.id), () => join(m.id, 'learner5')], winner);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(await prisma.spaceMissionParticipation.count({ where: { missionId: m.id, optedOutAt: null } })).toBe(5);
  expect(await prisma.spaceMissionInvitation.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ state: winner === 0 ? 'ACCEPTED' : 'PENDING' });
});

test.each([0, 1] as const)('independent changed-payload same-key race conflicts without partial second target, forced commit winner %i', async winner => {
  const m = await mission(); await join(m.id, 'learner0'); await enable(); await enable('learner2');
  const [a, b] = await Promise.all([sendInput(m.id), sendInput(m.id, 'learner2')]);
  const results = await controlledRealCommitOrder([() => send(m.id, a), () => send(m.id, b)], winner);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find(result => result.status === 'rejected') as { reason: { status: number } }; expect(rejected.reason.status).toBe(409);
  expect(await prisma.spaceMissionInvitationRequest.count()).toBe(1); expect(await prisma.spaceMissionInvitation.count()).toBe(1); expect(await prisma.notification.count()).toBe(1);
  expect(await prisma.spaceMissionInvitation.findFirstOrThrow()).toMatchObject({ recipientId: winner === 0 ? 'learner1' : 'learner2' });
});

const privateDiagnosticMarker = 'SYNTHETIC_PRIVATE_RECIPIENT_SELECTION_TOKEN_SPACE_MISSION_BODY';
function assertPrivateDiagnostics(operation: string, code: string) {
  const calls = jest.mocked(console.error).mock.calls;
  expect(calls).toEqual([['SPACE_MISSION_INVITATION_FAILURE', { operation, code }]]);
  expect(JSON.stringify(calls)).not.toContain(privateDiagnosticMarker);
}

test.each(['invitation-preference.read', 'invitation-preference.update', 'invitation-candidates.search',
  'invitation.send', 'invitations.list', 'invitation.read', 'invitation.decide'] as const)
('private invitation diagnostics redact unknown failures in actual %s route', async operation => {
  const { m, row, body } = await delivered();
  const actions = {
    'invitation-preference.read': () => getPreference(),
    'invitation-preference.update': () => putPreference(request('PUT', { enabled: false, expectedRevision: 1 })),
    'invitation-candidates.search': () => getCandidates(request('GET', undefined, '/?q=Learner'), context(m.id)),
    'invitation.send': () => postInvitation(request('POST', body), context(m.id)),
    'invitations.list': () => getPending(request()),
    'invitation.read': () => getInvitation(request(), detailContext(m.id, row.id)),
    'invitation.decide': () => postDecision(request('POST', { decision: 'ACCEPT', expectedRevision: 1 }), detailContext(m.id, row.id)),
  };
  session(operation === 'invitation.send' || operation === 'invitation-candidates.search' ? 'learner0' : 'learner1');
  jest.mocked(console.error).mockClear();
  const failure = Object.assign(new Error(privateDiagnosticMarker), { token: privateDiagnosticMarker,
    recipientId: privateDiagnosticMarker, spaceId: privateDiagnosticMarker, missionId: privateDiagnosticMarker });
  const transaction = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(failure);
  try {
    const response = await actions[operation]();
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).not.toContain(privateDiagnosticMarker);
    assertPrivateDiagnostics(operation, 'UNEXPECTED');
  } finally { transaction.mockRestore(); }
});

test('private invitation diagnostics distinguish genuine installed Prisma errors without serializing metadata', async () => {
  for (const [code, expected] of [['P2010', 'P2010'], [privateDiagnosticMarker, 'PRISMA_ERROR']]) {
    jest.mocked(console.error).mockClear();
    const error = new Prisma.PrismaClientKnownRequestError(privateDiagnosticMarker, { code, clientVersion: '7.10.0',
      meta: { recipientId: privateDiagnosticMarker, sql: privateDiagnosticMarker, arguments: privateDiagnosticMarker } });
    const response = invitationErrorResponse(error, 'Einladung konnte nicht verarbeitet werden', 'invitation.send');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(privateDiagnosticMarker);
    assertPrivateDiagnostics('invitation.send', expected);
  }
  // A genuine instance can still have an exceptional accessor. Read once.
  jest.mocked(console.error).mockClear(); let reads = 0;
  const changing = new Prisma.PrismaClientKnownRequestError(privateDiagnosticMarker, { code: 'P2010', clientVersion: '7.10.0' });
  Object.defineProperty(changing, 'code', { get() { reads++; return reads === 1 ? 'P2010' : privateDiagnosticMarker; } });
  reportInvitationFailure('invitation.send', changing);
  expect(reads).toBe(1); assertPrivateDiagnostics('invitation.send', 'P2010');
  jest.mocked(console.error).mockClear();
  const throwing = new Prisma.PrismaClientKnownRequestError(privateDiagnosticMarker, { code: 'P2010', clientVersion: '7.10.0' });
  Object.defineProperty(throwing, 'code', { get() { throw Error(privateDiagnosticMarker); } });
  const response = invitationErrorResponse(throwing, 'Fester Fehler', 'invitation.send');
  expect(response.status).toBe(500); expect(await response.text()).not.toContain(privateDiagnosticMarker);
  assertPrivateDiagnostics('invitation.send', 'UNEXPECTED');
});

test('private invitation diagnostics distinguish genuine installed adapter errors without original message/code leakage', () => {
  for (const [code, expected] of [['40001', '40001'], ['SQLITE_BUSY_SNAPSHOT', 'SQLITE_BUSY_SNAPSHOT'], [privateDiagnosticMarker, 'ADAPTER_ERROR']]) {
    jest.mocked(console.error).mockClear();
    const error = new DriverAdapterError({ kind: 'TransactionWriteConflict', originalCode: code, originalMessage: privateDiagnosticMarker });
    reportInvitationFailure('invitation.send', error);
    assertPrivateDiagnostics('invitation.send', expected);
  }
  jest.mocked(console.error).mockClear(); let reads = 0;
  const changing = new DriverAdapterError({ kind: 'TransactionWriteConflict', originalCode: '40001', originalMessage: privateDiagnosticMarker });
  Object.defineProperty(changing.cause, 'originalCode', { get() { reads++; return reads === 1 ? '40001' : privateDiagnosticMarker; } });
  reportInvitationFailure('invitation.send', changing);
  expect(reads).toBe(1); assertPrivateDiagnostics('invitation.send', '40001');
  for (const field of ['cause', 'originalCode']) {
    jest.mocked(console.error).mockClear();
    const throwing = new DriverAdapterError({ kind: 'TransactionWriteConflict', originalCode: '40001' });
    Object.defineProperty(field === 'cause' ? throwing : throwing.cause, field, { get() { throw Error(privateDiagnosticMarker); } });
    expect(() => reportInvitationFailure('invitation.send', throwing)).not.toThrow();
    assertPrivateDiagnostics('invitation.send', 'UNEXPECTED');
  }
});

test('private invitation diagnostics never treat lookalikes or getters as genuine error metadata', () => {
  const getter = Object.defineProperty({}, 'code', { get() { throw Error(privateDiagnosticMarker); } });
  for (const error of [new Error(privateDiagnosticMarker), { code: 'P2010', message: privateDiagnosticMarker },
    { cause: { kind: 'TransactionWriteConflict', originalCode: '40001', originalMessage: privateDiagnosticMarker } }, getter]) {
    jest.mocked(console.error).mockClear(); reportInvitationFailure('invitation.send', error);
    assertPrivateDiagnostics('invitation.send', 'UNEXPECTED');
  }
  jest.mocked(console.error).mockClear();
  reportInvitationFailure(privateDiagnosticMarker as never, new Error(privateDiagnosticMarker));
  assertPrivateDiagnostics('invitation.unknown', 'UNEXPECTED');
});

test('private invitation diagnostics keep every existing expected API/input/cursor error response unchanged and quiet', async () => {
  const errors = [new RequestBodyLimitError(privateDiagnosticMarker), new InvalidJsonBodyError(), new InvalidPaginationError(), new InvalidSpaceCursorError(),
    ...[400, 401, 403, 404, 409, 503].map(status => new SpaceApiError('Fester öffentlicher Fehler', status)),
    new SpaceApiError('Mission ist geschlossen', 409, 'MISSION_CLOSED')];
  for (const error of errors) {
    jest.mocked(console.error).mockClear();
    const baseline = spaceErrorResponse(error, 'Fester Fehler');
    const response = invitationErrorResponse(error, 'Fester Fehler', 'invitation.decide');
    expect(response.status).toBe(baseline.status);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual(await baseline.json());
    expect(console.error).not.toHaveBeenCalled();
  }
});

test.each(['P2002', 'P2034', 'P1008'])('private invitation retry rejects %s lookalikes without an extra transaction attempt', async code => {
  let attempts = 0;
  const lookalike = { code, meta: { driverAdapterError: { cause: { kind: 'SocketTimeout', originalCode: 'SQLITE_BUSY_SNAPSHOT' } } }, message: privateDiagnosticMarker };
  await expect(invitationTransaction(async () => { attempts++; throw lookalike; })).rejects.toBe(lookalike);
  expect(attempts).toBe(1);
});

/** Only the schema generated by this exact guarded test fixture may own raw DDL. */
function privateInvitationPgFixtureSchema(): string {
  const schema = (jest.requireMock('@/lib/prisma') as { __schema?: unknown }).__schema;
  if (typeof schema !== 'string' || !/^forge_invitation_[0-9a-f]{8}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{4}_[0-9a-f]{12}$/.test(schema)) {
    throw new Error('Private PostgreSQL invitation fixture schema is missing or invalid.');
  }
  return schema;
}

test.each([undefined, null, '', 'public', 'forge_invitation_invalid', 'forge_invitation_12345678_1234_1234_1234_123456789abc".public'])
('private invitation PG DDL rejects missing or invalid own fixture schema: %p', schema => {
  const fixture = jest.requireMock('@/lib/prisma') as { __schema?: unknown };
  const prior = Object.getOwnPropertyDescriptor(fixture, '__schema');
  try {
    Object.defineProperty(fixture, '__schema', { value: schema, configurable: true, writable: true });
    expect(() => privateInvitationPgFixtureSchema()).toThrow('Private PostgreSQL invitation fixture schema is missing or invalid.');
  } finally {
    if (prior) Object.defineProperty(fixture, '__schema', prior);
    else delete fixture.__schema;
  }
});

test('private invitation diagnostics redact an actual provider SQL-trigger failure and roll back the whole receipt/quota transaction', async () => {
  const postgresql = process.env.DATABASE_PROVIDER === 'postgresql';
  // Validate the actual fixture metadata before any raw SQL; never infer a
  // schema from process environment, a URL, or the global search_path.
  const schema = postgresql ? privateInvitationPgFixtureSchema() : null;
  const pgFunction = schema ? `"${schema}"."invitation_private_failure"` : null;
  const pgRequestTable = schema ? `"${schema}"."SpaceMissionInvitationRequest"` : null;
  const publicObjects = () => prisma.$queryRawUnsafe<{ kind: string; name: string; definition: string }[]>(`
    SELECT 'relation'::text AS kind, c.relname::text AS name, c.relkind::text AS definition
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    UNION ALL SELECT 'function', p.proname::text || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')', pg_catalog.pg_get_functiondef(p.oid)
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    UNION ALL SELECT 'trigger', c.relname::text || '.' || t.tgname::text, pg_catalog.pg_get_triggerdef(t.oid)
      FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal
    ORDER BY kind,name,definition`);
  const publicBefore = postgresql ? await publicObjects() : null;
  const m = await mission(); await join(m.id, 'learner0'); await enable(); const body = await sendInput(m.id); session('learner0');
  let functionCreated = false; let triggerCreated = false;
  try {
    if (postgresql) {
      await prisma.$executeRawUnsafe(`CREATE FUNCTION ${pgFunction}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${privateDiagnosticMarker}'; END; $$ LANGUAGE plpgsql`);
      functionCreated = true;
      await prisma.$executeRawUnsafe(`CREATE TRIGGER invitation_private_failure BEFORE INSERT ON ${pgRequestTable} FOR EACH ROW EXECUTE FUNCTION ${pgFunction}()`);
      triggerCreated = true;
      expect(await publicObjects()).toEqual(publicBefore);
    } else {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER invitation_private_failure BEFORE INSERT ON "SpaceMissionInvitationRequest" BEGIN SELECT RAISE(ABORT, '${privateDiagnosticMarker}'); END`);
      triggerCreated = true;
    }
    jest.mocked(console.error).mockClear();
    const response = await postInvitation(request('POST', body), context(m.id));
    expect(response.status).toBe(500);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).not.toContain(privateDiagnosticMarker);
    const calls = jest.mocked(console.error).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('SPACE_MISSION_INVITATION_FAILURE');
    const diagnostic = calls[0][1] as { operation: string; code: string };
    expect(diagnostic.operation).toBe('invitation.send');
    // Locked Prisma7 SQLite maps this actual trigger failure to P2003.
    expect(postgresql ? ['P2003', 'P2004', 'P2010', 'P2011', 'P0001', 'PRISMA_ERROR', 'ADAPTER_ERROR'] : ['P2003']).toContain(diagnostic.code);
    expect(Object.keys(diagnostic).sort()).toEqual(['code', 'operation']);
    expect(JSON.stringify(calls)).not.toContain(privateDiagnosticMarker);
    expect(await prisma.spaceMissionInvitationRequest.count()).toBe(0);
    expect(await prisma.spaceMissionInvitation.count()).toBe(0);
    expect(await prisma.notification.count()).toBe(0);
    expect((await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).invitationAttemptCount).toBe(0);
  } finally {
    // A partial setup failure still drops only objects created in our own
    // schema. Nested finally blocks always recheck public even if cleanup fails.
    try {
      if (triggerCreated) await prisma.$executeRawUnsafe(postgresql
        ? `DROP TRIGGER IF EXISTS invitation_private_failure ON ${pgRequestTable}` : 'DROP TRIGGER IF EXISTS invitation_private_failure');
    } finally {
      try {
        if (functionCreated) await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${pgFunction}()`);
      } finally {
        if (postgresql) expect(await publicObjects()).toEqual(publicBefore);
      }
    }
  }
  expect((await postInvitation(request('POST', body), context(m.id))).status).toBe(200);
  expect(await prisma.notification.count()).toBe(1);
  expect((await prisma.spaceMission.findUniqueOrThrow({ where: { id: m.id } })).invitationAttemptCount).toBe(1);
});

test('private invitation inbox boundary strips original failure before unchanged global handlers can log it', async () => {
  const { row } = await delivered(); jest.mocked(console.error).mockClear();
  const transaction = jest.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error(privateDiagnosticMarker));
  try {
    const error = await resolveMissionInvitationTargets([row.id], 'learner1').catch(error => error as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('MISSION_INVITATION_RESOLUTION_FAILED');
    expect(String(error)).not.toContain(privateDiagnosticMarker);
    assertPrivateDiagnostics('invitation-targets.resolve', 'UNEXPECTED');
  } finally { transaction.mockRestore(); }
});
