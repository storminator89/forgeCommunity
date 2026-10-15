import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from 'next-auth/react';
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
  const { channels: availableChannels, currentChannel, messages, loading, setCurrentChannel } = useChat();

  return (
    <div>
      <div data-testid="current-channel">{currentChannel?.id ?? 'none'}</div>
      <div data-testid="messages">{messages.map(message => message.content).join('|')}</div>
      <div data-testid="loading">{String(loading)}</div>
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
