import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import CourseGoalsClient from '@/app/courses/goals/CourseGoalsClient';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

type Goal = {
  targetLeaves: number; durationDays: number; timezone: string; startedAt: string; endsAt: string;
  pausedAt: string | null; completedLeaves: number; status: 'active' | 'paused' | 'achieved' | 'ended';
};
const reply = (goal: Goal | null) => ({ ok: true, json: async () => ({ goal }) });
const session = (id: string) => ({ data: { user: { id, role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue(session('alice'));
});

test('keyboard user can start, pause, resume, dismiss cancel with Escape, and remove a private goal', async () => {
  const user = userEvent.setup();
  let stored: Goal | null = null;
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    switch (init?.method ?? 'GET') {
      case 'POST': {
        const body = JSON.parse(String(init?.body));
        stored = { ...body, startedAt: '2026-10-15T08:00:00.000Z', endsAt: '2026-10-22T22:00:00.000Z', pausedAt: null, completedLeaves: 0, status: 'active' };
        return reply(stored);
      }
      case 'PATCH': {
        const body = JSON.parse(String(init?.body));
        stored = { ...stored!, pausedAt: body.action === 'pause' ? '2026-10-15T09:00:00.000Z' : null, status: body.action === 'pause' ? 'paused' : 'active' };
        return reply(stored);
      }
      case 'DELETE': stored = null; return reply(null);
      default: return reply(stored);
    }
  }) as jest.Mock;

  render(<CourseGoalsClient />);
  expect(await screen.findByLabelText('Kursinhalte abschließen')).toHaveValue('3');
  await user.selectOptions(screen.getByLabelText('Kursinhalte abschließen'), '1');
  await user.selectOptions(screen.getByLabelText('Zeitraum'), '14');
  await user.click(screen.getByRole('button', { name: 'Privates Lernziel starten' }));
  expect(await screen.findByText('0 von 1 Kursinhalt')).toBeVisible();
  await waitFor(() => expect(screen.getByText('Du bist unterwegs')).toHaveFocus());
  expect(screen.getByRole('progressbar', { name: 'Lernziel: 0 von 1 Kursinhalt abgeschlossen' })).toBeVisible();
  expect(global.fetch).toHaveBeenCalledWith('/api/learning-goals/me', expect.objectContaining({ method: 'POST', body: expect.stringContaining('"targetLeaves":1') }));

  await user.click(screen.getByRole('button', { name: 'Ziel pausieren' }));
  expect(await screen.findByText('Dein Lernziel ist pausiert.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Ziel fortsetzen' }));
  expect(await screen.findByText('Dein Lernziel läuft wieder.')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Ziel beenden' }));
  expect(screen.getByRole('alertdialog')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Ziel beenden' })).toHaveFocus();

  await user.click(screen.getByRole('button', { name: 'Ziel beenden' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Weiterlernen' }));
  expect(screen.getByText('0 von 1 Kursinhalt')).toBeVisible();
  expect(global.fetch).not.toHaveBeenCalledWith('/api/learning-goals/me', expect.objectContaining({ method: 'DELETE' }));

  await user.click(screen.getByRole('button', { name: 'Ziel beenden' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Ziel beenden' }));
  expect(await screen.findByRole('button', { name: 'Privates Lernziel starten' })).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText('Kursinhalte abschließen')).toHaveFocus());
  expect(screen.getByRole('status')).toHaveTextContent('Dein Lernziel wurde beendet.');
});

test('a slow refresh cannot overwrite a saved pause', async () => {
  const user = userEvent.setup();
  const active: Goal = { targetLeaves: 3, durationDays: 7, timezone: 'UTC', startedAt: '2026-10-15T08:00:00.000Z', endsAt: '2026-10-22T00:00:00.000Z', pausedAt: null, completedLeaves: 0, status: 'active' };
  const paused: Goal = { ...active, pausedAt: '2026-10-15T09:00:00.000Z', status: 'paused' };
  let resolveRefresh!: (value: ReturnType<typeof reply>) => void;
  const slowRefresh = new Promise<ReturnType<typeof reply>>(resolve => { resolveRefresh = resolve; });
  let reads = 0;
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return reply(paused);
    return ++reads === 1 ? reply(active) : slowRefresh;
  }) as jest.Mock;

  render(<CourseGoalsClient />);
  expect(await screen.findByRole('button', { name: 'Ziel pausieren' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Fortschritt aktualisieren' }));
  await user.click(screen.getByRole('button', { name: 'Ziel pausieren' }));
  expect(await screen.findByRole('button', { name: 'Ziel fortsetzen' })).toBeVisible();
  await act(async () => { resolveRefresh(reply(active)); await slowRefresh; });
  expect(screen.getByRole('button', { name: 'Ziel fortsetzen' })).toBeVisible();
  expect(screen.getByText('Pausiert')).toBeVisible();
});

test('a slow refresh cannot resurrect a cancelled goal', async () => {
  const user = userEvent.setup();
  const active: Goal = { targetLeaves: 3, durationDays: 7, timezone: 'UTC', startedAt: '2026-10-15T08:00:00.000Z', endsAt: '2026-10-22T00:00:00.000Z', pausedAt: null, completedLeaves: 0, status: 'active' };
  let resolveRefresh!: (value: ReturnType<typeof reply>) => void;
  const slowRefresh = new Promise<ReturnType<typeof reply>>(resolve => { resolveRefresh = resolve; });
  let reads = 0;
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return reply(null);
    return ++reads === 1 ? reply(active) : slowRefresh;
  }) as jest.Mock;

  render(<CourseGoalsClient />);
  expect(await screen.findByRole('button', { name: 'Fortschritt aktualisieren' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Fortschritt aktualisieren' }));
  await user.click(screen.getByRole('button', { name: 'Ziel beenden' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Ziel beenden' }));
  expect(await screen.findByRole('button', { name: 'Privates Lernziel starten' })).toBeVisible();
  await act(async () => { resolveRefresh(reply(active)); await slowRefresh; });
  expect(screen.getByRole('button', { name: 'Privates Lernziel starten' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Ziel beenden' })).not.toBeInTheDocument();
});

test('logged-out session shows a sign-in path instead of a blank page', () => {
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() } as ReturnType<typeof useSession>);
  render(<CourseGoalsClient />);
  expect(screen.getByText('Melde dich an, um dein privates Lernziel zu sehen.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Zur Anmeldung' })).toHaveAttribute('href', '/login');
});

test('a prior account response cannot appear after switching accounts', async () => {
  let resolveAlice!: (value: ReturnType<typeof reply>) => void;
  const aliceResponse = new Promise<ReturnType<typeof reply>>(resolve => { resolveAlice = resolve; });
  let calls = 0;
  global.fetch = jest.fn(async () => ++calls === 1 ? aliceResponse : reply(null)) as jest.Mock;
  const view = render(<CourseGoalsClient />);
  jest.mocked(useSession).mockReturnValue(session('bob'));
  view.rerender(<CourseGoalsClient />);
  expect(await screen.findByRole('button', { name: 'Privates Lernziel starten' })).toBeVisible();
  resolveAlice(reply({ targetLeaves: 5, durationDays: 7, timezone: 'UTC', startedAt: '2026-10-15T08:00:00.000Z', endsAt: '2026-10-22T00:00:00.000Z', pausedAt: null, completedLeaves: 5, status: 'achieved' }));
  await aliceResponse;
  expect(screen.queryByText('Ziel erreicht')).not.toBeInTheDocument();
});
