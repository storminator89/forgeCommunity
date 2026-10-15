import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import { ChatProvider, useChat } from '@/contexts/ChatContext';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));

const mockFetch = global.fetch as jest.Mock;
const channel = { id: 'room', name: 'Room', isPrivate: false, hasUnread: true, _count: { members: 1 } };
const message = { id: 'm1', channelId: 'room', content: 'hello',
  author: { id: 'other', name: 'Other', image: null },
  createdAt: '2026-10-15T12:00:00.000Z', messageType: 'text' };

function response(body: unknown) {
  return { ok: true, json: async () => body };
}

function Probe() {
  const { channels, loadedChannelId, markRead } = useChat();
  return <>
    <span data-testid="unread">{String(channels[0]?.hasUnread)}</span>
    <span data-testid="loaded">{loadedChannelId ?? 'none'}</span>
    <button type="button" onClick={() => void markRead('room', 'm1')}>Mark read</button>
  </>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'reader', role: 'USER' } }, status: 'authenticated' } as never);
});

test('channel dot clears only after the server acknowledges the persisted read', async () => {
  let resolveMark!: (value: ReturnType<typeof response>) => void;
  const pendingMark = new Promise<ReturnType<typeof response>>(resolve => { resolveMark = resolve; });
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'reader', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') return Promise.resolve(response([channel]));
    if (url.includes('/api/chat/messages?')) return Promise.resolve(response({ items: [message], hasMore: false,
      nextCursor: { after: message.createdAt, afterId: message.id } }));
    if (url === '/api/chat/channels/room/read') return pendingMark;
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ChatProvider><Probe /></ChatProvider>);
  await waitFor(() => expect(screen.getByTestId('loaded')).toHaveTextContent('room'));
  expect(screen.getByTestId('unread')).toHaveTextContent('true');
  fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
  expect(mockFetch.mock.calls.filter(([url]) => url === '/api/chat/channels/room/read')).toHaveLength(1);
  expect(screen.getByTestId('unread')).toHaveTextContent('true');
  await act(async () => { resolveMark(response({ hasUnread: false })); });
  await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('false'));
  fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
  expect(mockFetch.mock.calls.filter(([url]) => url === '/api/chat/channels/room/read')).toHaveLength(1);
});
