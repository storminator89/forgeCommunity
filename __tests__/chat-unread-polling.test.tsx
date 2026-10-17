import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSession } from '@/lib/sites-auth/react';
import { ChatProvider, useChat } from '@/contexts/ChatContext';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));

const mockFetch = global.fetch as jest.Mock;
const room = { id: 'private-room', name: 'Private', isPrivate: true, hasUnread: true, _count: { members: 1 } };
const message = { id: 'm1', channelId: room.id, content: 'hello',
  author: { id: 'other', name: 'Other', image: null },
  createdAt: '2026-10-15T12:00:00.000Z', messageType: 'text' };

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const listCalls = () => mockFetch.mock.calls.filter(([url]) => url === '/api/chat/channels');
async function tick(ms: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}
async function settle() {
  await act(async () => { await Promise.resolve(); });
}

function Probe() {
  const { channels, messages, loadedChannelId, hasNewerMessages, markRead, setCurrentChannel } = useChat();
  return <>
    <span data-testid="rooms">{channels.map(channel => `${channel.id}:${channel.hasUnread}`).join('|')}</span>
    <span data-testid="contents">{messages.map(item => item.content).join('|')}</span>
    <span data-testid="loaded">{loadedChannelId ?? 'none'}</span>
    <span data-testid="pending">{String(hasNewerMessages)}</span>
    {channels.map(channel => <button type="button" key={channel.id} onClick={() => setCurrentChannel(channel)}>
      Open {channel.id}
    </button>)}
    <button type="button" onClick={() => void markRead(room.id, message.id)}>Mark read</button>
  </>;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'reader', role: 'USER' } }, status: 'authenticated' } as never);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('visible list refresh uses two requests per minute and pauses when hidden or offline', async () => {
  const visibility = jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'reader', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') return Promise.resolve(response([]));
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ChatProvider><Probe /></ChatProvider>);
  await tick(0);
  expect(listCalls()).toHaveLength(1);
  await tick(60_000);
  expect(listCalls()).toHaveLength(3); // initial + 30s + 60s, versus seven with 10s polling

  visibility.mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  await tick(120_000);
  expect(listCalls()).toHaveLength(3);
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  await tick(0);
  expect(listCalls()).toHaveLength(4);

  online.mockReturnValue(false);
  fireEvent(window, new Event('offline'));
  await tick(120_000);
  expect(listCalls()).toHaveLength(4);
  online.mockReturnValue(true);
  fireEvent(window, new Event('online'));
  await tick(0);
  expect(listCalls()).toHaveLength(5);
});

test('a slow list request never overlaps and failures back off', async () => {
  const pending = deferred<ReturnType<typeof response>>();
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  let reads = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'reader', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') {
      reads++;
      if (reads === 2) return pending.promise;
      if (reads === 3 || reads === 4) return Promise.resolve(response(null, 503));
      return Promise.resolve(response([]));
    }
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ChatProvider><Probe /></ChatProvider>);
  await tick(0);
  await tick(30_000);
  expect(listCalls()).toHaveLength(2);
  await tick(120_000);
  expect(listCalls()).toHaveLength(2);
  await act(async () => { pending.resolve(response([])); });
  await tick(30_000);
  expect(listCalls()).toHaveLength(3);
  await tick(29_999);
  expect(listCalls()).toHaveLength(3);
  await tick(1);
  expect(listCalls()).toHaveLength(4);
  await tick(59_999);
  expect(listCalls()).toHaveLength(4);
  await tick(1);
  expect(listCalls()).toHaveLength(5);
  expect(errorLog).toHaveBeenCalledTimes(2);
});

test('a delayed pre-revocation list response cannot restore a private room after message access is denied', async () => {
  const staleList = deferred<ReturnType<typeof response>>();
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  let listReads = 0;
  let revoked = false;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'reader', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') return ++listReads === 1 ? Promise.resolve(response([room])) : staleList.promise;
    if (url.includes('/api/chat/messages?') && url.includes('latest=true')) return Promise.resolve(response({ items: [message], hasMore: false }));
    if (url.includes('/api/chat/messages?')) return Promise.resolve(revoked ? response(null, 403) : response({ items: [], hasMore: false }));
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ChatProvider><Probe /></ChatProvider>);
  await tick(0);
  await tick(0);
  expect(screen.getByTestId('loaded')).toHaveTextContent(room.id);
  await tick(30_000);
  expect(listCalls()).toHaveLength(2);
  revoked = true;
  await tick(10_000);
  expect(screen.getByTestId('rooms')).toBeEmptyDOMElement();
  await act(async () => { staleList.resolve(response([room])); });
  await settle();
  expect(screen.getByTestId('rooms')).toBeEmptyDOMElement();
  expect(errorLog).toHaveBeenCalled();
});

test('a permission-filtered list immediately drops the selected private room and its loaded content', async () => {
  let listReads = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'reader', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') return Promise.resolve(response(++listReads === 1 ? [room] : []));
    if (url.includes('/api/chat/messages?') && url.includes('latest=true')) return Promise.resolve(response({ items: [message], hasMore: false }));
    if (url.includes('/api/chat/messages?')) return Promise.resolve(response({ items: [], hasMore: false }));
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ChatProvider><Probe /></ChatProvider>);
  await tick(0);
  await tick(0);
  expect(screen.getByTestId('loaded')).toHaveTextContent(room.id);
  expect(screen.getByTestId('contents')).toHaveTextContent(message.content);
  await tick(30_000);
  expect(screen.getByTestId('rooms')).toBeEmptyDOMElement();
  expect(screen.getByTestId('loaded')).toHaveTextContent('none');
  expect(screen.getByTestId('contents')).toBeEmptyDOMElement();
});

test('admin background refresh never reopens an unjoined private room after 403', async () => {
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'admin', role: 'ADMIN' } }, status: 'authenticated' } as never);
  const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  let messageReads = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'admin', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') return Promise.resolve(response([room]));
    if (url.includes('/api/chat/messages?')) { messageReads++; return Promise.resolve(response(null, 403)); }
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ChatProvider><Probe /></ChatProvider>);
  await tick(0);
  expect(screen.getByTestId('loaded')).toHaveTextContent('none');
  expect(messageReads).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: `Open ${room.id}` }));
  await tick(0);
  expect(messageReads).toBe(1);
  expect(screen.getByTestId('loaded')).toHaveTextContent('none');
  await tick(90_000);
  expect(listCalls()).toHaveLength(4);
  expect(messageReads).toBe(1);
  expect(screen.getByTestId('loaded')).toHaveTextContent('none');
  expect(errorLog).toHaveBeenCalled();
});

test('a delayed false read acknowledgement cannot erase a newer GET unread dot', async () => {
  const pendingRead = deferred<ReturnType<typeof response>>();
  let listReads = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'reader', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') {
      listReads++;
      return Promise.resolve(response([listReads === 1 ? { ...room, hasUnread: false } : room]));
    }
    if (url.includes('/api/chat/messages?') && url.includes('latest=true')) return Promise.resolve(response({ items: [message], hasMore: false }));
    if (url.includes('/api/chat/messages?')) return Promise.resolve(response({ items: [], hasMore: false }));
    if (url === `/api/chat/channels/${room.id}/read`) return pendingRead.promise;
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ChatProvider><Probe /></ChatProvider>);
  await tick(0);
  await tick(0);
  expect(screen.getByTestId('loaded')).toHaveTextContent(room.id);
  fireEvent.click(screen.getByRole('button', { name: 'Mark read' }));
  await tick(30_000);
  expect(screen.getByTestId('rooms')).toHaveTextContent(`${room.id}:true`);
  await act(async () => { pendingRead.resolve(response({ hasUnread: false })); });
  expect(screen.getByTestId('rooms')).toHaveTextContent(`${room.id}:true`);
});

test('an in-flight multi-page catch-up keeps the visible tail pending until drained', async () => {
  const secondPage = deferred<ReturnType<typeof response>>();
  let liveReads = 0;
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'reader', userSettings: { pushNotifications: false } }));
    if (url === '/api/chat/channels') return Promise.resolve(response([room]));
    if (url.includes('/api/chat/messages?') && url.includes('latest=true')) return Promise.resolve(response({ items: [message], hasMore: false }));
    if (url.includes('/api/chat/messages?')) {
      liveReads++;
      return liveReads === 1 ? Promise.resolve(response({
        items: [{ ...message, id: 'm2', createdAt: '2026-10-15T12:00:01.000Z' }],
        hasMore: true, nextCursor: { after: '2026-10-15T12:00:01.000Z', afterId: 'm2' },
      })) : secondPage.promise;
    }
    throw new Error(`Unexpected request ${url}`);
  });
  render(<ChatProvider><Probe /></ChatProvider>);
  await tick(0);
  await tick(0);
  expect(screen.getByTestId('pending')).toHaveTextContent('false');
  await tick(10_000);
  expect(liveReads).toBe(2);
  expect(screen.getByTestId('pending')).toHaveTextContent('true');
  await act(async () => { secondPage.resolve(response({ items: [], hasMore: false })); });
  expect(screen.getByTestId('pending')).toHaveTextContent('false');
});
