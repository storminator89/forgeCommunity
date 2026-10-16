import { render, screen, within } from '@testing-library/react';
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
