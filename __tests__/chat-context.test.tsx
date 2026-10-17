import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from '@/lib/sites-auth/react';
import { ChatProvider, useChat } from '@/contexts/ChatContext';

jest.mock('next-auth/react', () => ({
  useSession: jest.fn(),
}));

jest.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({
    addNotification: jest.fn().mockResolvedValue(undefined),
  }),
}));

const mockUseSession = useSession as jest.Mock;
const mockFetch = global.fetch as jest.Mock;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(promiseResolve => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function response(data: unknown) {
  return {
    ok: true,
    json: async () => data,
  };
}

const channels = [
  {
    id: 'channel-a',
    name: 'A',
    isPrivate: false,
    _count: { messages: 0, members: 0 },
    members: [],
  },
  {
    id: 'channel-b',
    name: 'B',
    isPrivate: false,
    _count: { messages: 0, members: 0 },
    members: [],
  },
];

function ChatProbe() {
  const { channels: availableChannels, currentChannel, messages, hasOlderMessages, loadingOlderMessages, loadOlderMessages, loading, setCurrentChannel } = useChat();

  return (
    <div>
      <div data-testid="current-channel">{currentChannel?.id ?? 'none'}</div>
      <div data-testid="messages">{messages.map(message => message.content).join('|')}</div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="older-state">{`${hasOlderMessages}:${loadingOlderMessages}`}</div>
      <button type="button" disabled={!hasOlderMessages || loadingOlderMessages} onClick={() => void loadOlderMessages()}>Load older</button>
      {availableChannels.map(channel => (
        <button key={channel.id} onClick={() => setCurrentChannel(channel)}>
          {channel.id}
        </button>
      ))}
    </div>
  );
}

function SendProbe({ onResult }: { onResult: (sent: boolean) => void }) {
  const { currentChannel, messages, error, sendMessage } = useChat();
  return <div>
    <span>{currentChannel?.id ?? 'none'}</span>
    <span data-testid="sent-messages">{messages.map(message => message.content).join('|')}</span>
    {error && <p role="alert">{error}</p>}
    <button type="button" onClick={() => { void sendMessage('Unsaved draft').then(onResult); }}>Send message</button>
  </div>;
}

function ConcurrentSendProbe() {
  const { currentChannel, messages, loading, sendMessage } = useChat();
  return <div>
    <span>{currentChannel?.id ?? 'none'}</span>
    <span data-testid="send-loading">{String(loading)}</span>
    <span data-testid="sent-messages">{messages.map(item => item.content).join('|')}</span>
    <button type="button" onClick={() => void sendMessage('one')}>Send one</button>
    <button type="button" onClick={() => void sendMessage('two')}>Send two</button>
  </div>;
}

function message(id: string, channelId: string, content: string) {
  return {
    id,
    channelId,
    content,
    author: { id: 'user-2', name: 'Other user', image: null },
    createdAt: '2026-09-22T10:00:00.000Z',
    messageType: 'text',
  };
}

describe('ChatProvider request lifecycle', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-1', name: 'Current user' } },
      status: 'authenticated',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('preserves the loaded history when the current channel is selected again', async () => {
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return Promise.resolve(response(channels));
      if (url.includes('channelId=channel-a')) {
        return Promise.resolve(response({ items: [message('message-a', 'channel-a', 'Existing message')] }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('Existing message'));
    const requestCount = mockFetch.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'channel-a' }));

    expect(screen.getByTestId('current-channel')).toHaveTextContent('channel-a');
    expect(screen.getByTestId('messages')).toHaveTextContent('Existing message');
    expect(mockFetch).toHaveBeenCalledTimes(requestCount);
  });

  it('loads older pages without dropping or duplicating messages at tied timestamps', async () => {
    const all = Array.from({ length: 130 }, (_, index) => message(`m${String(index).padStart(3, '0')}`, 'channel-a', `message-${index}`));
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return Promise.resolve(response(channels));
      if (url.includes('channelId=channel-a') && url.includes('latest=true')) {
        return Promise.resolve(response({ items: all.slice(80), hasMore: true }));
      }
      if (url.includes('channelId=channel-a') && url.includes('beforeId=m080')) {
        return Promise.resolve(response({ items: all.slice(30, 80), hasMore: true }));
      }
      if (url.includes('channelId=channel-a') && url.includes('beforeId=m030')) {
        return Promise.resolve(response({ items: all.slice(0, 30), hasMore: false }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => expect(screen.getByTestId('messages').textContent?.split('|')).toHaveLength(50));
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(screen.getByTestId('messages').textContent?.split('|')).toHaveLength(100));
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(screen.getByTestId('messages').textContent?.split('|')).toHaveLength(130));
    expect(screen.getByTestId('messages').textContent?.split('|')).toEqual(all.map(item => item.content));
    expect(screen.getByTestId('older-state')).toHaveTextContent('false:false');
  });

  it('keeps the older-history cursor available after a failed page and permits retry', async () => {
    let olderReads = 0;
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return Promise.resolve(response(channels));
      if (url.includes('latest=true')) return Promise.resolve(response({ items: [message('m002', 'channel-a', 'newer')], hasMore: true }));
      if (url.includes('beforeId=m002')) {
        olderReads++;
        return Promise.resolve(olderReads === 1
          ? { ok: false, status: 503 }
          : response({ items: [message('m001', 'channel-a', 'older')], hasMore: false }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('newer'));
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(olderReads).toBe(1));
    await waitFor(() => expect(screen.getByTestId('older-state')).toHaveTextContent('true:false'));
    expect(screen.getByTestId('messages')).toHaveTextContent('newer');
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('older|newer'));
    expect(screen.getByTestId('older-state')).toHaveTextContent('false:false');
  });

  it('releases the initial loading state when a listed private room denies message access', async () => {
    const privateChannel = [{ ...channels[0], id: 'private-room', isPrivate: true }];
    let deniedReads = 0;
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return Promise.resolve(response(privateChannel));
      if (url.includes('latest=true')) {
        deniedReads++;
        return Promise.resolve({ ok: false, status: 403 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => {
      expect(deniedReads).toBe(1);
      expect(screen.getByTestId('current-channel')).toHaveTextContent('none');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
      expect(screen.getByTestId('messages')).toBeEmptyDOMElement();
    });
    expect(screen.queryByRole('button', { name: 'private-room' })).not.toBeInTheDocument();
  });

  it('clears admin-only private channel names immediately when the same user is downgraded', async () => {
    const privateChannel = { ...channels[1], id: 'admin-only-room', isPrivate: true };
    const memberList = deferred<ReturnType<typeof response>>();
    let role = 'ADMIN';
    mockUseSession.mockReturnValue({ data: { user: { id: 'user-1', role } }, status: 'authenticated' });
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return role === 'ADMIN'
        ? Promise.resolve(response([channels[0], privateChannel]))
        : memberList.promise;
      if (url.includes('channelId=channel-a') && url.includes('latest=true')) {
        return Promise.resolve(response({ items: [message('public', 'channel-a', 'Public message')] }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const view = render(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'admin-only-room' })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('Public message'));

    role = 'USER';
    mockUseSession.mockReturnValue({ data: { user: { id: 'user-1', role } }, status: 'authenticated' });
    view.rerender(<ChatProvider><ChatProbe /></ChatProvider>);
    // The member list is deliberately pending: no old admin-only label or
    // message may survive the role-boundary render while it is in flight.
    expect(screen.queryByRole('button', { name: 'admin-only-room' })).not.toBeInTheDocument();
    expect(screen.getByTestId('messages')).toBeEmptyDOMElement();
    await act(async () => { memberList.resolve(response([channels[0]])); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'channel-a' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'admin-only-room' })).not.toBeInTheDocument();
  });

  it('hides retained history when access to a private channel is revoked', async () => {
    const privateChannel = [{ ...channels[0], id: 'private-room', isPrivate: true }];
    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return Promise.resolve(response(privateChannel));
      if (url.includes('latest=true')) return Promise.resolve(response({ items: [message('m001', 'private-room', 'Private content')], hasMore: true }));
      if (url.includes('beforeId=m001')) return Promise.resolve({ ok: false, status: 403 });
      throw new Error(`Unexpected request: ${url}`);
    });
    render(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('Private content'));
    fireEvent.click(screen.getByRole('button', { name: 'Load older' }));
    await waitFor(() => {
      expect(screen.getByTestId('current-channel')).toHaveTextContent('none');
      expect(screen.getByTestId('messages')).toBeEmptyDOMElement();
      expect(screen.getByTestId('older-state')).toHaveTextContent('false:false');
    });
    expect(screen.queryByRole('button', { name: 'private-room' })).not.toBeInTheDocument();
  });

  it('drains a burst of more than 50 messages in one polling turn', async () => {
    let poll: (() => Promise<void>) | undefined;
    const nativeInterval = global.setInterval;
    const interval = jest.spyOn(global, 'setInterval').mockImplementation((callback, delay) => {
      if (delay === 10000) {
        poll = callback as () => Promise<void>;
        return 2147483647 as unknown as ReturnType<typeof setInterval>;
      }
      return Reflect.apply(nativeInterval, global, [callback, delay]) as ReturnType<typeof setInterval>;
    });
    try {
      const all = Array.from({ length: 121 }, (_, index) => message(`m${String(index).padStart(3, '0')}`, 'channel-a', `message-${index}`));
      mockFetch.mockImplementation((input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
        if (url === '/api/chat/channels') return Promise.resolve(response(channels));
        if (url.includes('channelId=channel-a') && url.includes('latest=true')) {
          return Promise.resolve(response({ items: [all[0]], nextCursor: { after: all[0].createdAt, afterId: all[0].id } }));
        }
        if (url.includes('channelId=channel-a') && url.includes('afterId=')) {
          const afterId = new URL(url, 'http://localhost').searchParams.get('afterId')!;
          const start = all.findIndex(item => item.id === afterId) + 1;
          const items = all.slice(start, start + 50);
          return Promise.resolve(response({ items, hasMore: start + 50 < all.length, nextCursor: items.length
            ? { after: items[items.length - 1].createdAt, afterId: items[items.length - 1].id }
            : null }));
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      render(<ChatProvider><ChatProbe /></ChatProvider>);
      await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('message-0'));
      expect(poll).toBeDefined();
      await act(async () => { await poll?.(); });
      expect(screen.getByTestId('messages').textContent?.split('|')).toEqual(all.map(item => item.content));
      const incrementalReads = mockFetch.mock.calls.filter(([url]) => String(url).includes('afterId='));
      expect(incrementalReads).toHaveLength(3);
    } finally {
      interval.mockRestore();
    }
  });

  it('reports a failed send without treating the draft as delivered', async () => {
    const onResult = jest.fn();
    mockFetch.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return Promise.resolve(response(channels));
      if (url.startsWith('/api/chat/messages?')) return Promise.resolve(response({ items: [] }));
      if (url === '/api/chat/messages' && options?.method === 'POST') return Promise.resolve({ ok: false });
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<ChatProvider><SendProbe onResult={onResult} /></ChatProvider>);
    await screen.findByText('channel-a');
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to send message');
    expect(screen.getByTestId('sent-messages')).toBeEmptyDOMElement();
  });

  it('keeps concurrent optimistic sends distinct and reconciles each once', async () => {
    const first = deferred<ReturnType<typeof response>>();
    const second = deferred<ReturnType<typeof response>>();
    const now = jest.spyOn(Date, 'now').mockReturnValue(123);
    let postCount = 0;
    try {
      mockFetch.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
        const url = String(input);
        if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
        if (url === '/api/chat/channels') return Promise.resolve(response(channels));
        if (url.startsWith('/api/chat/messages?')) return Promise.resolve(response({ items: [] }));
        if (url === '/api/chat/messages' && options?.method === 'POST') return (++postCount === 1 ? first : second).promise;
        throw new Error(`Unexpected request: ${url}`);
      });
      render(<ChatProvider><ConcurrentSendProbe /></ChatProvider>);
      await screen.findByText('channel-a');
      await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('latest=true'), expect.anything()));
      await waitFor(() => expect(screen.getByTestId('send-loading')).toHaveTextContent('false'));
      fireEvent.click(screen.getByRole('button', { name: 'Send one' }));
      fireEvent.click(screen.getByRole('button', { name: 'Send two' }));
      await waitFor(() => expect(screen.getByTestId('sent-messages')).toHaveTextContent('one|two'));
      await act(async () => {
        first.resolve(response({ ...message('server-one', 'channel-a', 'one'), author: { id: 'user-1', name: 'Current user', image: null } }));
        await first.promise;
      });
      expect(screen.getByTestId('sent-messages')).toHaveTextContent('one|two');
      await act(async () => {
        second.resolve(response({ ...message('server-two', 'channel-a', 'two'), author: { id: 'user-1', name: 'Current user', image: null } }));
        await second.promise;
      });
      expect(screen.getByTestId('sent-messages').textContent?.split('|')).toEqual(['one', 'two']);
    } finally {
      now.mockRestore();
    }
  });

  it('reconciles a message already seen by polling before its POST response', async () => {
    let poll: (() => Promise<void>) | undefined;
    const nativeInterval = global.setInterval;
    const interval = jest.spyOn(global, 'setInterval').mockImplementation((callback, delay) => {
      if (delay === 10000) {
        poll = callback as () => Promise<void>;
        return 2147483647 as unknown as ReturnType<typeof setInterval>;
      }
      return Reflect.apply(nativeInterval, global, [callback, delay]) as ReturnType<typeof setInterval>;
    });
    const pendingPost = deferred<ReturnType<typeof response>>();
    const serverMessage = { ...message('server-one', 'channel-a', 'one'), author: { id: 'user-1', name: 'Current user', image: null } };
    try {
      mockFetch.mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
        const url = String(input);
        if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
        if (url === '/api/chat/channels') return Promise.resolve(response(channels));
        if (url.includes('latest=true')) return Promise.resolve(response({ items: [] }));
        if (url.includes('after=')) return Promise.resolve(response({ items: [serverMessage], nextCursor: { after: serverMessage.createdAt, afterId: serverMessage.id } }));
        if (url === '/api/chat/messages' && options?.method === 'POST') return pendingPost.promise;
        throw new Error(`Unexpected request: ${url}`);
      });
      render(<ChatProvider><ConcurrentSendProbe /></ChatProvider>);
      await screen.findByText('channel-a');
      await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('latest=true'), expect.anything()));
      await waitFor(() => expect(screen.getByTestId('send-loading')).toHaveTextContent('false'));
      fireEvent.click(screen.getByRole('button', { name: 'Send one' }));
      expect(poll).toBeDefined();
      await act(async () => { await poll?.(); });
      await act(async () => { pendingPost.resolve(response(serverMessage)); await pendingPost.promise; });
      expect(screen.getByTestId('sent-messages').textContent?.split('|')).toEqual(['one']);
    } finally {
      interval.mockRestore();
    }
  });

  it('ignores a late response from a channel that is no longer selected', async () => {
    const channelA = deferred<ReturnType<typeof response>>();
    const channelB = deferred<ReturnType<typeof response>>();

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return Promise.resolve(response(channels));
      if (url.includes('channelId=channel-a')) return channelA.promise;
      if (url.includes('channelId=channel-b')) return channelB.promise;
      throw new Error(`Unexpected request: ${url}`);
    });

    render(
      <ChatProvider>
        <ChatProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: 'channel-b' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'channel-b' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('channelId=channel-b'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    await act(async () => {
      channelB.resolve(response({ items: [message('message-b', 'channel-b', 'B message')] }));
      await channelB.promise;
    });
    expect(screen.getByTestId('current-channel')).toHaveTextContent('channel-b');
    expect(screen.getByTestId('messages')).toHaveTextContent('B message');

    await act(async () => {
      channelA.resolve(response({ items: [message('message-a', 'channel-a', 'late A message')] }));
      await channelA.promise;
    });

    expect(screen.getByTestId('current-channel')).toHaveTextContent('channel-b');
    expect(screen.getByTestId('messages')).toHaveTextContent('B message');
    expect(screen.getByTestId('messages')).not.toHaveTextContent('late A message');
  });

  it('clears private channel state on logout and ignores its late response', async () => {
    const channelA = deferred<ReturnType<typeof response>>();

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') return Promise.resolve(response(channels));
      if (url.includes('channelId=channel-a')) return channelA.promise;
      if (url.includes('channelId=channel-b')) return Promise.resolve(response([]));
      throw new Error(`Unexpected request: ${url}`);
    });

    const view = render(
      <ChatProvider>
        <ChatProbe />
      </ChatProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('current-channel')).toHaveTextContent('channel-a'));

    mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
    view.rerender(
      <ChatProvider>
        <ChatProbe />
      </ChatProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('current-channel')).toHaveTextContent('none');
      expect(screen.getByTestId('messages')).toHaveTextContent('');
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    await act(async () => {
      channelA.resolve(response({ items: [message('message-a', 'channel-a', 'late private message')] }));
      await channelA.promise;
    });

    expect(screen.getByTestId('current-channel')).toHaveTextContent('none');
    expect(screen.getByTestId('messages')).not.toHaveTextContent('late private message');
    expect(screen.queryByRole('button', { name: 'channel-a' })).not.toBeInTheDocument();
  });

  it('clears Alice\'s private channel and message before Bob\'s channels load', async () => {
    const bobChannels = deferred<ReturnType<typeof response>>();
    const aliceChannel = [{ ...channels[0], id: 'alice-private', name: 'Alice private', isPrivate: true }];
    const bobChannel = [{ ...channels[0], id: 'bob-private', name: 'Bob private', isPrivate: true }];

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') {
        return mockUseSession().data?.user?.id === 'user-1'
          ? Promise.resolve(response(aliceChannel))
          : bobChannels.promise;
      }
      if (url.includes('channelId=alice-private')) {
        return Promise.resolve(response({ items: [message('alice-message', 'alice-private', 'Alice secret')] }));
      }
      if (url.includes('channelId=bob-private')) {
        return Promise.resolve(response({ items: [message('bob-message', 'bob-private', 'Bob message')] }));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const view = render(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('Alice secret'));

    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-2', name: 'Bob' } },
      status: 'authenticated',
    });
    view.rerender(<ChatProvider><ChatProbe /></ChatProvider>);

    expect(screen.getByTestId('current-channel')).toHaveTextContent('none');
    expect(screen.getByTestId('messages')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: 'alice-private' })).not.toBeInTheDocument();

    await act(async () => {
      bobChannels.resolve(response(bobChannel));
      await bobChannels.promise;
    });
    await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('Bob message'));
    expect(screen.queryByText('Alice secret')).not.toBeInTheDocument();
  });

  it('ignores Alice\'s late channel response after Bob signs in', async () => {
    const aliceChannels = deferred<ReturnType<typeof response>>();
    const bobChannel = [{ ...channels[0], id: 'bob-private', name: 'Bob private', isPrivate: true }];

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/user/profile') return Promise.resolve(response({ id: 'user-1', userSettings: { pushNotifications: false } }));
      if (url === '/api/chat/channels') {
        return mockUseSession().data?.user?.id === 'user-1'
          ? aliceChannels.promise
          : Promise.resolve(response(bobChannel));
      }
      if (url.includes('channelId=bob-private')) return Promise.resolve(response({ items: [] }));
      throw new Error(`Unexpected request: ${url}`);
    });

    const view = render(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith(
      '/api/chat/channels',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));

    mockUseSession.mockReturnValue({
      data: { user: { id: 'user-2', name: 'Bob' } },
      status: 'authenticated',
    });
    view.rerender(<ChatProvider><ChatProbe /></ChatProvider>);
    await waitFor(() => expect(screen.getByTestId('current-channel')).toHaveTextContent('bob-private'));

    await act(async () => {
      aliceChannels.resolve(response([{ ...channels[0], id: 'alice-private', name: 'Alice private', isPrivate: true }]));
      await aliceChannels.promise;
    });

    expect(screen.getByTestId('current-channel')).toHaveTextContent('bob-private');
    expect(screen.queryByRole('button', { name: 'alice-private' })).not.toBeInTheDocument();
  });
});
