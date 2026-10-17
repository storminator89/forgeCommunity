/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import Community from '@/app/community/page';
import { PostCard } from '@/components/community/PostCard';
import { CommunityBookmarksProvider } from '@/components/community/bookmarks/CommunityBookmarksProvider';
import type { CommunityPost, CommunityComment } from '@/lib/community-feed';
import { isNavigationActive, navigationItems } from '@/lib/navigation';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('framer-motion', () => jest.requireActual('@/lib/motion'));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/community/ReportControl', () => ({ ReportControl: () => null }));
const reply = (id: string): CommunityComment => ({ id, authorId: 'peer', author: { name: 'Peer', image: null }, content: `Antwort ${id}`, createdAt: '2026-10-17T12:00:00Z', votes: 0, isLiked: false });
const post = (id: string, comments: CommunityComment[] = []): CommunityPost => ({ id, authorId: 'peer', author: { id: 'peer', name: 'Peer', image: null }, title: `Frage ${id}`, content: '<p>Gemeinsam lernen.</p>', published: true, createdAt: '2026-10-17T12:00:00Z', votes: 0, isLiked: false, comments, commentCount: comments.length, commentsNextCursor: null, tags: [] });
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function serve(rows: CommunityPost[], linked?: CommunityPost) {
  global.fetch = jest.fn().mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/posts?feed=1') return response({ posts: rows, nextCursor: null });
    if (String(url) === '/api/posts/linked-comment/older-answer' && linked) return response(linked);
    if (String(url) === '/api/community/bookmarks/state') return response({ states: JSON.parse(String(init?.body)).targets.map((target: object) => ({ ...target, saved: false, revision: 0 })) });
    if (String(url) === '/api/community/bookmarks/comment/older-answer') return response({ state: { kind: 'comment', targetId: 'older-answer', saved: true, revision: 1 } });
    if (String(url) === '/api/contributions/me') return response({ eligible: true, selectedByAuthors: 0, saturated: false });
    if (String(url) === '/api/leaderboard') return response([]);
    if (String(url) === '/api/rewards/me') return response({ points: 0, completedCourses: 0, firstCourseCompleted: false });
    if (String(url) === '/api/posts/me/stats') return response({ posts: 0, receivedLikes: 0, comments: 0 });
    throw new Error(`Unexpected synthetic fetch ${String(url)}`);
  });
}
beforeEach(() => {
  window.history.replaceState({}, '', '/community');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() });
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'owner', name: 'Owner', role: 'USER' }, expires: '' }, status: 'authenticated', update: jest.fn() } as never);
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: () => '11111111-1111-4111-8111-111111111111' });
});
afterEach(() => jest.restoreAllMocks());

test('actual fifty-post feed batches all 200 post/comment references without per-card status calls', async () => {
  serve(Array.from({ length: 50 }, (_, index) => post(`post-${index}`, Array.from({ length: 3 }, (_, n) => reply(`comment-${index}-${n}`)))));
  render(<Community />);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Beitrag merken' })).toHaveLength(50));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Beitrag merken' }).every(button => !(button as HTMLButtonElement).disabled)).toBe(true));
  const requests = jest.mocked(fetch).mock.calls.filter(([url]) => url === '/api/community/bookmarks/state');
  expect(requests).toHaveLength(1); expect(JSON.parse(String(requests[0][1]?.body)).targets).toHaveLength(200);
});
test('existing linked older-comment feed resolver joins the same status batch and real comment control', async () => {
  window.history.replaceState({}, '', '/community#comment-older-answer'); const old = reply('older-answer');
  serve([post('new-post')], post('older-post', [old])); render(<Community />);
  const answer = await screen.findByText(old.content); const card = answer.closest('[id="comment-older-answer"]')!;
  const save = within(card as HTMLElement).getByRole('button', { name: 'Kommentar merken' }); await waitFor(() => expect(save).toBeEnabled()); fireEvent.click(save);
  await waitFor(() => expect(within(card as HTMLElement).getByRole('button', { name: 'Kommentar aus Merkliste entfernen' })).toHaveAttribute('aria-pressed', 'true'));
  expect(jest.mocked(fetch).mock.calls.some(([url]) => url === '/api/posts/linked-comment/older-answer')).toBe(true);
  const references = jest.mocked(fetch).mock.calls.filter(([url]) => url === '/api/community/bookmarks/state').flatMap(([, init]) => JSON.parse(String(init?.body)).targets);
  expect(references).toEqual(expect.arrayContaining([{ kind: 'post', targetId: 'older-post' }, { kind: 'comment', targetId: 'older-answer' }]));
});
test('draft post/comment controls cannot bookmark and generate no target status request', async () => {
  serve([]); const draft = { ...post('draft', [reply('draft-reply')]), published: false, authorId: 'owner' };
  render(<CommunityBookmarksProvider accountId="owner" targets={[]}><PostCard post={draft} currentUserId="owner" onLike={async () => {}} /></CommunityBookmarksProvider>);
  fireEvent.click(screen.getByRole('button', { name: '1 Kommentar anzeigen' })); await screen.findByText('Antwort draft-reply');
  expect(screen.queryByRole('button', { name: 'Beitrag merken' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Kommentar merken' })).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
test('one labelled Saved navigation destination is active independently of the community feed', () => {
  expect(navigationItems.filter(item => item.href === '/community/saved')).toHaveLength(1);
  expect(navigationItems.find(item => item.href === '/community/saved')?.name).toBe('Merkliste');
  expect(isNavigationActive('/community/saved', '/community/saved')).toBe(true); expect(isNavigationActive('/community/saved', '/community')).toBe(false);
});
