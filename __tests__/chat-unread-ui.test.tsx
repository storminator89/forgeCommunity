import { fireEvent, render, screen } from '@testing-library/react';
import ChatPage from '@/app/chat/page';
import { useChat } from '@/contexts/ChatContext';
import { useSession } from 'next-auth/react';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('@/contexts/ChatContext', () => ({ useChat: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

const channel = { id: 'room', name: 'Allgemein', isPrivate: false, hasUnread: true, _count: { members: 1 } };
const message = { id: 'latest', channelId: 'room', content: 'hello',
  author: { id: 'other', name: 'Other', image: null },
  createdAt: new Date('2026-10-15T12:00:00.000Z'), messageType: 'text' as const };
let chat: ReturnType<typeof useChat>;
let focused: jest.SpyInstance;

function setGeometry() {
  const log = screen.getByRole('log', { name: 'Nachrichten' });
  Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 });
  log.scrollTop = 700;
  jest.spyOn(log, 'getBoundingClientRect').mockReturnValue({
    top: 100, bottom: 400, left: 0, right: 500, width: 500, height: 300,
    x: 0, y: 100, toJSON: () => ({}),
  });
  const last = document.getElementById('chat-message-latest');
  if (last) jest.spyOn(last, 'getBoundingClientRect').mockReturnValue({
    top: 340, bottom: 380, left: 0, right: 500, width: 500, height: 40,
    x: 0, y: 340, toJSON: () => ({}),
  });
  return { log, last };
}

beforeEach(() => {
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'reader', role: 'USER' } } } as ReturnType<typeof useSession>);
  focused = jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  chat = {
    channels: [channel], currentChannel: channel, messages: [message],
    hasOlderMessages: false, loadingOlderMessages: false,
    loadedChannelId: 'room', hasNewerMessages: false,
    loadOlderMessages: jest.fn(async () => {}), markRead: jest.fn(async () => {}),
    setCurrentChannel: jest.fn(), sendMessage: jest.fn(), editMessage: jest.fn(),
    createChannel: jest.fn(), deleteChannel: jest.fn(), loading: false,
    error: null, sendError: null, clearError: jest.fn(),
  };
  jest.mocked(useChat).mockImplementation(() => chat);
});
afterEach(() => focused.mockRestore());

test('small unread indicator is named for assistive tech; latest must be at the visible tail', () => {
  render(<ChatPage />);
  const roomButton = screen.getByRole('button', { name: 'Allgemein, ungelesene Nachrichten' });
  expect(roomButton.className).toContain('focus-visible:ring-2');
  expect([...roomButton.querySelectorAll('span')].some(dot =>
    dot.getAttribute('aria-hidden') === 'true' && dot.classList.contains('rounded-full'))).toBe(true);
  const { log, last } = setGeometry();
  expect(last).not.toBeNull();
  jest.spyOn(last!, 'getBoundingClientRect').mockReturnValue({
    top: 410, bottom: 450, left: 0, right: 500, width: 500, height: 40,
    x: 0, y: 410, toJSON: () => ({}),
  });
  fireEvent.scroll(log);
  expect(chat.markRead).not.toHaveBeenCalled();
  setGeometry();
  fireEvent.scroll(log);
  expect(chat.markRead).toHaveBeenCalledWith('room', 'latest');
});

test('blurred, hidden, behind-on-sync, and older-scroll states never advance', () => {
  const view = render(<ChatPage />);
  const { log } = setGeometry();
  focused.mockReturnValue(false);
  fireEvent.scroll(log);
  expect(chat.markRead).not.toHaveBeenCalled();
  focused.mockReturnValue(true);
  log.scrollTop = 100;
  fireEvent.scroll(log);
  expect(chat.markRead).not.toHaveBeenCalled();
  log.scrollTop = 700;
  chat = { ...chat, hasNewerMessages: true };
  view.rerender(<ChatPage />);
  fireEvent.scroll(log);
  expect(chat.markRead).not.toHaveBeenCalled();
  chat = { ...chat, hasNewerMessages: false };
  view.rerender(<ChatPage />);
  fireEvent.scroll(log);
  expect(chat.markRead).toHaveBeenCalledWith('room', 'latest');
});

test('empty channel is initialized only after it has loaded and is visible', () => {
  chat = { ...chat, messages: [], loadedChannelId: null };
  const view = render(<ChatPage />);
  const { log } = setGeometry();
  fireEvent.scroll(log);
  expect(chat.markRead).not.toHaveBeenCalled();
  chat = { ...chat, loadedChannelId: 'room' };
  view.rerender(<ChatPage />);
  fireEvent.scroll(log);
  expect(chat.markRead).toHaveBeenCalledWith('room', null);
});
