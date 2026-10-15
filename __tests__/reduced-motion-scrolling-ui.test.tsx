import { fireEvent, render, screen } from '@testing-library/react';
import Community from '@/app/community/page';
import Members from '@/app/members/page';
import ChatPage from '@/app/chat/page';
import { useChat } from '@/contexts/ChatContext';
import type { CommunityPost } from '@/lib/community-feed';

jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'member', name: 'Ada' } }, status: 'authenticated' }) }));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
jest.mock('framer-motion', () => jest.requireActual('@/lib/motion'));
jest.mock('@/contexts/ChatContext', () => ({ useChat: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/community/StatsCard', () => ({ StatsCard: () => null }));
jest.mock('@/components/community/LeaderboardCard', () => ({ LeaderboardCard: () => null }));
jest.mock('@/components/community/ContributionMilestonesCard', () => ({ ContributionMilestonesCard: () => null }));
jest.mock('@/hooks/usePrivateContributions', () => ({ usePrivateContributions: () => ({ refresh: jest.fn() }) }));
jest.mock('@/components/community/PostForm', () => ({ PostForm: ({ onCancel }: { onCancel: () => void }) => <button onClick={onCancel}>Abbrechen</button> }));
jest.mock('@/components/community/PostCard', () => ({ PostCard: ({ post, onEdit }: { post: CommunityPost; onEdit: (post: CommunityPost) => void }) => <button onClick={() => onEdit(post)}>Beitrag bearbeiten</button> }));

const post: CommunityPost = {
  id: 'post', title: 'Fixture', content: 'Content', authorId: 'member', author: null,
  createdAt: '2026-01-01T00:00:00Z', votes: 0, isLiked: false, comments: [],
};
const channel = { id: 'general', name: 'Allgemein', isPrivate: false, members: [], _count: { members: 1, messages: 0 } };
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
let reducedMotion = false;
let scrollTo: jest.Mock;
let scrollIntoView: jest.Mock;

beforeEach(() => {
  window.history.replaceState({}, '', '/community');
  reducedMotion = false;
  scrollTo = jest.fn();
  scrollIntoView = jest.fn();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: jest.fn((query: string) => ({ matches: reducedMotion, media: query })) });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  global.fetch = jest.fn().mockImplementation(async (input: string) => ({ ok: true, json: async () =>
    input.startsWith('/api/posts?') ? { posts: [post], nextCursor: null }
      : input === '/api/posts/me/stats' ? { posts: 1, comments: 0, receivedLikes: 0 } : [],
  }));
  jest.mocked(useChat).mockReturnValue({ channels: [channel], currentChannel: channel, messages: [], loading: false } as unknown as ReturnType<typeof useChat>);
});

afterEach(() => {
  for (const [target, name, descriptor] of [
    [window, 'matchMedia', originalMatchMedia],
    [HTMLElement.prototype, 'scrollTo', originalScrollTo],
    [HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView],
  ] as const) {
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
  }
});

it.each(['Neuen Beitrag erstellen', 'Beitrag bearbeiten'])('reads the current preference when opening %s', async name => {
  render(<Community />);
  await screen.findByRole('button', { name: 'Beitrag bearbeiten' });
  for (const preference of [false, true, false]) {
    reducedMotion = preference;
    fireEvent.click(screen.getByRole('button', { name }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: preference ? 'instant' : 'smooth' });
    expect(scrollTo.mock.instances.at(-1)).toBe(screen.getByRole('main'));
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
  }
});

it('reads the current preference for the member directory back-to-top action', async () => {
  render(<Members />);
  await screen.findByRole('heading', { name: 'Noch keine Mitglieder' });
  const main = screen.getByRole('main');
  fireEvent.scroll(main, { target: { scrollTop: 500 } });
  for (const preference of [false, true, false]) {
    reducedMotion = preference;
    fireEvent.click(screen.getByRole('button', { name: 'Nach oben' }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: preference ? 'instant' : 'smooth' });
    expect(scrollTo.mock.instances.at(-1)).toBe(main);
  }
});

it('reads the current preference on each chat message update', () => {
  const view = render(<ChatPage />);
  expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: 'smooth' });
  const sentinel = screen.getByRole('log', { name: 'Nachrichten' }).lastElementChild;
  expect(scrollIntoView.mock.instances.at(-1)).toBe(sentinel);
  for (const preference of [true, false]) {
    reducedMotion = preference;
    const context = jest.mocked(useChat).mock.results.at(-1)!.value;
    jest.mocked(useChat).mockReturnValue({ ...context, messages: [...context.messages] });
    view.rerender(<ChatPage />);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: preference ? 'instant' : 'smooth' });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(sentinel);
  }
});
