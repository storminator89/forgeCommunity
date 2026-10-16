import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';
import ChatPage from '@/app/chat/page';
import Events from '@/app/events/page';
import NotificationsPage from '@/app/notifications/page';
import { eventApiFixture, participationFixture } from '@/test-utils/event-participation';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

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
  window.history.replaceState({}, '', '/chat');
  Element.prototype.scrollIntoView = jest.fn();
});

it('allows keyboard channel selection and blocks duplicate sends while the message is pending', async () => {
  const user = userEvent.setup();
  const setCurrentChannel = jest.fn();
  let completeSend!: () => void;
  const sendMessage = jest.fn(() => new Promise<boolean>(resolve => { completeSend = () => resolve(true); }));
  const channel = { id: 'channel', name: 'Allgemein', _count: { members: 2 } };
  mockChat.mockReturnValue({ channels: [channel], currentChannel: channel, messages: [], setCurrentChannel, sendMessage, loading: false });
  render(<ChatPage />);
  const channelToggle = screen.getByRole('button', { name: 'Channels öffnen' });
  await user.click(channelToggle);
  expect(channelToggle).toHaveAttribute('aria-expanded', 'true');
  const channelButton = screen.getByRole('button', { name: 'Allgemein' });
  channelButton.focus();
  await user.keyboard('{Enter}');
  expect(setCurrentChannel).toHaveBeenCalledWith(channel);
  expect(channelToggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('navigation', { name: 'Chat-Channels' })).toBeVisible();
  await user.type(screen.getByRole('textbox', { name: 'Nachricht' }), 'Hallo');
  await user.click(screen.getByRole('button', { name: 'Nachricht senden' }));
  expect(screen.getByRole('button', { name: 'Nachricht senden' })).toBeDisabled();
  await user.keyboard('{Enter}');
  expect(sendMessage).toHaveBeenCalledTimes(1);
  await act(async () => completeSend());
  expect(screen.getByRole('textbox', { name: 'Nachricht' })).toHaveValue('');
});

it('keeps a failed chat message draft editable and leaves the channel accessible', async () => {
  const user = userEvent.setup();
  const channel = { id: 'channel', name: 'Allgemein', _count: { members: 2 } };
  const sendMessage = jest.fn().mockResolvedValue(false);
  mockChat.mockReturnValue({ channels: [channel], currentChannel: channel, messages: [], setCurrentChannel: jest.fn(), sendMessage, loading: false, error: 'Send failed', clearError: jest.fn() });

  render(<ChatPage />);
  expect(screen.getByRole('navigation', { name: 'Chat-Channels' })).toBeInTheDocument();
  const composer = screen.getByRole('textbox', { name: 'Nachricht' });
  await user.type(composer, 'Bitte behalten');
  await user.click(screen.getByRole('button', { name: 'Nachricht senden' }));
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('Bitte behalten', undefined));
  expect(composer).toHaveValue('Bitte behalten');
  expect(screen.getByRole('alert')).toHaveTextContent('Chat konnte nicht geladen oder geändert werden');
});

it('loads and focuses an exact older chat message from a notification link', async () => {
  window.history.replaceState({}, '', '/chat?channelId=room1&messageId=old1');
  const channel = { id: 'room1', name: 'Allgemein', _count: { members: 2 } };
  mockChat.mockReturnValue({ channels: [channel], currentChannel: channel, messages: [], setCurrentChannel: jest.fn(), loading: false });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({
    id: 'old1', channelId: 'room1', content: 'Older linked message', createdAt: '2026-01-01T00:00:00Z',
    messageType: 'text', author: { id: 'other', name: 'Other', image: null },
  }) });
  render(<ChatPage />);
  expect(await screen.findByText('Older linked message')).toBeVisible();
  expect(screen.getByText('Older linked message').closest('article')).toHaveFocus();
  expect(global.fetch).toHaveBeenCalledWith('/api/chat/messages/old1', expect.objectContaining({ cache: 'no-store' }));
});

it('keeps explicit notification filters, hides read entries and marks all unread notifications', async () => {
  const user = userEvent.setup();
  const markAllAsRead = jest.fn();
  mockNotifications.mockReturnValue({
    notifications: [
      { id: '1', type: 'CHAT_MESSAGE', content: 'Neue Nachricht', createdAt: '2026-10-02T10:00:00Z', isRead: false },
      { id: '2', type: 'CHANNEL_CREATED', content: 'Gelesene Nachricht', createdAt: '2026-10-01T10:00:00Z', isRead: true },
    ], unreadCount: 1, isLoading: false, loadError: null, retry: jest.fn(),
    markAsRead: jest.fn(), deleteNotification: jest.fn(), markAllAsRead,
  });
  render(<NotificationsPage />);
  await user.click(screen.getByRole('button', { name: 'Ungelesen 1' }));
  expect(screen.getByText('Neue Nachricht')).toBeVisible();
  await waitFor(() => expect(screen.queryByText('Gelesene Nachricht')).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Ungelesen 1' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Alle als gelesen markieren' }));
  expect(markAllAsRead).toHaveBeenCalledTimes(1);
});

it('opens an actionable notification with a labeled keyboard-accessible control', async () => {
  const user = userEvent.setup();
  const openNotification = jest.fn().mockResolvedValue('/community#comment-reply1');
  mockNotifications.mockReturnValue({
    notifications: [{ id: 'notice', type: 'COMMENT', content: 'Ein Mitglied hat kommentiert.',
      createdAt: '2026-10-02T10:00:00Z', isRead: false, targetState: 'available', actionLabel: 'Kommentar ansehen' }],
    unreadCount: 1, isLoading: false, loadError: null, retry: jest.fn(), openNotification,
    markAsRead: jest.fn(), deleteNotification: jest.fn(), markAllAsRead: jest.fn(),
  });
  render(<NotificationsPage />);
  const action = screen.getByRole('button', { name: 'Kommentar ansehen' });
  action.focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(openNotification).toHaveBeenCalledWith('notice'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/community#comment-reply1'));
});

it('labels a promotion as an event and opens its verified event anchor from the inbox', async () => {
  const user = userEvent.setup();
  const openNotification = jest.fn().mockResolvedValue('/events#event-workshop');
  mockNotifications.mockReturnValue({
    notifications: [{ id: 'promotion', type: 'EVENT', content: 'Ein Platz ist frei geworden.',
      createdAt: '2026-10-16T00:00:00Z', isRead: false, targetState: 'available', actionLabel: 'Event ansehen' }],
    unreadCount: 1, isLoading: false, loadError: null, retry: jest.fn(), openNotification,
    markAsRead: jest.fn(), deleteNotification: jest.fn(), markAllAsRead: jest.fn(),
  });
  render(<NotificationsPage />);
  expect(screen.getByText('Event', { exact: true })).toBeVisible();
  screen.getByRole('button', { name: 'Event ansehen' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(openNotification).toHaveBeenCalledWith('promotion'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/events#event-workshop'));
});

it('disables mark-all when there are no unread notifications', () => {
  mockNotifications.mockReturnValue({ notifications: [], unreadCount: 0, isLoading: false, loadError: null, retry: jest.fn(), markAsRead: jest.fn(), deleteNotification: jest.fn(), markAllAsRead: jest.fn() });
  render(<NotificationsPage />);
  expect(screen.getByRole('button', { name: 'Alle als gelesen markieren' })).toBeDisabled();
});

it('offers retry instead of claiming the inbox is empty after a load error', () => {
  const retry = jest.fn();
  mockNotifications.mockReturnValue({ notifications: [], unreadCount: 0, isLoading: false,
    loadError: 'Benachrichtigungen konnten nicht aktualisiert werden.', retry,
    markAsRead: jest.fn(), deleteNotification: jest.fn(), markAllAsRead: jest.fn() });
  render(<NotificationsPage />);
  expect(screen.getByRole('alert')).toHaveTextContent('Aktualisierung fehlgeschlagen');
  expect(screen.queryByText('Noch keine Benachrichtigungen')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it.each([
  { now: '2026-10-16T21:59:00Z', eventDate: '2026-10-16T00:00:00+02:00' },
  { now: '2026-10-16T22:01:00Z', eventDate: '2026-10-17T00:00:00+02:00' },
  { now: '2026-10-17T00:01:00Z', eventDate: '2026-10-17T00:00:00+02:00' },
])('includes events at the start of today and exposes calendar days as keyboard accessible buttons at $now', async ({ now, eventDate }) => {
  jest.useFakeTimers({ now: new Date(now) });
  try {
    // Upcoming uses the event's local day, including when Berlin is already tomorrow for the viewer.
    const event = { id: 'today', title: 'Heute dabei', date: eventDate, description: 'Details', location: 'Community', timezone: 'Europe/Berlin', maxAttendees: null, attendeeCount: 0, isAttending: false, canCancelRsvp: false };
    global.fetch = eventApiFixture([event]);
    render(<Events />);
    const dayButton = await screen.findByRole('button', { name: /1 Event$/ });
    const eventDay = eventDate.slice(0, 10);
    expect(dayButton.querySelector('time')).toHaveAttribute('dateTime', eventDay);
    // The calendar's current-day marker belongs to the viewer's local day.
    const viewerToday = format(new Date(), 'yyyy-MM-dd');
    const todayButton = screen.getByRole('button', { current: 'date' });
    expect(todayButton).toHaveAttribute('aria-current', 'date');
    expect(todayButton.querySelector('time')).toHaveAttribute('dateTime', viewerToday);
    if (eventDay === viewerToday) {
      expect(dayButton).toHaveAttribute('aria-current', 'date');
    } else {
      expect(dayButton).not.toHaveAttribute('aria-current');
    }
    const monthScroller = screen.getByRole('group', { name: 'Monatskalender horizontal verschieben' });
    expect(monthScroller).toHaveClass('overflow-x-auto');
    expect(monthScroller.firstElementChild).toHaveClass('min-w-[314px]');
    fireEvent.click(screen.getByRole('button', { name: 'Liste' }));
    expect(screen.getByRole('region', { name: 'Listenansicht' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveTextContent('Heute dabei');
    expect(screen.getByRole('heading', { name: 'Heute dabei' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Woche' }));
    expect(screen.getByRole('region', { name: 'Wochenkalender' })).toBeVisible();
    expect(screen.getAllByRole('button', { name: /\d+ Events?$/ })).toHaveLength(7);
  } finally {
    jest.useRealTimers();
  }
});

it('lets a signed-in member RSVP and cancel from the event list', async () => {
  const user = userEvent.setup();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const event = { id: 'workshop', title: 'Workshop', date: tomorrow.toISOString(), description: 'Details', location: 'Community', timezone: 'Europe/Berlin', maxAttendees: 1, attendeeCount: 0, isAttending: false, canCancelRsvp: false };
  global.fetch = eventApiFixture([event], async (_id, init) => init?.method === 'POST'
    ? { ...participationFixture(event), registrationState: 'REGISTERED', isAttending: true, canCancelRsvp: true, attendeeCount: 1 }
    : participationFixture(event));
  render(<Events />);
  await user.click(await screen.findByRole('button', { name: 'Liste' }));
  await user.click(await screen.findByRole('button', { name: 'Teilnehmen' }));
  expect(global.fetch).toHaveBeenCalledWith('/api/events/workshop/rsvp', expect.objectContaining({ method: 'POST' }));
  await user.click(await screen.findByRole('button', { name: 'Zusage zurücknehmen' }));
  expect(global.fetch).toHaveBeenCalledWith('/api/events/workshop/rsvp', expect.objectContaining({ method: 'DELETE' }));
});
