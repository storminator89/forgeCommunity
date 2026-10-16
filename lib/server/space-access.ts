import 'server-only';

import { Prisma, type SpaceVisibility } from '@prisma/client';
import prisma from '@/lib/prisma';

const snapshotViewer = Symbol('space-viewer-snapshot');
const snapshotAccess = Symbol('space-access-snapshot');
export type SpaceViewer = { userId: string | null; isAdmin: boolean; readonly [snapshotViewer]: true };

export interface SpaceSummary {
  id: string;
  name: string;
  description: string;
  visibility: SpaceVisibility;
  createdAt: string;
  updatedAt: string;
  memberCount: number;
  discussionCount: number;
  isMember: boolean;
  canManage: boolean;
  canWrite: boolean;
}

export interface SpaceAccess {
  readonly [snapshotAccess]: true;
  space: SpaceSummary;
  isMember: boolean;
  canManage: boolean;
  canWrite: boolean;
}

const idPattern = /^[A-Za-z0-9_-]{1,100}$/;

export function validSpaceId(value: unknown): value is string {
  return typeof value === 'string' && idPattern.test(value);
}

/** Resolve role only inside the same transaction as the protected read. */
export async function resolveSpaceViewer(userId: string | null | undefined, tx: Prisma.TransactionClient): Promise<SpaceViewer> {
  if (!validSpaceId(userId)) return { userId: null, isAdmin: false, [snapshotViewer]: true };
  const account = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  return { userId: account?.id ?? null, isAdmin: account?.role === 'ADMIN', [snapshotViewer]: true };
}

/** PUBLIC means open to signed-in community members, never to anonymous visitors. */
export function readableSpaceWhere(viewer: SpaceViewer): Prisma.SpaceWhereInput {
  if (!viewer.userId) return { id: { in: [] } };
  if (viewer.isAdmin) return {};
  return { OR: [
    { visibility: 'PUBLIC' },
    { members: { some: { userId: viewer.userId } } },
  ] };
}

/** Writing to either kind of space requires a current membership row. */
export function writableSpaceWhere(userId: string): Prisma.SpaceWhereInput {
  return validSpaceId(userId) ? { members: { some: { userId } } } : { id: { in: [] } };
}

/** Keep the directory and detail projections identical and bounded. */
export function spaceSummarySelect(viewer: SpaceViewer) {
  return {
    id: true, name: true, description: true, visibility: true,
    createdAt: true, updatedAt: true,
    _count: { select: { members: true, discussions: { where: { hiddenAt: null } } } },
    members: {
      where: { userId: viewer.userId ?? '' },
      take: 1,
      select: { userId: true },
    },
  } satisfies Prisma.SpaceSelect;
}

type SpaceSummaryRow = {
  id: string;
  name: string;
  description: string;
  visibility: SpaceVisibility;
  createdAt: Date;
  updatedAt: Date;
  _count: { members: number; discussions: number };
  members: Array<{ userId: string }>;
};

export function normalizeSpaceSummary(row: SpaceSummaryRow, viewer: SpaceViewer): SpaceSummary {
  const isMember = row.members.some(member => member.userId === viewer.userId);
  return {
    id: row.id, name: row.name, description: row.description, visibility: row.visibility,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    memberCount: row._count.members, discussionCount: row._count.discussions,
    isMember, canManage: viewer.isAdmin, canWrite: isMember,
  };
}

/** Apply the visibility predicate before materializing name or counts. */
export async function getReadableSpace(spaceId: string, userId?: string | null, tx?: Prisma.TransactionClient): Promise<SpaceAccess | null> {
  if (!validSpaceId(spaceId)) return null;
  // The default path must not do a role read and then a Space read as separate
  // autocommit statements: an ADMIN could be demoted between those statements.
  if (!tx) return prisma.$transaction(db => getReadableSpace(spaceId, userId, db),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const viewer = await resolveSpaceViewer(userId, tx);
  if (!viewer.userId) return null;
  const row = await tx.space.findFirst({
    where: { AND: [{ id: spaceId }, readableSpaceWhere(viewer)] },
    select: spaceSummarySelect(viewer),
  });
  if (!row) return null;
  const space = normalizeSpaceSummary(row, viewer);
  return { space, isMember: space.isMember, canManage: space.canManage, canWrite: space.canWrite,
    [snapshotAccess]: true };
}

/** Pair with getReadableSpace in the same transaction before selecting content. */
export function readableSpaceDiscussionWhere(access: SpaceAccess): Prisma.SpaceDiscussionWhereInput {
  return validSpaceId(access.space.id)
    ? { spaceId: access.space.id, ...(access.canManage ? {} : { hiddenAt: null }) }
    : { id: { in: [] } };
}

/** Scope the reply and its parent together, including hidden-parent exclusion. */
export function readableSpaceReplyWhere(access: SpaceAccess, discussionId: string): Prisma.SpaceReplyWhereInput {
  if (!validSpaceId(access.space.id) || !validSpaceId(discussionId)) return { id: { in: [] } };
  return {
    discussionId,
    ...(access.canManage ? {} : { hiddenAt: null }),
    discussion: { spaceId: access.space.id, ...(access.canManage ? {} : { hiddenAt: null }) },
  };
}

/** Use in the same transaction as a protected write. */
export async function isSpaceMember(spaceId: string, userId: string, tx: Prisma.TransactionClient): Promise<boolean> {
  if (!validSpaceId(spaceId) || !validSpaceId(userId)) return false;
  const row = await tx.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } }, select: { userId: true },
  });
  return Boolean(row);
}
