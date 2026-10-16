import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import SpacePage from '@/app/community/spaces/[spaceId]/page';
import type { SpaceSummary } from '@/components/spaces/space-api';
import type { SpacePoll } from '@/components/spaces/poll-api';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useParams: jest.fn(), useRouter: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

const now = '2026-10-16T00:00:00.000Z';
const author = { id: 'member', name: 'Mara', image: null };
const space: SpaceSummary = { id: 'secret', name: 'Gemeinsam lernen', description: 'Eine offene Werkstatt.',
  visibility: 'PUBLIC', createdAt: now, updatedAt: now, memberCount: 2, discussionCount: 1, isMember: true, canManage: false };
const discussion = { id: 'topic', spaceId: space.id, title: 'Unser nächster Versuch', content: 'Welche Idee probieren wir gemeinsam aus?', author,
  createdAt: now, updatedAt: now, hiddenAt: null, replyCount: 0 };
const poll: SpacePoll = { id: 'poll', spaceId: space.id, question: 'Womit beginnen wir?', createdAt: now,
  closedAt: null, hiddenAt: null, moderationRevision: 0, totalVotes: 1,
  options: [{ id: 'one', label: 'Planen', votes: 1 }, { id: 'two', label: 'Testen', votes: 0 }],
  ownVote: { optionId: 'one', revision: 1 }, canVote: true, canManage: false };

function setup(current = space, polls: SpacePoll[] = []) {
  global.fetch = jest.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const source = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(source, 'http://localhost').pathname;
    const body = path === '/api/spaces/secret' ? current : path.endsWith('/discussions') ? { items: [discussion], nextCursor: null }
      : path.endsWith('/polls') ? { items: polls, nextCursor: null }
        : path.endsWith('/members') ? { items: [author], nextCursor: null } : { items: [], nextCursor: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  render(<SpacePage />);
}

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/community/spaces/secret');
  jest.mocked(useParams).mockReturnValue({ spaceId: 'secret' });
  jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'member', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>);
});

test('member discussions precede compact empty polls, with secondary membership beside the identity', async () => {
  setup();
  const start = await screen.findByRole('button', { name: 'Diskussion starten' });
  const leave = screen.getByRole('button', { name: 'Verlassen' });
  expect(leave.closest('header')).toContainElement(screen.getByRole('heading', { level: 1, name: space.name }));
  expect(screen.getByText('2 Mitglieder · 1 Diskussion')).toBeVisible();
  const polls = screen.getByRole('region', { name: 'Umfragen' });
  expect(start.compareDocumentPosition(polls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(await within(polls).findByText('Noch keine Umfragen.')).toBeVisible();
  expect(within(polls).queryByText(/In kleinen Gruppen/)).not.toBeInTheDocument();
  expect(within(polls).queryByRole('button')).not.toBeInTheDocument();
  expect(within(polls).queryByText(/Gemeinsam entscheiden|Eine Frage/)).not.toBeInTheDocument();
  const tasks = screen.getByRole('navigation', { name: 'Aufgaben im Space' });
  expect(within(tasks).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual(['#space-discussions', '#space-polls']);
  await userEvent.click(within(tasks).getByRole('link', { name: 'Diskussionen' }));
  expect(screen.getByRole('region', { name: 'Diskussionen' })).toHaveFocus();
  await userEvent.tab();
  expect(start).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveFocus();
  await userEvent.type(screen.getByRole('textbox', { name: 'Titel' }), 'Entwurf bleibt erhalten');
  await userEvent.keyboard('{Escape}');
  expect(start).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveValue('Entwurf bleibt erhalten');
  expect(jest.mocked(global.fetch).mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

test('nonmembers keep joining and reading, without unavailable mission or management jump targets', async () => {
  setup({ ...space, isMember: false });
  expect(await screen.findByRole('button', { name: 'Beitreten' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Diskussion starten' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Missionen' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Verwaltung' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: discussion.title })).toBeVisible();
  expect(screen.getByText('Tritt bei, um eine Diskussion zu starten oder zu antworten.')).toBeVisible();
});

test('private administration follows content tasks and all rendered local targets accept focus', async () => {
  setup({ ...space, visibility: 'PRIVATE', canManage: true });
  const manage = await screen.findByRole('region', { name: 'Space verwalten' });
  const missions = screen.getByRole('group', { name: 'Missionen' });
  const polls = screen.getByRole('group', { name: 'Umfragen' });
  expect(missions.compareDocumentPosition(polls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(polls.compareDocumentPosition(manage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(await within(manage).findByRole('button', { name: 'Mara entfernen' })).toBeVisible();
  const tasks = screen.getByRole('navigation', { name: 'Aufgaben im Space' });
  for (const link of within(tasks).getAllByRole('link')) {
    const target = document.querySelector(link.getAttribute('href')!);
    expect(target).not.toBeNull();
    await userEvent.click(link);
    expect(target).toHaveFocus();
  }
  expect(screen.queryByRole('button', { name: 'Verlassen' })).not.toBeInTheDocument();
});

test('empty poll creation discloses risk before fields and restores focus on cancel', async () => {
  setup({ ...space, visibility: 'PRIVATE', canManage: true });
  const open = await screen.findByRole('button', { name: 'Umfrage erstellen' });
  await screen.findByText('Noch keine Umfragen.');
  expect(screen.queryByText(/In kleinen Gruppen/)).not.toBeInTheDocument();
  await userEvent.click(open);
  const question = screen.getByRole('textbox', { name: 'Frage' });
  const risk = screen.getByText(/In kleinen Gruppen können Antworten erkennbar sein/);
  expect(risk).toBeVisible();
  expect(screen.getByText('Freiwillig · Eine Stimme pro Person')).toBeVisible();
  expect(risk.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(question).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(open).toHaveFocus();
  expect(screen.queryByText(/In kleinen Gruppen/)).not.toBeInTheDocument();
});

test('existing poll decisions retain voluntary and inference facts, saved choice and counting disclosure', async () => {
  setup(space, [poll]);
  expect(await screen.findByRole('heading', { name: poll.question })).toBeVisible();
  expect(screen.getByText('Freiwillig · Eine Stimme pro Person')).toBeVisible();
  expect(screen.getByText(/In kleinen Gruppen können Antworten erkennbar sein. Keine sensiblen Fragen./)).toBeVisible();
  expect(screen.getByText('Deine gespeicherte Auswahl')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Auswahl ändern' })).toBeDisabled();
  await userEvent.click(screen.getByText('So wird gezählt'));
  expect(screen.getByText('Angezeigt werden nur Summen und deine eigene Auswahl. Solange die Umfrage offen ist, kannst du deine Auswahl ändern.')).toBeVisible();
});


afterEach(() => { jest.restoreAllMocks(); });

test('local jumps cancel native ancestor scrolling, keep hash history and scroll only main', async () => {
  setup();
  const link = await screen.findByRole('link', { name: 'Umfragen' });
  const target = screen.getByRole('group', { name: 'Umfragen' });
  const main = document.getElementById('page-content')!;
  main.scrollTop = 125;
  target.style.scrollMarginTop = '24px';
  jest.spyOn(main, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 80, 1000, 720));
  jest.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 600, 1000, 400));
  const focus = jest.spyOn(target, 'focus');
  const outerScroll = jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const history = jest.spyOn(window.history, 'pushState');
  const click = createEvent.click(link, { button: 0 });
  fireEvent(link, click);
  expect(click.defaultPrevented).toBe(true);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(main.scrollTop).toBe(621);
  expect(outerScroll).not.toHaveBeenCalled();
  expect(history).toHaveBeenCalledWith(null, '', '#space-polls');
  expect(window.location.hash).toBe('#space-polls');
});

test.each([{ button: 1 }, { button: 0, ctrlKey: true }, { button: 0, metaKey: true }])('local jumps leave modified/middle navigation to the browser: %j', async options => {
  setup();
  const link = await screen.findByRole('link', { name: 'Umfragen' });
  const target = screen.getByRole('group', { name: 'Umfragen' });
  const focus = jest.spyOn(target, 'focus');
  const history = jest.spyOn(window.history, 'pushState');
  const navigated = new Promise<void>(resolve => window.addEventListener('hashchange', () => resolve(), { once: true }));
  const click = createEvent.click(link, options);
  fireEvent(link, click);
  expect(click.defaultPrevented).toBe(false);
  expect(focus).not.toHaveBeenCalled();
  expect(history).not.toHaveBeenCalled();
  // JSDOM follows even modified clicks in this window. Complete its queued
  // hash/popstate navigation and our fragment RAF within the originating test.
  await act(async () => { await navigated; });
  await waitFor(() => expect(target).toHaveFocus());
});

test('an initial local fragment focuses once after loading, without refocusing on access revalidation', async () => {
  window.history.replaceState(null, '', '/community/spaces/secret#space-polls');
  const focus = jest.spyOn(HTMLElement.prototype, 'focus');
  const fragmentFocusCount = () => focus.mock.contexts.filter(element => element instanceof HTMLElement && element.id === 'space-polls').length;
  render(<button type="button">Andere Aufgabe</button>);
  setup();
  await waitFor(() => expect(screen.getByRole('group', { name: 'Umfragen' })).toHaveFocus());
  expect(fragmentFocusCount()).toBe(1);

  // This separate render root survives the page's loading branch. Explicitly
  // move focus before revalidation, then hold its summary read until the
  // loading state is observable, independent of React's batching choices.
  const external = screen.getByRole('button', { name: 'Andere Aufgabe' });
  external.focus();
  expect(external).toHaveFocus();
  const fetch = jest.mocked(global.fetch);
  const initialRead = fetch.getMockImplementation()!;
  let finishRevalidation: ((response: Response) => void) | undefined;
  fetch.mockImplementation((input, init) => {
    const source = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(source, 'http://localhost').pathname === '/api/spaces/secret') {
      return new Promise<Response>(resolve => { finishRevalidation = resolve; });
    }
    return initialRead(input, init);
  });
  fireEvent(window, new Event('focus'));
  await waitFor(() => expect(finishRevalidation).toBeDefined());
  expect(screen.getByRole('heading', { name: 'Space wird geladen' })).toBeVisible();
  expect(external).toHaveFocus();
  await act(async () => {
    finishRevalidation!(new Response(JSON.stringify(space), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  });
  await screen.findByRole('heading', { level: 1, name: space.name });
  expect(screen.queryByRole('heading', { name: 'Space wird geladen' })).not.toBeInTheDocument();
  expect(external).toHaveFocus();
  // A prototype spy includes both the old and any remounted fragment node.
  expect(fragmentFocusCount()).toBe(1);
});
