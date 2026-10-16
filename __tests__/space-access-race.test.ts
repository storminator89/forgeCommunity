/** @jest-environment node */

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  $transaction: jest.fn(),
  user: { findUnique: jest.fn() },
  space: { findFirst: jest.fn() },
} }));

import prisma from '@/lib/prisma';
import { getReadableSpace, readableSpaceDiscussionWhere, readableSpaceReplyWhere,
  type SpaceAccess } from '@/lib/server/space-access';

const root = prisma as unknown as {
  $transaction: jest.Mock;
  user: { findUnique: jest.Mock };
  space: { findFirst: jest.Mock };
};

beforeEach(() => jest.clearAllMocks());

test('default Space read uses a serializable snapshot across ADMIN demotion', async () => {
  // A formerly privileged account exists outside this read. Reading its old
  // role and then the Space in separate statements would expose the title.
  root.user.findUnique.mockResolvedValue({ id: 'viewer', role: 'ADMIN' });
  root.space.findFirst.mockResolvedValue({ id: 'private', name: 'Secret' });

  const tx = {
    user: { findUnique: jest.fn().mockResolvedValue({ id: 'viewer', role: 'USER' }) },
    space: { findFirst: jest.fn().mockImplementation(({ where }: { where: { AND: Array<{ OR?: unknown }> } }) => {
      // No membership and PRIVATE visibility in the current snapshot.
      return where.AND[1].OR ? null : { id: 'private', name: 'Secret' };
    }) },
  };
  root.$transaction.mockImplementation((work: (db: typeof tx) => Promise<unknown>) => work(tx));

  await expect(getReadableSpace('private', 'viewer')).resolves.toBeNull();
  expect(root.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  expect(tx.user.findUnique).toHaveBeenCalledTimes(1);
  expect(tx.space.findFirst).toHaveBeenCalledTimes(1);
  expect(tx.space.findFirst.mock.calls[0][0].where.AND[1]).toEqual({ OR: [
    { visibility: 'PUBLIC' }, { members: { some: { userId: 'viewer' } } },
  ] });
  expect(root.user.findUnique).not.toHaveBeenCalled();
  expect(root.space.findFirst).not.toHaveBeenCalled();
});

test('content predicates exclude hidden discussions, replies, and reply parents', () => {
  const member = { space: { id: 'private' }, canManage: false } as SpaceAccess;
  expect(readableSpaceDiscussionWhere(member)).toEqual({ spaceId: 'private', hiddenAt: null });
  expect(readableSpaceReplyWhere(member, 'discussion')).toEqual({
    discussionId: 'discussion', hiddenAt: null,
    discussion: { spaceId: 'private', hiddenAt: null },
  });
  const admin = { space: { id: 'private' }, canManage: true } as SpaceAccess;
  expect(readableSpaceDiscussionWhere(admin)).toEqual({ spaceId: 'private' });
  expect(readableSpaceReplyWhere(admin, 'discussion')).toEqual({
    discussionId: 'discussion', discussion: { spaceId: 'private' },
  });
});
