import prisma from '@/lib/prisma';
import { readAsAdmin } from '@/lib/server/admin-read';

jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() }, $transaction: jest.fn() },
}));

const currentRole = prisma.user.findUnique as jest.Mock;

beforeEach(() => jest.clearAllMocks());

test.each([null, { role: 'USER' }, { role: 'MODERATOR' }])('denies a current non-admin before protected reads: %j', async actor => {
  currentRole.mockResolvedValueOnce(actor);
  const read = jest.fn();
  await expect(readAsAdmin('actor', read)).resolves.toEqual({ authorized: false });
  expect(read).not.toHaveBeenCalled();
});

test('reads as an admin on D1 without starting an interactive transaction', async () => {
  currentRole.mockResolvedValue({ role: 'ADMIN' });
  const data = { privateContact: 'Only for admins' };
  const read = jest.fn().mockResolvedValue(data);
  await expect(readAsAdmin('actor', read)).resolves.toEqual({ authorized: true, data });
  expect(currentRole).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledWith(prisma);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});

test.each([null, { role: 'USER' }])('discards protected data when authority is revoked during the read: %j', async actor => {
  currentRole.mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce(actor);
  await expect(readAsAdmin('actor', async () => ({ privateContact: 'must not be returned' })))
    .resolves.toEqual({ authorized: false });
});

test('propagates database failures instead of returning partial protected data', async () => {
  currentRole.mockResolvedValueOnce({ role: 'ADMIN' });
  await expect(readAsAdmin('actor', async () => { throw new Error('database failure'); }))
    .rejects.toThrow('database failure');
});
