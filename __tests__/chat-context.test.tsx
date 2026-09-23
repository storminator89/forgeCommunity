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
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ignores a late response from a channel that is no longer selected', async () => {
    const channelA = deferred<ReturnType<typeof response>>();
    const channelB = deferred<ReturnType<typeof response>>();

    mockFetch.mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
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

    mockUseSession.mockReturnValue({ data: null });
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
});
