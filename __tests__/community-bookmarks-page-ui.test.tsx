/** @jest-environment jsdom */
import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import SavedCommunityPage from '@/app/community/saved/page';
import type { SavedCommunityItem } from '@/lib/community-bookmarks';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('next/image', () => ({ __esModule: true, default: () => null }));
const item: SavedCommunityItem = { id: 'saved-one', kind: 'post', targetId: 'post-one', saved: true, revision: 1,
  savedAt: '2026-10-17T12:00:00.000Z', title: 'Weiterlesen', excerpt: 'Ein gemeinsamer Gedanke.', author: { name: 'Ada', image: null }, href: '/api/community/bookmarks/post/post-one' };
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
function setupDelayedPage() {
  let resolve!: (value: unknown) => void;
  const pending = new Promise(done => { resolve = done; });
  let lists = 0;
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('/api/community/bookmarks?')) {
      lists++;
      return lists === 1 ? Promise.resolve(response({ items: [item], nextCursor: 'next-page' })) : pending;
    }
    const { targets } = JSON.parse(String(init?.body));
    return Promise.resolve(response({ states: targets.map((target: { kind: string; targetId: string }) => ({ ...target, saved: true, revision: 1 })) }));
  }) as jest.MockedFunction<typeof fetch>;
  return { resolveFinal: () => resolve(response({ items: [], nextCursor: null })), pending };
}
beforeEach(() => { jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'owner' }, expires: '' }, status: 'authenticated', update: jest.fn() } as never); });
afterEach(() => jest.restoreAllMocks());
async function beginLoad() {
  const button = await screen.findByRole('button', { name: 'Weitere laden' });
  button.focus(); fireEvent.click(button); await waitFor(() => expect(button).toBeDisabled());
  // Native browsers blur a disabled button. jsdom does not do so itself.
  document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex');
  expect(document.activeElement).toBe(document.body);
  return button;
}

test('delayed final page retains originating focus intent and moves to end status after control hides', async () => {
  const delayed = setupDelayedPage(); render(<SavedCommunityPage />); await beginLoad();
  await act(async () => { delayed.resolveFinal(); await delayed.pending; });
  const status = screen.getByText('Ende der Merkliste'); expect(status).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Weitere laden' })).not.toBeInTheDocument();
});
test('delayed final page preserves a newer focused link instead of stealing focus', async () => {
  const delayed = setupDelayedPage(); render(<SavedCommunityPage />); await beginLoad();
  const link = screen.getByRole('link', { name: 'Weiterlesen' }); fireEvent.keyDown(document, { key: 'Tab' }); link.focus();
  await act(async () => { delayed.resolveFinal(); await delayed.pending; });
  expect(link).toHaveFocus(); expect(screen.getByText('Ende der Merkliste')).not.toHaveFocus();
});
test('later pointer navigation remains cancelled even if focus returns to body', async () => {
  const delayed = setupDelayedPage(); render(<SavedCommunityPage />); await beginLoad();
  const link = screen.getByRole('link', { name: 'Weiterlesen' }); fireEvent.pointerDown(link); link.focus(); link.blur();
  await act(async () => { delayed.resolveFinal(); await delayed.pending; });
  expect(document.activeElement).toBe(document.body); expect(screen.getByText('Ende der Merkliste')).not.toHaveFocus();
});
test('account replacement aborts the old final-page focus intent and content', async () => {
  const delayed = setupDelayedPage(); const view = render(<SavedCommunityPage />); await beginLoad();
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'other' }, expires: '' }, status: 'authenticated', update: jest.fn() } as never);
  view.rerender(<SavedCommunityPage />); const back = screen.getByRole('link', { name: 'Zur Community' }); back.focus();
  await act(async () => { delayed.resolveFinal(); await delayed.pending; });
  expect(back).toHaveFocus(); expect(within(screen.getByRole('main')).queryByRole('link', { name: 'Weiterlesen' })).not.toBeInTheDocument();
});
