/** @jest-environment node */
import AdminLayout from '@/app/admin/layout';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn((url: string) => { throw new Error(`redirect:${url}`); }) }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/components/admin/AdminShell', () => ({ __esModule: true, default: () => null }));

beforeEach(() => jest.clearAllMocks());

it('sends anonymous visitors to login', async () => {
  jest.mocked(getServerSession).mockResolvedValue(null);
  await expect(AdminLayout({ children: 'private' })).rejects.toThrow('redirect:/login');
});

it('rejects a non-admin using the current server session', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'u1', role: 'USER' } });
  await expect(AdminLayout({ children: 'private' })).rejects.toThrow('redirect:/');
  expect(redirect).toHaveBeenCalledWith('/');
});

it('renders the admin shell only for an administrator', async () => {
  jest.mocked(getServerSession).mockResolvedValue({ user: { id: 'a1', role: 'ADMIN' } });
  expect(await AdminLayout({ children: 'private' })).toBeTruthy();
  expect(redirect).not.toHaveBeenCalled();
});
