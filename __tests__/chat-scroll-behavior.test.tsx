import { fireEvent, render, screen } from '@testing-library/react';
import ChatPage from '@/app/chat/page';
import { useChat } from '@/contexts/ChatContext';
import { useSession } from '@/lib/sites-auth/react';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('@/contexts/ChatContext', () => ({ useChat: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

const channel = { id: 'room', name: 'Allgemein', isPrivate: false, members: [], _count: { members: 1, messages: 0 } };
const message = (id: string) => ({
  id, channelId: channel.id, content: id,
  author: { id: 'other', name: 'Other', image: null },
  createdAt: new Date('2026-10-15T12:00:00.000Z'), messageType: 'text' as const,
});
let chat: ReturnType<typeof useChat>;

beforeEach(() => {
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'member', role: 'USER' } } } as ReturnType<typeof useSession>);
  chat = {
    channels: [channel], currentChannel: channel, messages: [message('m1')],
    hasOlderMessages: false, loadingOlderMessages: false,
    loadedChannelId: null, hasNewerMessages: false,
    loadOlderMessages: jest.fn(async () => {}),
    markRead: jest.fn(async () => {}),
    setCurrentChannel: jest.fn(), sendMessage: jest.fn(), editMessage: jest.fn(),
    createChannel: jest.fn(), deleteChannel: jest.fn(), loading: false,
    error: null, clearError: jest.fn(),
  };
  jest.mocked(useChat).mockImplementation(() => chat);
});

it('keeps the reading position for new messages until the reader returns to the bottom', () => {
  const view = render(<ChatPage />);
  const log = screen.getByRole('log', { name: 'Nachrichten' });
  Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 1000 });
  Object.defineProperty(log, 'clientHeight', { configurable: true, value: 300 });
  log.scrollTop = 200;
  fireEvent.scroll(log);
  chat = { ...chat, messages: [message('m1'), message('m2')] };
  view.rerender(<ChatPage />);
  expect(log.scrollTop).toBe(200);

  log.scrollTop = 700;
  fireEvent.scroll(log);
  chat = { ...chat, messages: [message('m1'), message('m2'), message('m3')] };
  view.rerender(<ChatPage />);
  expect(log.scrollTop).toBe(1000);
});

it('anchors the viewport when an older page is prepended', () => {
  chat = { ...chat, messages: [message('m2')], hasOlderMessages: true };
  const view = render(<ChatPage />);
  const log = screen.getByRole('log', { name: 'Nachrichten' });
  let height = 1000;
  Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => height });
  log.scrollTop = 300;
  fireEvent.click(screen.getByRole('button', { name: 'Ältere Nachrichten laden' }));
  expect(chat.loadOlderMessages).toHaveBeenCalledTimes(1);
  height = 1300;
  chat = { ...chat, messages: [message('m1'), message('m2')], hasOlderMessages: false };
  view.rerender(<ChatPage />);
  expect(log.scrollTop).toBe(600);
});
