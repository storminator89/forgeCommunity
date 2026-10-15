import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import ChatPage from '@/app/chat/page';
import { ChatProvider } from '@/contexts/ChatContext';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

const mockFetch = global.fetch as jest.Mock;
const channel = { id: 'room', name: 'Allgemein', isPrivate: false, _count: { members: 1 } };
const at = '2026-10-15T12:00:00.000Z';
const all = Array.from({ length: 130 }, (_, index) => ({
  id: `m${String(index).padStart(3, '0')}`, channelId: channel.id,
  content: `message-${index}`, createdAt: at, messageType: 'text',
  author: { id: 'other', name: 'Other', image: null },
}));

function response(body: unknown) {
  return { ok: true, json: async () => body };
}

it('keeps loaded older pages and the same log scroll when NextAuth refreshes the same user object', async () => {
  let resolveOlder!: (value: ReturnType<typeof response>) => void;
  const olderPage = new Promise<ReturnType<typeof response>>(resolve => { resolveOlder = resolve; });
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'member', name: 'Initial', role: 'USER' } }, status: 'authenticated' } as never);
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'member', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') return Promise.resolve(response([channel]));
    if (url.includes('latest=true')) return Promise.resolve(response({ items: all.slice(80), hasMore: true }));
    if (url.includes('beforeId=m080')) return olderPage;
    throw new Error(`Unexpected request: ${url}`);
  });

  const view = render(<ChatProvider><ChatPage /></ChatProvider>);
  const log = await screen.findByRole('log', { name: 'Nachrichten' });
  await waitFor(() => expect(log.querySelectorAll('article')).toHaveLength(50));
  let height = 1000;
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => height });
  Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 });
  log.scrollTop = 100;
  fireEvent.scroll(log);
  fireEvent.click(screen.getByRole('button', { name: 'Ältere Nachrichten laden' }));
  await waitFor(() => expect(mockFetch.mock.calls.some(([url]) => String(url).includes('beforeId=m080'))).toBe(true));
  height = 1500;
  await act(async () => { resolveOlder(response({ items: all.slice(30, 80), hasMore: true })); });
  await waitFor(() => expect(log.querySelectorAll('article')).toHaveLength(100));
  expect(log.scrollTop).toBe(600);

  const requestCount = mockFetch.mock.calls.length;
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'member', name: 'Refreshed', role: 'USER' } }, status: 'authenticated' } as never);
  view.rerender(<ChatProvider><ChatPage /></ChatProvider>);
  expect(screen.getByRole('log', { name: 'Nachrichten' })).toBe(log);
  expect(log.querySelectorAll('article')).toHaveLength(100);
  expect(log.scrollTop).toBe(600);
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(mockFetch).toHaveBeenCalledTimes(requestCount);
});
