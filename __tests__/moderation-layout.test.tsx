/** @jest-environment node */
import ModerationLayout from '@/app/moderation/layout';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn((url: string) => { throw new Error(`redirect:${url}`); }) }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({ __esModule: true, default: { user: { findUnique: jest.fn() } } }));

beforeEach(() => jest.clearAllMocks());

it('sends anonymous visitors to login', async () => {
  (getServerSession as jest.Mock).mockResolvedValue(null);
  await expect(ModerationLayout({ children: 'private' })).rejects.toThrow('redirect:/login');
  expect(prisma.user.findUnique).not.toHaveBeenCalled();
});

it('rejects an ordinary member according to the current database role', async () => {
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'member-1', role: 'ADMIN' } });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ role: 'USER' });
  await expect(ModerationLayout({ children: 'private' })).rejects.toThrow('redirect:/');
});

it.each(['ADMIN', 'MODERATOR'])('allows a %s to load the review page', async (role) => {
  (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'staff-1', role: 'USER' } });
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ role });
  expect(await ModerationLayout({ children: 'private' })).toBe('private');
  expect(redirect).not.toHaveBeenCalled();
});
