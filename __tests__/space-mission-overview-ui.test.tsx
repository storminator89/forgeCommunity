import { StrictMode, type ComponentProps, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import MissionOverviewPage from '@/app/community/missions/page';
import type { SpaceMissionOverview } from '@/components/spaces/mission-api';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/link', () => ({ __esModule: true, default: function MockLink({ prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) {
  return <a data-prefetch={String(prefetch)} {...props} />;
} }));
jest.mock('@/components/spaces/SpaceShell', () => ({ SpaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const page = (items: SpaceMissionOverview[], nextCursor: string | null = null) => json({ items, nextCursor });
const mission = (id = 'mission', extras: Partial<SpaceMissionOverview> = {}): SpaceMissionOverview => ({
  id, title: `Mission ${id}`, space: { id: 'private space', name: 'Privater Lernraum' }, week: null,
  windowState: 'self-paced', participationActive: false, ...extras,
});
const week = { startDate: '2026-10-12', timezone: 'Europe/Berlin', startsAt: '2026-10-11T22:00:00.000Z', endsAt: '2026-10-18T22:00:00.000Z' };

function session(id = 'viewer', role = 'USER') {
  jest.mocked(useSession).mockReturnValue({ data: { user: { id, role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>);
}
function deferred() {
  let resolve!: (value: ReturnType<typeof json>) => void;
  const promise = new Promise<ReturnType<typeof json>>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks(); session();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

it('waits for authentication without requesting private data', () => {
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'loading', update: jest.fn() });
  render(<MissionOverviewPage />);
  expect(screen.getByRole('heading', { name: 'Space-Missionen werden geladen' })).toBeVisible();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('offers login and makes no private request without a current account', () => {
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() });
  render(<MissionOverviewPage />);
  expect(screen.getByRole('link', { name: 'Zur Anmeldung' })).toHaveAttribute('href', '/login?callbackUrl=%2Fcommunity%2Fmissions');
  expect(global.fetch).not.toHaveBeenCalled();
});

it('shows loading, minimal descriptive rows and detail links without prefetch or participation controls', async () => {
  const pending = deferred(); global.fetch = jest.fn().mockReturnValue(pending.promise);
  render(<MissionOverviewPage />);
  expect(screen.getByRole('heading', { name: 'Missionen werden geprüft' })).toBeVisible();
  await act(async () => pending.resolve(page([
    mission('self/pace'), mission('current', { week, windowState: 'current', participationActive: true }),
    mission('past', { week, windowState: 'past' }),
  ])));
  const detail = screen.getByRole('link', { name: 'Mission self/pace' });
  expect(detail).toHaveAttribute('href', '/community/spaces/private%20space/missions/self%2Fpace');
  expect(detail).toHaveAttribute('data-prefetch', 'false');
  expect(screen.getByText('Ohne feste Lernwoche · In deinem Tempo')).toBeVisible();
  expect(screen.getByText('Diese Lernwoche · Ohne verpflichtende Frist')).toBeVisible();
  expect(screen.getByText('Lernwoche vorbei · Mission bleibt offen')).toBeVisible();
  expect(screen.getAllByText('12. Oktober – 18. Oktober 2026 · Europe/Berlin')).toHaveLength(2);
  expect(screen.getAllByText('Du nimmst teil')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /teilnehmen|beenden|erstellen|teilen/i })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/space-missions', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }));
  expect((global.fetch as jest.Mock).mock.calls.every(([, init]) => !init.method)).toBe(true);
});

it('explains an empty result and links to Spaces', async () => {
  global.fetch = jest.fn().mockResolvedValue(page([]));
  render(<MissionOverviewPage />);
  expect(await screen.findByRole('heading', { name: 'Keine offenen Missionen' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Zu den Spaces' })).toHaveAttribute('href', '/community/spaces');
});

it('clears private cards on a failed refresh and can retry', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(page([mission()])).mockResolvedValueOnce(json({ error: 'unavailable' }, 500)).mockResolvedValueOnce(page([]));
  render(<MissionOverviewPage />);
  await screen.findByRole('link', { name: 'Mission mission' });
  fireEvent.click(screen.getByRole('button', { name: 'Übersicht aktualisieren' }));
  expect(screen.queryByRole('link', { name: 'Mission mission' })).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Missionen nicht verfügbar' })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByRole('heading', { name: 'Keine offenen Missionen' })).toBeVisible();
});

it('purges a deleted-account response on the next authorization read', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(page([mission()])).mockResolvedValueOnce(json({ error: 'Unauthorized' }, 401));
  render(<MissionOverviewPage />);
  await screen.findByRole('link', { name: 'Mission mission' });
  fireEvent.focus(window);
  expect(await screen.findByText('Deine Anmeldung ist nicht mehr gültig. Melde dich erneut an.')).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Mission mission' })).not.toBeInTheDocument();
});

it.each(['account', 'role'])('discards visible and in-flight data on an %s change even if abort is ignored', async change => {
  const old = deferred();
  global.fetch = jest.fn().mockResolvedValueOnce(page([mission()])).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([]));
  const view = render(<MissionOverviewPage />);
  await screen.findByRole('link', { name: 'Mission mission' });
  fireEvent.focus(window);
  const oldSignal = (global.fetch as jest.Mock).mock.calls[1][1].signal as AbortSignal;
  session(change === 'account' ? 'other-viewer' : 'viewer', change === 'role' ? 'ADMIN' : 'USER');
  view.rerender(<MissionOverviewPage />);
  expect(oldSignal.aborted).toBe(true);
  expect(screen.queryByRole('link', { name: 'Mission mission' })).not.toBeInTheDocument();
  await screen.findByRole('heading', { name: 'Keine offenen Missionen' });
  await act(async () => old.resolve(page([mission('late-private')])));
  expect(screen.queryByRole('link', { name: /late-private/ })).not.toBeInTheDocument();
});

it('removes private cards when the session disappears', async () => {
  global.fetch = jest.fn().mockResolvedValue(page([mission()]));
  const view = render(<MissionOverviewPage />);
  await screen.findByRole('link', { name: 'Mission mission' });
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() });
  view.rerender(<MissionOverviewPage />);
  expect(screen.queryByRole('link', { name: 'Mission mission' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Anmeldung erforderlich' })).toBeVisible();
});

it.each(['focus', 'visibilitychange', 'manual'])('hides cards throughout %s revalidation and drops revoked membership', async event => {
  const refresh = deferred();
  global.fetch = jest.fn().mockResolvedValueOnce(page([mission()])).mockReturnValueOnce(refresh.promise);
  render(<MissionOverviewPage />);
  await screen.findByRole('link', { name: 'Mission mission' });
  if (event === 'focus') fireEvent.focus(window);
  else if (event === 'visibilitychange') fireEvent(document, new Event('visibilitychange'));
  else fireEvent.click(screen.getByRole('button', { name: 'Übersicht aktualisieren' }));
  expect(screen.queryByRole('link', { name: 'Mission mission' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Missionen werden geprüft' })).toBeVisible();
  await act(async () => refresh.resolve(page([])));
  expect(screen.getByRole('heading', { name: 'Keine offenen Missionen' })).toBeVisible();
});

it('waits until a hidden document becomes visible before rechecking', async () => {
  global.fetch = jest.fn().mockResolvedValue(page([])); render(<MissionOverviewPage />);
  await screen.findByRole('heading', { name: 'Keine offenen Missionen' });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange')); fireEvent.focus(window);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  fireEvent(document, new Event('visibilitychange'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
});

it('revalidates the old prefix and a fresh new page before showing either on keyboard load-more', async () => {
  const prefix = deferred(); const more = deferred();
  global.fetch = jest.fn().mockResolvedValueOnce(page([mission('revoked')], 'old-cursor')).mockReturnValueOnce(prefix.promise).mockReturnValueOnce(more.promise);
  render(<MissionOverviewPage />);
  await screen.findByRole('link', { name: 'Mission revoked' });
  screen.getByRole('button', { name: 'Weitere Missionen laden' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.queryByRole('link', { name: 'Mission revoked' })).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe('/api/space-missions');
  await act(async () => prefix.resolve(page([mission('still-member')], 'fresh/cursor')));
  expect(screen.queryByRole('link', { name: 'Mission still-member' })).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls[2][0]).toBe('/api/space-missions?cursor=fresh%2Fcursor');
  await act(async () => more.resolve(page([mission('next')])));
  expect(screen.getByRole('link', { name: 'Mission still-member' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Mission next' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Mission revoked' })).not.toBeInTheDocument();
  expect(screen.getByText('2 Missionen geladen')).toHaveFocus();
});

it('never appends cached private rows if a membership is revoked between page visits', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(page([mission('revoked')], 'old')).mockResolvedValueOnce(page([]));
  render(<MissionOverviewPage />);
  await screen.findByRole('link', { name: 'Mission revoked' });
  await userEvent.click(screen.getByRole('button', { name: 'Weitere Missionen laden' }));
  expect(await screen.findByRole('heading', { name: 'Keine offenen Missionen' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Mission revoked' })).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.map(([path]) => path)).toEqual(['/api/space-missions', '/api/space-missions']);
});

it('clears the entire revalidated prefix if the next page fails', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(page([mission()], 'cursor')).mockResolvedValueOnce(page([mission()], 'new')).mockRejectedValueOnce(new Error('offline'));
  render(<MissionOverviewPage />); await screen.findByRole('link', { name: 'Mission mission' });
  await userEvent.click(screen.getByRole('button', { name: 'Weitere Missionen laden' }));
  expect(await screen.findByRole('heading', { name: 'Missionen nicht verfügbar' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Mission mission' })).not.toBeInTheDocument();
});

it('ignores late successful pagination after a newer focus refresh, even if transport ignores abort', async () => {
  const old = deferred();
  global.fetch = jest.fn().mockResolvedValueOnce(page([mission()], 'cursor')).mockResolvedValueOnce(page([mission()], 'fresh')).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([]));
  render(<MissionOverviewPage />); await screen.findByRole('link', { name: 'Mission mission' });
  await userEvent.click(screen.getByRole('button', { name: 'Weitere Missionen laden' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  const signal = (global.fetch as jest.Mock).mock.calls[2][1].signal as AbortSignal;
  fireEvent.focus(window);
  await screen.findByRole('heading', { name: 'Keine offenen Missionen' });
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(page([mission('late-private')])));
  expect(screen.queryByRole('link', { name: /Mission / })).not.toBeInTheDocument();
});

it('revalidates all loaded pages on focus and safely handles StrictMode effect replay', async () => {
  global.fetch = jest.fn().mockImplementation((path: string) => Promise.resolve(path.includes('?') ? page([mission('second')]) : page([mission()], 'next')));
  render(<StrictMode><MissionOverviewPage /></StrictMode>);
  await screen.findByRole('link', { name: 'Mission mission' });
  await userEvent.click(screen.getByRole('button', { name: 'Weitere Missionen laden' }));
  await screen.findByRole('link', { name: 'Mission second' });
  (global.fetch as jest.Mock).mockClear();
  fireEvent.focus(window);
  await screen.findByRole('link', { name: 'Mission second' });
  expect((global.fetch as jest.Mock).mock.calls.map(([path]) => path)).toEqual(['/api/space-missions', '/api/space-missions?cursor=next']);
});
