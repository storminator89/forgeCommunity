import { render, screen, waitFor, act } from '@testing-library/react';
import { NotificationProvider, useNotifications } from '@/contexts/NotificationContext';
import { useSession } from 'next-auth/react';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
const mockSession = jest.mocked(useSession);

function Consumer() {
  const { notifications, unreadCount } = useNotifications();
  return <><div data-testid="notifications">{notifications.map(item => item.content).join(',')}</div><div data-testid="unread-count">{unreadCount}</div></>;
}

function setUser(id: string | null) {
  mockSession.mockReturnValue({
    data: id ? { user: { id }, expires: '2099-01-01' } : null,
    status: id ? 'authenticated' : 'unauthenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
}

beforeEach(() => { jest.clearAllMocks(); });

it('clears private notifications immediately when the session changes', async () => {
  setUser('alice');
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [{ id: '1', content: 'Alice private', isRead: false }] } as Response);
  const view = render(<NotificationProvider><Consumer /></NotificationProvider>);
  await waitFor(() => expect(screen.getByTestId('notifications')).toHaveTextContent('Alice private'));
  setUser(null);
  view.rerender(<NotificationProvider><Consumer /></NotificationProvider>);
  expect(screen.getByTestId('notifications')).toBeEmptyDOMElement();
});

it('ignores a previous user response that completes after an account switch', async () => {
  setUser('alice');
  let finishAlice!: (response: Response) => void;
  jest.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishAlice = resolve; }));
  jest.mocked(fetch).mockResolvedValue({ ok: true, json: async () => [{ id: '2', content: 'Bob private', isRead: false }] } as Response);
  const view = render(<NotificationProvider><Consumer /></NotificationProvider>);
  setUser('bob');
  view.rerender(<NotificationProvider><Consumer /></NotificationProvider>);
  await waitFor(() => expect(screen.getByTestId('notifications')).toHaveTextContent('Bob private'));
  await act(async () => { finishAlice({ ok: true, json: async () => [{ id: '1', content: 'Alice private' }] } as Response); });
  expect(screen.getByTestId('notifications')).toHaveTextContent('Bob private');
  expect(screen.getByTestId('notifications')).not.toHaveTextContent('Alice private');
});

it('loads later notification pages so older unread items stay visible', async () => {
  setUser('alice');
  jest.mocked(fetch)
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      items: [{ id: 'new', content: 'Recent', isRead: true, createdAt: '2026-01-02' }], nextCursor: 'new', unreadCount: 1,
    }) } as Response)
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      items: [{ id: 'old', content: 'Older unread', isRead: false, createdAt: '2026-01-01' }], nextCursor: null, unreadCount: 1,
    }) } as Response);
  render(<NotificationProvider><Consumer /></NotificationProvider>);
  await waitFor(() => expect(screen.getByTestId('notifications')).toHaveTextContent('Recent,Older unread'));
  expect(fetch).toHaveBeenNthCalledWith(2, '/api/notifications?cursor=new', expect.any(Object));
});

it('shows the first page and complete unread count while a later page is pending', async () => {
  setUser('alice');
  let finishPage!: (response: Response) => void;
  jest.mocked(fetch)
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      items: [{ id: 'new', content: 'Recent', isRead: true, createdAt: '2026-01-02' }],
      nextCursor: 'new', unreadCount: 57,
    }) } as Response)
    .mockImplementationOnce(() => new Promise(resolve => { finishPage = resolve; }));
  render(<NotificationProvider><Consumer /></NotificationProvider>);
  await waitFor(() => expect(screen.getByTestId('notifications')).toHaveTextContent('Recent'));
  expect(screen.getByTestId('unread-count')).toHaveTextContent('57');
  await act(async () => { finishPage({ ok: true, json: async () => ({ items: [], nextCursor: null, unreadCount: 57 }) } as Response); });
});
