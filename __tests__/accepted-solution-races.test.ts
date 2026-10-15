/** @jest-environment node */
import { Prisma } from '@prisma/client';
import { changeAcceptedSolution, SolutionError } from '@/lib/server/accepted-solutions';
import prisma from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({ __esModule: true, default: {
  $transaction: jest.fn(), user: { findUnique: jest.fn() }, post: { findUnique: jest.fn() },
  comment: { findUnique: jest.fn() }, acceptedSolution: { findUnique: jest.fn() },
} }));

const fkError = () => new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', { code: 'P2003', clientVersion: '7.10.0' });
const db = prisma as unknown as {
  $transaction: jest.Mock; user: { findUnique: jest.Mock }; post: { findUnique: jest.Mock };
  comment: { findUnique: jest.Mock }; acceptedSolution: { findUnique: jest.Mock };
};
const actor = { id: 'owner' };
const post = { authorId: 'owner', published: true };
const reply = { postId: 'post', authorId: 'helper', author: { isTestAccount: false } };
let tx: {
  user: { findUnique: jest.Mock }; post: { findUnique: jest.Mock }; comment: { findUnique: jest.Mock };
  acceptedSolution: { findUnique: jest.Mock; create: jest.Mock; updateMany: jest.Mock; deleteMany: jest.Mock };
  acceptedSolutionChange: { create: jest.Mock };
};
beforeEach(() => {
  jest.resetAllMocks();
  tx = {
    user: { findUnique: jest.fn().mockResolvedValue(actor) }, post: { findUnique: jest.fn().mockResolvedValue(post) },
    comment: { findUnique: jest.fn().mockResolvedValue(reply) },
    acceptedSolution: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    acceptedSolutionChange: { create: jest.fn().mockResolvedValue({}) },
  };
  db.$transaction.mockImplementation(async (work: (client: unknown) => unknown) => work(tx));
  db.user.findUnique.mockResolvedValue(actor); db.post.findUnique.mockResolvedValue(post);
  db.comment.findUnique.mockResolvedValue(reply); db.acceptedSolution.findUnique.mockResolvedValue(null);
});

test.each(['actor', 'post', 'reply'])('a deterministic %s deletion between read and write resolves by bounded re-read', async erased => {
  tx.acceptedSolution.create.mockImplementationOnce(async () => {
    if (erased === 'actor') { tx.user.findUnique.mockResolvedValue(null); db.user.findUnique.mockResolvedValue(null); }
    if (erased === 'post') { tx.post.findUnique.mockResolvedValue(null); db.post.findUnique.mockResolvedValue(null); }
    if (erased === 'reply') { tx.comment.findUnique.mockResolvedValue(null); db.comment.findUnique.mockResolvedValue(null); }
    throw fkError();
  });
  await expect(changeAcceptedSolution('post', 'owner', 'reply', null)).rejects.toMatchObject({ status: erased === 'actor' ? 401 : 404 });
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.acceptedSolutionChange.create).not.toHaveBeenCalled();
});

test('deleting the old selected reply while changing gives conflict instead of carrying stale authority', async () => {
  tx.acceptedSolution.findUnique.mockResolvedValueOnce({ commentId: 'old', revision: 'old-revision' }).mockResolvedValue(null);
  tx.acceptedSolution.updateMany.mockRejectedValueOnce(fkError());
  db.comment.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'old' ? null : reply);
  await expect(changeAcceptedSolution('post', 'owner', 'reply', 'old-revision')).rejects.toMatchObject({ status: 409 });
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.acceptedSolutionChange.create).not.toHaveBeenCalled();
});

test('deleting the old reply during clear can safely re-read an already cleared no-op', async () => {
  tx.acceptedSolution.findUnique.mockResolvedValueOnce({ commentId: 'old', revision: 'old-revision' }).mockResolvedValue(null);
  tx.acceptedSolution.deleteMany.mockRejectedValueOnce(fkError());
  db.comment.findUnique.mockResolvedValue(null);
  await expect(changeAcceptedSolution('post', 'owner', null, 'old-revision')).resolves.toEqual({ changed: false });
  expect(db.$transaction).toHaveBeenCalledTimes(2);
  expect(tx.acceptedSolutionChange.create).not.toHaveBeenCalled();
});

test('an unexplained FK invariant failure is not hidden behind a retry or friendly target error', async () => {
  const error = fkError(); tx.acceptedSolution.create.mockRejectedValueOnce(error);
  await expect(changeAcceptedSolution('post', 'owner', 'reply', null)).rejects.toBe(error);
  expect(db.$transaction).toHaveBeenCalledTimes(1);
});

test.each(['P2034', 'P2002'])('known %s conflicts are bounded and re-read permission', async code => {
  const error = new Prisma.PrismaClientKnownRequestError('Conflict', { code, clientVersion: '7.10.0' });
  tx.acceptedSolution.create.mockRejectedValue(error);
  await expect(changeAcceptedSolution('post', 'owner', 'reply', null)).rejects.toBeInstanceOf(SolutionError);
  await expect(changeAcceptedSolution('post', 'owner', 'reply', null)).rejects.toMatchObject({ status: 409 });
  expect(db.$transaction).toHaveBeenCalledTimes(8); // Four attempts per request.
  expect(tx.user.findUnique).toHaveBeenCalledTimes(8);
  expect(tx.acceptedSolutionChange.create).not.toHaveBeenCalled();
});

test('an audit FK deletion rolls back the attempt and rechecks actor before retrying', async () => {
  tx.acceptedSolutionChange.create.mockImplementationOnce(async () => {
    tx.user.findUnique.mockResolvedValue(null); db.user.findUnique.mockResolvedValue(null); throw fkError();
  });
  await expect(changeAcceptedSolution('post', 'owner', 'reply', null)).rejects.toMatchObject({ status: 401 });
  expect(db.$transaction).toHaveBeenCalledTimes(2);
});
