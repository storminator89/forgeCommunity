import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ChatPage from '@/app/chat/page';
import Events from '@/app/events/page';
import NotificationsPage from '@/app/notifications/page';

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/EventForm', () => ({ __esModule: true, default: () => <div>Eventformular</div> }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/sanitize-html', () => ({ sanitizeRichHtml: (value: string) => value }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'user', role: 'MEMBER' } } }) }));
const mockChat = jest.fn();
const mockNotifications = jest.fn();
jest.mock('@/contexts/ChatContext', () => ({ useChat: () => mockChat() }));
jest.mock('@/contexts/NotificationContext', () => ({ useNotifications: () => mockNotifications() }));

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  Element.prototype.scrollIntoView = jest.fn();
});

it('allows keyboard channel selection and blocks duplicate sends while the message is pending', async () => {
  const user = userEvent.setup();
  const setCurrentChannel = jest.fn();
  let completeSend!: () => void;
  const sendMessage = jest.fn(() => new Promise<void>(resolve => { completeSend = resolve; }));
  const channel = { id: 'channel', name: 'Allgemein', _count: { members: 2 } };
  mockChat.mockReturnValue({ channels: [channel], currentChannel: channel, messages: [], setCurrentChannel, sendMessage, loading: false });
  render(<ChatPage />);
  const channelButton = screen.getByRole('button', { name: 'Allgemein' });
  channelButton.focus();
  await user.keyboard('{Enter}');
  expect(setCurrentChannel).toHaveBeenCalledWith(channel);
  expect(screen.getByRole('navigation', { name: 'Chat-Channels' })).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Nachricht' }), 'Hallo');
  await user.click(screen.getByRole('button', { name: 'Nachricht senden' }));
  expect(screen.getByRole('button', { name: 'Nachricht senden' })).toBeDisabled();
  await user.keyboard('{Enter}');
  expect(sendMessage).toHaveBeenCalledTimes(1);
  await act(async () => completeSend());
  expect(screen.getByRole('textbox', { name: 'Nachricht' })).toHaveValue('');
});

it('keeps explicit notification filters, hides read entries and marks all unread notifications', async () => {
  const user = userEvent.setup();
  const markAllAsRead = jest.fn();
  mockNotifications.mockReturnValue({
    notifications: [
      { id: '1', type: 'CHAT_MESSAGE', content: 'Neue Nachricht', createdAt: '2026-10-02T10:00:00Z', isRead: false },
      { id: '2', type: 'CHANNEL_CREATED', content: 'Gelesene Nachricht', createdAt: '2026-10-01T10:00:00Z', isRead: true },
    ], markAsRead: jest.fn(), deleteNotification: jest.fn(), markAllAsRead,
  });
  render(<NotificationsPage />);
  await user.click(screen.getByRole('button', { name: 'Ungelesen 1' }));
  expect(screen.getByText('Neue Nachricht')).toBeVisible();
  await waitFor(() => expect(screen.queryByText('Gelesene Nachricht')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Ungelesen 1' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Alle als gelesen markieren' }));
  expect(markAllAsRead).toHaveBeenCalledTimes(1);
});

it('disables mark-all when there are no unread notifications', () => {
  mockNotifications.mockReturnValue({ notifications: [], markAsRead: jest.fn(), deleteNotification: jest.fn(), markAllAsRead: jest.fn() });
  render(<NotificationsPage />);
  expect(screen.getByRole('button', { name: 'Alle als gelesen markieren' })).toBeDisabled();
});

it('includes events at the start of today and exposes calendar days as keyboard accessible buttons', async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const event = { id: 'today', title: 'Heute dabei', date: today.toISOString(), description: 'Details', location: 'Community', timezone: 'Europe/Berlin' };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [event] });
  render(<Events />);
  const dayButton = await screen.findByRole('button', { name: /1 Event$/ });
  expect(dayButton).toHaveAttribute('aria-current', 'date');
  fireEvent.click(screen.getByRole('button', { name: 'Liste' }));
  expect(screen.getByRole('heading', { name: 'Heute dabei' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Woche' }));
  expect(screen.getByRole('region', { name: 'Wochenkalender' })).toBeVisible();
  expect(screen.getAllByRole('button', { name: /\d+ Events?$/ })).toHaveLength(7);
});
