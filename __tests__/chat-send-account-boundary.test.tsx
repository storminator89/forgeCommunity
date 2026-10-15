import { StrictMode, useEffect, useLayoutEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import ChatPage from '@/app/chat/page';
import { ChatProvider, useChat } from '@/contexts/ChatContext';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
jest.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({ addNotification: jest.fn() }),
}));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const response = (data: unknown, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => data,
}) as Response;
const channel = { id: 'shared-room', name: 'Allgemein', isPrivate: false, members: [], _count: { members: 2, messages: 0 } };
const imagePath = '/api/chat/uploads/chat-616c696365-01234567-89ab-cdef-0123-456789abcdef.png';
const file = new File(['synthetic test image'], 'test.png', { type: 'image/png' });
let cookieAccount: string | null;
let posts: { account: string | null; body: Record<string, unknown>; signal?: AbortSignal | null }[];
let uploadRequest: RequestInit | undefined;
let upload: ReturnType<typeof deferred<Response>>;
let post: ((body: Record<string, unknown>) => Promise<Response>) | undefined;
let consoleError: jest.SpyInstance;
let capturedSend: ReturnType<typeof useChat>['sendMessage'];

function setSession(id: string | null) {
  jest.mocked(useSession).mockReturnValue({
    data: id ? { user: { id, name: id, role: 'MEMBER' }, expires: '2099-01-01' } : null,
    status: id ? 'authenticated' : 'unauthenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
}

function CaptureSend() {
  const { sendMessage } = useChat();
  useEffect(() => { capturedSend = sendMessage; }, [sendMessage]);
  return null;
}

function CommitProbe({ onCommit }: { onCommit?: () => void }) {
  useLayoutEffect(() => { onCommit?.(); });
  return null;
}

const app = (onCommit?: () => void) => <StrictMode>
  <ChatProvider><ChatPage /><CaptureSend /></ChatProvider>
  <CommitProbe onCommit={onCommit} />
</StrictMode>;

async function startImageSend() {
  const view = render(app());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nachricht' })).toBeEnabled());
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('latest=true'), expect.anything()));
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Nachricht' }), { target: { value: 'Alice private draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Nachricht senden' }));
  await waitFor(() => expect(uploadRequest).toBeDefined());
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  cookieAccount = 'alice';
  setSession('alice');
  posts = [];
  uploadRequest = undefined;
  upload = deferred<Response>();
  post = undefined;
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  Element.prototype.scrollIntoView = jest.fn();
  URL.createObjectURL = jest.fn(() => 'blob:synthetic-test-image');
  URL.revokeObjectURL = jest.fn();
  jest.mocked(global.fetch).mockImplementation(async (input, options) => {
    const url = String(input);
    if (url === '/api/user/profile') return response({ id: cookieAccount, userSettings: { pushNotifications: false } });
    if (url === '/api/chat/channels') return response([channel]);
    if (url.startsWith('/api/chat/messages?')) return response({ items: [] });
    if (url === '/api/chat/upload') {
      uploadRequest = options;
      // Deliberately ignore abort so late network/body completions are tested.
      return upload.promise;
    }
    if (url === '/api/chat/messages' && options?.method === 'POST') {
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      posts.push({ account: cookieAccount, body, signal: options.signal });
      if (post) return post(body);
      // Model the existing server ownership check, not a fictional successful
      // cross-account write. Cookies are independent of useSession's snapshot.
      if (cookieAccount !== 'alice' && body.imageUrl === imagePath) return response({}, 403);
      return response({ ...body, id: 'sent-message', author: { id: cookieAccount, name: cookieAccount, image: null }, createdAt: '2026-10-15T00:00:00Z' });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => consoleError.mockRestore());

it('does not POST Alice\'s uploaded draft using Bob\'s current cookie after an account switch', async () => {
  const view = await startImageSend();
  cookieAccount = 'bob';
  setSession('bob');
  view.rerender(app());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nachricht' })).toBeEnabled());
  expect(screen.getByRole('textbox', { name: 'Nachricht' })).toHaveValue('');
  fireEvent.change(screen.getByRole('textbox', { name: 'Nachricht' }), { target: { value: 'Bob new draft' } });

  await act(async () => { upload.resolve(response({ filePath: imagePath })); });

  expect(posts).toEqual([]);
  expect(uploadRequest?.signal?.aborted).toBe(true);
  expect(screen.getByRole('textbox', { name: 'Nachricht' })).toHaveValue('Bob new draft');
  expect(screen.queryByText('Alice private draft')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(consoleError).not.toHaveBeenCalled();
});

it('also stops after account switch while the upload response body is still pending', async () => {
  const view = await startImageSend();
  const body = deferred<{ filePath: string }>();
  const json = jest.fn(() => body.promise);
  await act(async () => { upload.resolve({ ok: true, json } as unknown as Response); });
  expect(json).toHaveBeenCalledTimes(1);

  cookieAccount = 'bob';
  setSession('bob');
  view.rerender(app());
  await act(async () => { body.resolve({ filePath: imagePath }); });

  expect(posts).toEqual([]);
  expect(uploadRequest?.signal?.aborted).toBe(true);
  expect(consoleError).not.toHaveBeenCalled();
});

it.each(['logout', 'unmount', 'loading', 'return-to-alice'] as const)(
  'does not resume an old upload after %s', async boundary => {
    const view = await startImageSend();
    const oldSend = capturedSend;
    if (boundary === 'unmount') view.unmount();
    else {
      cookieAccount = boundary === 'return-to-alice' ? 'bob' : null;
      setSession(cookieAccount);
      if (boundary === 'loading') {
        jest.mocked(useSession).mockReturnValue({ data: null, status: 'loading', update: jest.fn() });
      }
      view.rerender(app());
      if (boundary === 'return-to-alice') {
        cookieAccount = 'alice';
        setSession('alice');
        view.rerender(app());
      }
    }
    expect(uploadRequest?.signal?.aborted).toBe(true);
    await act(async () => { upload.resolve(response({ filePath: imagePath })); });
    expect(posts).toEqual([]);
    // A retained callback from the unmounted account cannot start a fresh send.
    const requests = jest.mocked(global.fetch).mock.calls.length;
    await expect(oldSend('stale callback', file)).resolves.toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(requests);
    expect(screen.queryByText('Alice private draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  },
);

it.each(['abort', 'network error'] as const)('silences a late upload %s after switching accounts', async failure => {
  const view = await startImageSend();
  cookieAccount = 'bob';
  setSession('bob');
  view.rerender(app());
  await act(async () => {
    upload.reject(failure === 'abort' ? new DOMException('Aborted', 'AbortError') : new Error('Old upload failed'));
  });
  expect(posts).toEqual([]);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(consoleError).not.toHaveBeenCalled();
});

it('preserves ordinary image upload and send through a same-account session refresh', async () => {
  const view = await startImageSend();
  const signal = uploadRequest?.signal;
  expect(signal).toBeInstanceOf(AbortSignal);
  expect((uploadRequest?.body as FormData).get('file')).toBe(file);
  const historyReads = () => jest.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes('latest=true')).length;
  const beforeRefresh = historyReads();
  setSession('alice');
  view.rerender(app());
  await waitFor(() => expect(historyReads()).toBeGreaterThan(beforeRefresh));
  expect(signal?.aborted).toBe(false);
  await act(async () => { upload.resolve(response({ filePath: imagePath })); });

  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nachricht' })).toBeEnabled());
  expect(screen.getByRole('textbox', { name: 'Nachricht' })).toHaveValue('');
  expect(screen.queryByRole('img', { name: 'Vorschau' })).not.toBeInTheDocument();
  expect(posts).toEqual([{
    account: 'alice', signal,
    body: { channelId: channel.id, content: 'Alice private draft', imageUrl: imagePath, messageType: 'image' },
  }]);
  expect(screen.getByText('Alice private draft')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it.each(['http', 'network', 'cancel'] as const)('keeps the draft and image with error feedback on an active upload %s failure', async failure => {
  await startImageSend();
  await act(async () => {
    if (failure === 'http') upload.resolve(response({}, 413));
    else upload.reject(failure === 'cancel' ? new DOMException('Upload cancelled', 'AbortError') : new Error('Network unavailable'));
  });
  expect(posts).toEqual([]);
  expect(screen.getByRole('textbox', { name: 'Nachricht' })).toBeEnabled();
  expect(screen.getByRole('textbox', { name: 'Nachricht' })).toHaveValue('Alice private draft');
  expect(screen.getByRole('img', { name: 'Vorschau' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Chat konnte nicht geladen oder geändert werden');
  expect(consoleError).toHaveBeenCalledTimes(1);
});

it('keeps an upload draft after message failure and removes its optimistic message', async () => {
  post = async () => response({}, 500);
  await startImageSend();
  await act(async () => { upload.resolve(response({ filePath: imagePath })); });
  expect(posts).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Nachricht' })).toHaveValue('Alice private draft');
  expect(screen.getByRole('img', { name: 'Vorschau' })).toBeInTheDocument();
  expect(screen.queryByText('Alice private draft')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
});

it('preserves text sends and skips the upload if the user removes the image before sending', async () => {
  const view = render(app());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nachricht' })).toBeEnabled());
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('latest=true'), expect.anything()));
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.click(screen.getByRole('button', { name: 'Bild entfernen' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Nachricht' }), { target: { value: 'Plain text' } });
  fireEvent.click(screen.getByRole('button', { name: 'Nachricht senden' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nachricht' })).toHaveValue(''));
  expect(uploadRequest).toBeUndefined();
  expect(posts).toEqual([{
    account: 'alice', signal: expect.any(AbortSignal),
    body: { content: 'Plain text', channelId: channel.id, messageType: 'text' },
  }]);
  expect(screen.getByText('Plain text')).toBeInTheDocument();
});

it.each(['headers', 'body'] as const)('aborts a pending message request and ignores its late %s on account switch', async stage => {
  const pending = deferred<Response>();
  const body = deferred<unknown>();
  post = () => stage === 'headers' ? pending.promise : Promise.resolve({ ok: true, json: () => body.promise } as Response);
  const view = render(app());
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nachricht' })).toBeEnabled());
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('latest=true'), expect.anything()));
  let result!: Promise<boolean>;
  act(() => { result = capturedSend('Alice pending message'); });
  await waitFor(() => expect(posts).toHaveLength(1));
  const oldSignal = posts[0].signal;
  cookieAccount = 'bob';
  setSession('bob');
  view.rerender(app());
  expect(oldSignal?.aborted).toBe(true);
  const message = { id: 'late-message', content: 'Alice pending message', channelId: channel.id, author: { id: 'alice', name: 'alice', image: null }, createdAt: '2026-10-15T00:00:00Z' };
  await act(async () => {
    if (stage === 'headers') pending.resolve(response(message));
    else body.resolve(message);
    expect(await result).toBe(false);
  });
  expect(posts).toHaveLength(1);
  expect(screen.queryByText('Alice pending message')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});


it('cancels the old send during the account-switch commit before passive effects run', async () => {
  const view = await startImageSend();
  const signal = uploadRequest?.signal;
  const observed: boolean[] = [];
  cookieAccount = 'bob';
  setSession('bob');
  view.rerender(app(() => { observed.push(signal?.aborted === true); }));
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every(Boolean)).toBe(true);
  await act(async () => { upload.resolve(response({ filePath: imagePath })); });
  expect(posts).toEqual([]);
});
