import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import SpacesPage from '@/app/community/spaces/page';
import SpacePage from '@/app/community/spaces/[spaceId]/page';
import DiscussionPage from '@/app/community/spaces/[spaceId]/discussions/[discussionId]/page';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useParams: jest.fn(), useRouter: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/community/ReportControl', () => ({ ReportControl: ({ targetType }: { targetType: string }) => <span>{targetType} melden</span> }));

const now = '2026-10-15T12:00:00.000Z';
const author = { id: 'member', name: 'Mara', image: null };
const privateSpace = { id: 'secret', name: 'Privater Austausch', description: 'Internes Thema', visibility: 'PRIVATE',
  createdAt: now, updatedAt: now, memberCount: 1, discussionCount: 1, isMember: true, canManage: false, canWrite: true };
const publicSpace = { ...privateSpace, id: 'open', name: 'Offenes Thema', visibility: 'PUBLIC', isMember: false, canWrite: false };
const discussion = { id: 'topic', spaceId: 'secret', title: 'Vertrauliche Frage', content: 'Vertraulicher Inhalt',
  createdAt: now, updatedAt: now, author, replyCount: 0, hiddenAt: null };
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const session = (id: string, role = 'USER') => ({ data: { user: { id, role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useParams).mockReturnValue({ spaceId: 'secret', discussionId: 'topic' });
  jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useSession).mockReturnValue(session('member'));
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => 'request-id-1') });
});

test('directory only renders server-visible Spaces and does not offer admin creation to a member', async () => {
  global.fetch = jest.fn().mockResolvedValue(json({ items: [publicSpace], nextCursor: null }));
  render(<SpacesPage />);
  expect(await screen.findByRole('link', { name: /Offenes Thema/ })).toHaveAttribute('href', '/community/spaces/open');
  expect(screen.getByText('Offen für Mitglieder')).toBeVisible();
  expect(screen.queryByText('Privater Austausch')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Space erstellen' })).not.toBeInTheDocument();
});

test('filtered directory offers the next real page before claiming there are no matches', async () => {
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces') return Promise.resolve(json({ items: [publicSpace], nextCursor: 'next' }));
    if (path === '/api/spaces?cursor=next') return Promise.resolve(json({ items: [privateSpace], nextCursor: null }));
    throw new Error(`Unexpected ${path}`);
  });
  const user = userEvent.setup();
  render(<SpacesPage />);
  await screen.findByRole('link', { name: /Offenes Thema/ });
  await user.click(screen.getByRole('button', { name: /^Privat$/ }));
  expect(screen.getByRole('heading', { name: 'Noch kein passender Space geladen' })).toBeVisible();
  expect(screen.getByText('Auf weiteren Seiten können passende Spaces liegen.')).toBeVisible();
  expect(screen.queryByText('Keine Spaces gefunden')).not.toBeInTheDocument();
  expect(screen.getByText('0 Spaces bisher geladen')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Weitere Spaces laden' }));
  expect(await screen.findByRole('link', { name: /Privater Austausch/ })).toHaveAttribute('href', '/community/spaces/secret');
  expect(screen.queryByRole('heading', { name: 'Keine Spaces gefunden' })).not.toBeInTheDocument();
  expect(screen.getByText('1 Space gefunden')).toBeVisible();
});

test('private membership loss clears rendered discussion content even if an older read resolves later', async () => {
  let resolveOldList!: (value: ReturnType<typeof json>) => void;
  let listReads = 0;
  let spaceReads = 0;
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') {
      spaceReads++;
      return Promise.resolve(spaceReads === 1 ? json(privateSpace) : json({ error: 'Not found' }, 404));
    }
    if (path === '/api/spaces/secret/discussions') {
      listReads++;
      if (listReads === 1) return Promise.resolve(json({ items: [discussion], nextCursor: null }));
      return new Promise(resolve => { resolveOldList = resolve; });
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<SpacePage />);
  expect(await screen.findByText('Vertraulicher Inhalt')).toBeVisible();
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(await screen.findByRole('heading', { level: 1, name: 'Space nicht verfügbar' })).toBeVisible();
  expect(screen.queryByText('Vertraulicher Inhalt')).not.toBeInTheDocument();
  await act(async () => { resolveOldList(json({ items: [discussion], nextCursor: null })); });
  expect(screen.queryByText('Vertraulicher Inhalt')).not.toBeInTheDocument();
});

test('a late pagination 200 cannot restore a hidden discussion after a filtered revalidation 200', async () => {
  let finishOldPage!: (value: ReturnType<typeof json>) => void;
  let firstPageReads = 0;
  const hidden = { ...discussion, id: 'hidden-topic', title: 'Hidden topic', content: 'Hidden discussion body', hiddenAt: now };
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json({ ...privateSpace, visibility: 'PUBLIC', canManage: false }));
    if (path === '/api/spaces/secret/discussions') {
      firstPageReads++;
      return Promise.resolve(json({ items: [discussion], nextCursor: firstPageReads === 1 ? 'next' : null }));
    }
    if (path === '/api/spaces/secret/discussions?cursor=next') {
      return new Promise(resolve => { finishOldPage = resolve; });
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<SpacePage />);
  expect(await screen.findByText('Vertraulicher Inhalt')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Weitere Diskussionen laden' }));
  const oldRead = (global.fetch as jest.Mock).mock.calls.find(([path]) => path === '/api/spaces/secret/discussions?cursor=next');
  expect(oldRead).toBeDefined();
  await act(async () => { fireEvent.focus(window); });
  expect((oldRead![1].signal as AbortSignal).aborted).toBe(true);
  await waitFor(() => expect(firstPageReads).toBe(2));
  await waitFor(() => expect(screen.getByText('1 Diskussionen geladen')).toBeVisible());
  expect(screen.queryByRole('button', { name: 'Weitere Diskussionen laden' })).not.toBeInTheDocument();
  await act(async () => { finishOldPage(json({ items: [hidden], nextCursor: null })); });
  expect(screen.queryByText('Hidden discussion body')).not.toBeInTheDocument();
  expect(screen.queryByText('Hidden topic')).not.toBeInTheDocument();
});

test('a late pagination 200 cannot restore a hidden reply after a filtered revalidation 200', async () => {
  let finishOldPage!: (value: ReturnType<typeof json>) => void;
  let firstPageReads = 0;
  const reply = { id: 'reply-1', discussionId: 'topic', content: 'Visible reply body', createdAt: now, updatedAt: now, author, hiddenAt: null };
  const hidden = { ...reply, id: 'hidden-reply', content: 'Hidden reply body', hiddenAt: now };
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json({ ...privateSpace, visibility: 'PUBLIC', canManage: false }));
    if (path === '/api/spaces/secret/discussions/topic') return Promise.resolve(json(discussion));
    if (path === '/api/spaces/secret/discussions/topic/replies') {
      firstPageReads++;
      return Promise.resolve(json({ items: [reply], nextCursor: firstPageReads === 1 ? 'next' : null }));
    }
    if (path === '/api/spaces/secret/discussions/topic/replies?cursor=next') {
      return new Promise(resolve => { finishOldPage = resolve; });
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<DiscussionPage />);
  expect(await screen.findByText('Visible reply body')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Weitere Antworten laden' }));
  const oldRead = (global.fetch as jest.Mock).mock.calls.find(([path]) => path === '/api/spaces/secret/discussions/topic/replies?cursor=next');
  expect(oldRead).toBeDefined();
  await act(async () => { fireEvent.focus(window); });
  expect((oldRead![1].signal as AbortSignal).aborted).toBe(true);
  await waitFor(() => expect(firstPageReads).toBe(2));
  await waitFor(() => expect(screen.getByText('1 Antworten geladen')).toBeVisible());
  expect(screen.queryByRole('button', { name: 'Weitere Antworten laden' })).not.toBeInTheDocument();
  await act(async () => { finishOldPage(json({ items: [hidden], nextCursor: null })); });
  expect(screen.queryByText('Hidden reply body')).not.toBeInTheDocument();
});

test('a moderation result during focus revalidation does not strand the Space loading state', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  let finishPatch!: (value: ReturnType<typeof json>) => void;
  let finishFocusSpace!: (value: ReturnType<typeof json>) => void;
  let spaceReads = 0;
  let listReads = 0;
  let hiddenAt: string | null = null;
  const adminSpace = { ...privateSpace, visibility: 'PUBLIC', canManage: true };
  const demotedSpace = { ...adminSpace, canManage: false };
  const hiddenDiscussion = { ...discussion, id: 'old-hidden', title: 'Old hidden topic', content: 'Old hidden body', hiddenAt: now };
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') {
      spaceReads++;
      if (spaceReads === 1) return Promise.resolve(json(adminSpace));
      if (spaceReads === 2) return new Promise(resolve => { finishFocusSpace = resolve; });
      return Promise.resolve(json(demotedSpace));
    }
    if (path === '/api/spaces/secret/discussions') {
      listReads++;
      return Promise.resolve(json({ items: listReads === 1 ? [discussion, hiddenDiscussion] : listReads === 2 ? [discussion] : [], nextCursor: null }));
    }
    if (path === '/api/spaces/secret/discussions/topic/moderation' && init?.method === 'PATCH') {
      return new Promise(resolve => { finishPatch = resolve; });
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<SpacePage />);
  await screen.findByRole('button', { name: 'Ausblenden' });
  expect(screen.getByText('Old hidden body')).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Ausblenden' }));
  await act(async () => { fireEvent.focus(window); });
  expect(await screen.findByRole('heading', { name: 'Space wird geladen' })).toBeVisible();
  expect(screen.queryByText('Old hidden body')).not.toBeInTheDocument();
  await act(async () => { hiddenAt = now; finishPatch(json({ ...discussion, hiddenAt })); });
  expect(screen.getByRole('heading', { name: 'Space wird geladen' })).toBeVisible();
  await act(async () => { finishFocusSpace(json(demotedSpace)); });
  expect(await screen.findByText('Noch keine Diskussionen')).toBeVisible();
  expect(listReads).toBe(3);
  expect(screen.queryByText('Old hidden body')).not.toBeInTheDocument();
  expect(screen.queryByText('Vertraulicher Inhalt')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Space wird geladen' })).not.toBeInTheDocument();
});

test('a reply result during focus revalidation does not strand the discussion loading state', async () => {
  let finishPost!: (value: ReturnType<typeof json>) => void;
  let finishFocusSpace!: (value: ReturnType<typeof json>) => void;
  let spaceReads = 0;
  let posted = false;
  const reply = { id: 'reply-1', discussionId: 'topic', content: 'Concurrent reply', createdAt: now, updatedAt: now, author, hiddenAt: null };
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') {
      spaceReads++;
      if (spaceReads === 1) return Promise.resolve(json(privateSpace));
      if (spaceReads === 2) return new Promise(resolve => { finishFocusSpace = resolve; });
      return Promise.resolve(json(privateSpace));
    }
    if (path === '/api/spaces/secret/discussions/topic') return Promise.resolve(json(discussion));
    if (path === '/api/spaces/secret/discussions/topic/replies' && init?.method === 'POST') {
      return new Promise(resolve => { finishPost = resolve; });
    }
    if (path === '/api/spaces/secret/discussions/topic/replies') return Promise.resolve(json({ items: posted ? [reply] : [], nextCursor: null }));
    throw new Error(`Unexpected ${path}`);
  });
  render(<DiscussionPage />);
  await screen.findByRole('heading', { name: 'Vertrauliche Frage' });
  await userEvent.type(screen.getByRole('textbox', { name: 'Deine Antwort' }), 'Concurrent reply');
  await userEvent.click(screen.getByRole('button', { name: 'Antwort veröffentlichen' }));
  await act(async () => { fireEvent.focus(window); });
  expect(await screen.findByRole('heading', { name: 'Diskussion wird geladen' })).toBeVisible();
  await act(async () => { posted = true; finishPost(json(reply, 201)); });
  expect(screen.getByRole('heading', { name: 'Diskussion wird geladen' })).toBeVisible();
  await act(async () => { finishFocusSpace(json(privateSpace)); });
  expect(await screen.findByRole('heading', { name: 'Vertrauliche Frage' })).toBeVisible();
  expect(screen.getByText('Concurrent reply')).toBeVisible();
  expect(spaceReads).toBe(3);
  expect(screen.queryByRole('heading', { name: 'Diskussion wird geladen' })).not.toBeInTheDocument();
});

test('a late moderation success after public admin demotion cannot expose the hidden discussion', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  const adminSpace = { ...privateSpace, visibility: 'PUBLIC', canManage: true };
  let spaceReads = 0;
  let listReads = 0;
  let finishPatch!: (value: ReturnType<typeof json>) => void;
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') {
      spaceReads++;
      return Promise.resolve(json({ ...adminSpace, canManage: spaceReads === 1 }));
    }
    if (path === '/api/spaces/secret/discussions') {
      listReads++;
      return Promise.resolve(json({ items: listReads < 3 ? [discussion] : [], nextCursor: null }));
    }
    if (path === '/api/spaces/secret/discussions/topic/moderation' && init?.method === 'PATCH') {
      return new Promise(resolve => { finishPatch = resolve; });
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<SpacePage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Ausblenden' }));
  await act(async () => { fireEvent.focus(window); });
  await waitFor(() => expect(spaceReads).toBe(2));
  expect(await screen.findByText('Vertraulicher Inhalt')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Ausblenden' })).not.toBeInTheDocument();
  await act(async () => { finishPatch(json({ ...discussion, hiddenAt: now })); });
  expect(await screen.findByText('Noch keine Diskussionen')).toBeVisible();
  expect(listReads).toBe(3);
  expect(screen.queryByText('Vertraulicher Inhalt')).not.toBeInTheDocument();
});

test('a late reply moderation success after public admin demotion cannot expose the hidden reply', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  const adminSpace = { ...privateSpace, visibility: 'PUBLIC', canManage: true };
  const reply = { id: 'reply-1', discussionId: 'topic', content: 'Reply hidden after demotion', createdAt: now, updatedAt: now, author, hiddenAt: null };
  let spaceReads = 0;
  let listReads = 0;
  let finishPatch!: (value: ReturnType<typeof json>) => void;
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') {
      spaceReads++;
      return Promise.resolve(json({ ...adminSpace, canManage: spaceReads === 1 }));
    }
    if (path === '/api/spaces/secret/discussions/topic') return Promise.resolve(json(discussion));
    if (path === '/api/spaces/secret/discussions/topic/replies') {
      listReads++;
      return Promise.resolve(json({ items: listReads < 3 ? [reply] : [], nextCursor: null }));
    }
    if (path === '/api/spaces/secret/discussions/topic/replies/reply-1/moderation' && init?.method === 'PATCH') {
      return new Promise(resolve => { finishPatch = resolve; });
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<DiscussionPage />);
  await screen.findByText('Reply hidden after demotion');
  await userEvent.click(screen.getAllByRole('button', { name: 'Ausblenden' })[1]);
  await act(async () => { fireEvent.focus(window); });
  await waitFor(() => expect(spaceReads).toBe(2));
  expect(await screen.findByText('Reply hidden after demotion')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Ausblenden' })).not.toBeInTheDocument();
  await act(async () => { finishPatch(json({ ...reply, hiddenAt: now })); });
  expect(await screen.findByText('Noch keine Antworten.')).toBeVisible();
  expect(listReads).toBe(3);
  expect(screen.queryByText('Reply hidden after demotion')).not.toBeInTheDocument();
});

test('a same-account ADMIN to USER session role refresh remounts and drops admin-only private content', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  let reads = 0;
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') { reads++; return Promise.resolve(reads === 1 ? json({ ...privateSpace, isMember: false, canManage: true }) : json({ error: 'Not found' }, 404)); }
    if (path === '/api/spaces/secret/discussions') return Promise.resolve(json({ items: [discussion], nextCursor: null }));
    if (path === '/api/spaces/secret/members') return Promise.resolve(json({ items: [], nextCursor: null }));
    throw new Error(`Unexpected ${path}`);
  });
  const view = render(<SpacePage />);
  expect(await screen.findByText('Vertraulicher Inhalt')).toBeVisible();
  jest.mocked(useSession).mockReturnValue(session('admin', 'USER'));
  view.rerender(<SpacePage />);
  expect(screen.queryByText('Vertraulicher Inhalt')).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 1, name: 'Space nicht verfügbar' })).toBeVisible();
});

test('discussion reply keeps a stable request ID on retry after a network failure', async () => {
  const user = userEvent.setup();
  let posts = 0;
  const bodies: Array<{ content: string; requestId: string }> = [];
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json(privateSpace));
    if (path === '/api/spaces/secret/discussions/topic') return Promise.resolve(json(discussion));
    if (path === '/api/spaces/secret/discussions/topic/replies' && init?.method === 'POST') {
      posts++;
      bodies.push(JSON.parse(String(init.body)) as { content: string; requestId: string });
      return posts === 1 ? Promise.reject(new Error('Offline')) : Promise.resolve(json({ id: 'reply', discussionId: 'topic', content: 'Meine Antwort', createdAt: now, updatedAt: now, author, hiddenAt: null }, 201));
    }
    if (path === '/api/spaces/secret/discussions/topic/replies') return Promise.resolve(json({ items: [], nextCursor: null }));
    throw new Error(`Unexpected ${path}`);
  });
  render(<DiscussionPage />);
  await screen.findByRole('heading', { level: 1, name: 'Vertrauliche Frage' });
  await user.type(screen.getByRole('textbox', { name: 'Deine Antwort' }), 'Meine Antwort');
  await user.click(screen.getByRole('button', { name: 'Antwort veröffentlichen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.getByRole('textbox', { name: 'Deine Antwort' })).toHaveValue('Meine Antwort');
  await user.click(screen.getByRole('button', { name: 'Antwort veröffentlichen' }));
  await waitFor(() => expect(screen.getByText('Antwort veröffentlicht.')).toBeVisible());
  expect(bodies).toEqual([{ content: 'Meine Antwort', requestId: 'request-id-1' }, { content: 'Meine Antwort', requestId: 'request-id-1' }]);
  expect(screen.getByText('Meine Antwort')).toBeVisible();
});

test('private admin-only discussion clears on DB demotion at focus even while session still says ADMIN', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  let reads = 0;
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') { reads++; return Promise.resolve(reads === 1 ? json({ ...privateSpace, isMember: false, canManage: true }) : json({ error: 'Not found' }, 404)); }
    if (path === '/api/spaces/secret/discussions/topic') return Promise.resolve(json(discussion));
    if (path === '/api/spaces/secret/discussions/topic/replies') return Promise.resolve(json({ items: [], nextCursor: null }));
    throw new Error(`Unexpected ${path}`);
  });
  render(<DiscussionPage />);
  expect(await screen.findByText('Vertraulicher Inhalt')).toBeVisible();
  await act(async () => { fireEvent.focus(window); });
  expect(await screen.findByRole('heading', { level: 1, name: 'Diskussion nicht verfügbar' })).toBeVisible();
  expect(screen.queryByText('Vertraulicher Inhalt')).not.toBeInTheDocument();
});

test('same-account session refresh keeps loaded discussion pagination', async () => {
  const second = { ...discussion, id: 'topic-2', title: 'Zweites Thema' };
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json(privateSpace));
    if (path === '/api/spaces/secret/discussions') return Promise.resolve(json({ items: [discussion], nextCursor: 'next' }));
    if (path === '/api/spaces/secret/discussions?cursor=next') return Promise.resolve(json({ items: [second], nextCursor: null }));
    throw new Error(`Unexpected ${path}`);
  });
  const view = render(<SpacePage />);
  await screen.findByText('Vertraulicher Inhalt');
  await userEvent.click(screen.getByRole('button', { name: 'Weitere Diskussionen laden' }));
  expect(await screen.findByRole('heading', { name: 'Zweites Thema' })).toBeVisible();
  jest.mocked(useSession).mockReturnValue(session('member'));
  view.rerender(<SpacePage />);
  expect(screen.getByRole('heading', { name: 'Zweites Thema' })).toBeVisible();
  expect((global.fetch as jest.Mock).mock.calls.filter(([path]) => path === '/api/spaces/secret/discussions')).toHaveLength(1);
});

test('admin adds a private member from bounded candidates without fetching contact data', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  const candidate = { id: 'person-1', name: 'Anna Beispiel', image: null };
  let added = false;
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json({ ...privateSpace, canManage: true }));
    if (path === '/api/spaces/secret/discussions') return Promise.resolve(json({ items: [], nextCursor: null }));
    if (path === '/api/spaces/secret/members' && !init?.method) return Promise.resolve(json({ items: added ? [author, candidate] : [author], nextCursor: null }));
    if (path === '/api/spaces/secret/member-candidates?q=An') return Promise.resolve(json({ items: [candidate] }));
    if (path === '/api/spaces/secret/members' && init?.method === 'POST') { added = true; return Promise.resolve(json({ userId: candidate.id }, 201)); }
    throw new Error(`Unexpected ${path}`);
  });
  const user = userEvent.setup();
  render(<SpacePage />);
  const search = await screen.findByRole('combobox', { name: 'Person hinzufügen' });
  await user.type(search, 'An');
  await user.click(await screen.findByRole('option', { name: /Anna Beispiel/ }));
  await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Anna Beispiel entfernen' })).toBeVisible());
  const post = (global.fetch as jest.Mock).mock.calls.find(([path, init]) => path === '/api/spaces/secret/members' && init?.method === 'POST');
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({ userId: 'person-1' });
  expect((global.fetch as jest.Mock).mock.calls.some(([path]) => String(path).includes('/api/admin/users'))).toBe(false);
});

test('an old member-change summary cannot restore admin controls after DB role demotion', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  const managerSpace = { ...privateSpace, canManage: true };
  const candidate = { id: 'person-1', name: 'Anna Beispiel', image: null };
  let spaceReads = 0;
  let finishOldSummary!: (value: ReturnType<typeof json>) => void;
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') {
      spaceReads++;
      if (spaceReads === 1) return Promise.resolve(json(managerSpace));
      if (spaceReads === 2) return new Promise(resolve => { finishOldSummary = resolve; });
      return Promise.resolve(json({ ...managerSpace, canManage: false }));
    }
    if (path === '/api/spaces/secret/discussions') return Promise.resolve(json({ items: [], nextCursor: null }));
    if (path === '/api/spaces/secret/members' && init?.method === 'POST') return Promise.resolve(json({ userId: candidate.id }, 201));
    if (path === '/api/spaces/secret/members') return Promise.resolve(json({ items: [author], nextCursor: null }));
    if (path === '/api/spaces/secret/member-candidates?q=An') return Promise.resolve(json({ items: [candidate] }));
    throw new Error(`Unexpected ${path}`);
  });
  const user = userEvent.setup();
  render(<SpacePage />);
  await user.type(await screen.findByRole('combobox', { name: 'Person hinzufügen' }), 'An');
  await user.click(await screen.findByRole('option', { name: /Anna Beispiel/ }));
  await user.click(screen.getByRole('button', { name: 'Hinzufügen' }));
  await waitFor(() => expect(spaceReads).toBe(2));
  const oldSummary = (global.fetch as jest.Mock).mock.calls.filter(([path]) => path === '/api/spaces/secret')[1];
  await act(async () => { fireEvent.focus(window); });
  expect((oldSummary[1].signal as AbortSignal).aborted).toBe(true);
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Mitglieder verwalten' })).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { level: 1, name: 'Privater Austausch' })).toBeVisible();
  await act(async () => { finishOldSummary(json(managerSpace)); });
  expect(screen.queryByRole('heading', { name: 'Mitglieder verwalten' })).not.toBeInTheDocument();
});

test('admin can reversibly hide a discussion with the scoped moderation endpoint', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  let hiddenAt: string | null = null;
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json({ ...privateSpace, canManage: true }));
    if (path === '/api/spaces/secret/discussions') return Promise.resolve(json({ items: [discussion], nextCursor: null }));
    if (path === '/api/spaces/secret/members') return Promise.resolve(json({ items: [], nextCursor: null }));
    if (path === '/api/spaces/secret/discussions/topic/moderation' && init?.method === 'PATCH') {
      hiddenAt = JSON.parse(String(init.body)).hidden ? now : null;
      return Promise.resolve(json({ ...discussion, hiddenAt }));
    }
    throw new Error(`Unexpected ${path}`);
  });
  const user = userEvent.setup();
  render(<SpacePage />);
  await user.click(await screen.findByRole('button', { name: 'Ausblenden' }));
  expect(await screen.findByText('Ausgeblendet')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Wieder einblenden' }));
  await waitFor(() => expect(screen.queryByText('Ausgeblendet')).not.toBeInTheDocument());
  expect(hiddenAt).toBeNull();
});

test('a hidden discussion remains reviewable by admin without advertising a reply form', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json({ ...privateSpace, canManage: true }));
    if (path === '/api/spaces/secret/discussions/topic') return Promise.resolve(json({ ...discussion, hiddenAt: now }));
    if (path === '/api/spaces/secret/discussions/topic/replies') return Promise.resolve(json({ items: [], nextCursor: null }));
    throw new Error(`Unexpected ${path}`);
  });
  render(<DiscussionPage />);
  expect(await screen.findByText('Diese Diskussion ist ausgeblendet. Antworten sind derzeit nicht möglich.')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Deine Antwort' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Wieder einblenden' })).toBeVisible();
});
