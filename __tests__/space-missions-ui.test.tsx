import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import SpaceMissionPage from '@/app/community/spaces/[spaceId]/missions/[missionId]/page';
import { SpaceMissionIndex } from '@/components/spaces/SpaceMissionIndex';
import { ModerationQueue } from '@/app/moderation/ModerationQueue';
import { spaceJson, type SpaceSummary } from '@/components/spaces/space-api';
import { missionCurrentMonday, missionWeekDates, missionWeekPreview, type MissionAuditContribution, type MissionContribution, type SpaceMission } from '@/components/spaces/mission-api';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useParams: jest.fn(), useRouter: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));

const now = '2026-10-15T12:00:00.000Z';
const base = '/api/spaces/secret/missions/mission-1';
const member = { id: 'member', name: 'Mara', image: null };
const peer = { id: 'peer', name: 'Jonas', image: null };
const privateSpace: SpaceSummary = {
  id: 'secret', name: 'Privater Austausch', description: 'Ein privater Lernraum', visibility: 'PRIVATE',
  createdAt: now, updatedAt: now, memberCount: 3, discussionCount: 0, isMember: true, canManage: false, canWrite: true,
};
const insight: MissionContribution = {
  id: 'peer-insight', kind: 'INSIGHT', content: 'Jonas erklärt einen vertraulichen Zusammenhang.',
  author: peer, createdAt: now, targetContributionId: null, canWithdraw: false,
};
const ownInsight: MissionContribution = {
  ...insight, id: 'own-insight', content: 'Meine bisherige vertrauliche Erkenntnis.', author: member, canWithdraw: true,
};
const mission = (overrides: Partial<SpaceMission> = {}): SpaceMission => ({
  id: 'mission-1', spaceId: 'secret', title: 'Gemeinsam Zusammenhänge erklären', prompt: 'Welche Verbindung hilft euch beim Verstehen?',
  creator: { id: 'admin', name: 'Ada', image: null }, createdAt: now, closedAt: null,
  week: null, windowState: 'self-paced',
  participants: [{ ...member, joinedAt: now }, { ...peer, joinedAt: now }], participantLimit: 5,
  participation: { epoch: 7, active: true, joinedAt: now, optedOutAt: null },
  canManage: false, canJoin: false, contributions: [insight], ownContributions: [],
  progress: { insightAuthors: 1, hasCrossPersonBuildOn: false, complete: false }, ...overrides,
});
const autumnWeek = { startDate: '2026-10-19', timezone: 'Europe/Berlin', startsAt: '2026-10-18T22:00:00.000Z', endsAt: '2026-10-25T23:00:00.000Z' };
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
type JsonResponse = ReturnType<typeof json>;
const session = (id: string, role = 'USER') => ({
  data: { user: { id, role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
} as ReturnType<typeof useSession>);

function serveMission(getMission: () => SpaceMission, extra?: (path: string, init?: RequestInit) => Promise<JsonResponse> | undefined) {
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    const result = extra?.(path, init);
    if (result) return result;
    if (path === '/api/spaces/secret') return Promise.resolve(json(privateSpace));
    if (path === base && (!init?.method || init.method === 'GET')) return Promise.resolve(json(getMission()));
    throw new Error(`Unexpected request ${init?.method || 'GET'} ${path}`);
  });
}

async function confirm(label: string) {
  await userEvent.click(screen.getByRole('button', { name: label }));
  const dialog = await screen.findByRole('dialog', { name: `${label}?` });
  await userEvent.click(within(dialog).getByRole('button', { name: label }));
}

function mutationCalls(path: string, method: string) {
  return jest.mocked(global.fetch).mock.calls.filter(([url, init]) => url === path && init?.method === method);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useParams).mockReturnValue({ spaceId: 'secret', missionId: 'mission-1' });
  jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useSession).mockReturnValue(session('member'));
  Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => 'request-id-1') });
});

test('names participants and contribution authors and renders only server-derived shared progress without mastery rewards', async () => {
  const buildOn: MissionContribution = { ...ownInsight, id: 'build-on', kind: 'BUILD_ON', targetContributionId: insight.id };
  serveMission(() => mission({ contributions: [insight, buildOn], progress: { insightAuthors: 0, hasCrossPersonBuildOn: false, complete: false } }));
  render(<SpaceMissionPage />);
  await screen.findByRole('heading', { level: 1, name: 'Gemeinsam Zusammenhänge erklären' });
  expect(screen.getByText('Mara (du)')).toBeVisible();
  expect(screen.getAllByText('Jonas').length).toBeGreaterThan(0);
  expect(screen.getByText(insight.content)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Jonass Erkenntnis' })).toHaveAttribute('href', '#mission-contribution-peer-insight');
  expect(screen.getByText('0/2')).toBeVisible();
  expect(screen.getByText('0/1')).toBeVisible();
  expect(screen.getByText('Das gemeinsame Ziel ist noch offen.')).toBeVisible();
  expect(screen.getByText('Kein Wissensnachweis. Kein Einfluss auf deinen Kursfortschritt.')).toBeVisible();
  await userEvent.click(screen.getByText('So funktioniert das Ziel'));
  expect(screen.getByText(/Diese Mission bewertet kein Wissen und verändert deinen Kursfortschritt nicht/)).toBeVisible();
  expect(screen.queryByText(/XP|Rangliste|Meisterschaft|Zertifikat|Streak/i)).not.toBeInTheDocument();
});

test('uses the server completion projection rather than reconstructing achievements from visible contributions', async () => {
  serveMission(() => mission({ contributions: [], progress: { insightAuthors: 2, hasCrossPersonBuildOn: true, complete: true } }));
  render(<SpaceMissionPage />);
  expect(await screen.findByText('Gemeinsam weitergedacht. Das aktuelle Ziel ist erreicht.')).toBeVisible();
  expect(screen.getByText('2/2')).toBeVisible();
  expect(screen.getByText('1/1')).toBeVisible();
});

test('voluntary opt-in sends the current expected epoch and waits for a fresh server projection', async () => {
  let current = mission({ participation: { epoch: 3, active: false, joinedAt: null, optedOutAt: now }, canJoin: true });
  let finishJoin!: (value: JsonResponse) => void;
  serveMission(() => current, (path, init) => path === `${base}/participation` && init?.method === 'POST'
    ? new Promise(resolve => { finishJoin = resolve; }) : undefined);
  render(<SpaceMissionPage />);
  const join = await screen.findByRole('button', { name: 'Freiwillig teilnehmen' });
  expect(join).toHaveAccessibleDescription(/Dein Name und deine Beiträge.*aktuelle Mitglieder.*privaten Spaces/);
  expect(screen.getByText(/Bereits Gesehenes lässt sich nicht zurückholen/)).toBeVisible();
  expect(screen.getByText(/Änderungen Rückschlüsse auf einzelne Personen erlauben/)).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Deine Erkenntnis' })).not.toBeInTheDocument();
  await userEvent.click(join);
  expect(JSON.parse(mutationCalls(`${base}/participation`, 'POST')[0][1]!.body as string)).toEqual({ expectedEpoch: 3 });
  expect(screen.getByRole('heading', { name: 'Mission wird aktualisiert' })).toBeVisible();
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  current = mission({ participation: { epoch: 4, active: true, joinedAt: now, optedOutAt: null } });
  await act(async () => { finishJoin(json(mission({ title: 'Stale mutation snapshot' }))); });
  expect(await screen.findByRole('textbox', { name: 'Deine Erkenntnis' })).toBeVisible();
  expect(screen.queryByText('Stale mutation snapshot')).not.toBeInTheDocument();
});

test('leaving requires confirmation, purges content while pending, and rejoining never restores old own posts', async () => {
  let current = mission({ contributions: [ownInsight, insight], ownContributions: [{ id: ownInsight.id, kind: 'INSIGHT', hidden: false, targetUnavailable: false, canWithdraw: true }] });
  let finishLeave!: (value: JsonResponse) => void;
  serveMission(() => current, (path, init) => {
    if (path !== `${base}/participation`) return undefined;
    if (init?.method === 'DELETE') return new Promise(resolve => { finishLeave = resolve; });
    if (init?.method === 'POST') {
      current = mission({ participation: { epoch: 9, active: true, joinedAt: now, optedOutAt: null }, ownContributions: [] });
      return Promise.resolve(json({ ...current, contributions: [ownInsight, insight] }));
    }
    return undefined;
  });
  render(<SpaceMissionPage />);
  expect(await screen.findByText(ownInsight.content)).toBeVisible();
  await userEvent.click(screen.getByRole('radio', { name: 'Darauf aufbauen' }));
  await userEvent.click(screen.getByRole('radio', { name: `Jonas: ${insight.content}` }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Dein weiterführender Gedanke' }), 'Ein privater Entwurf aus der alten Teilnahme.');
  await userEvent.click(screen.getByRole('button', { name: 'Teilnahme beenden' }));
  const dialog = await screen.findByRole('dialog', { name: 'Teilnahme beenden?' });
  expect(within(dialog).getByText(/Erneutes Beitreten macht alte Beiträge nicht wieder sichtbar/)).toBeVisible();
  expect(mutationCalls(`${base}/participation`, 'DELETE')).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
  expect(screen.getByText(ownInsight.content)).toBeVisible();
  await confirm('Teilnahme beenden');
  expect(JSON.parse(mutationCalls(`${base}/participation`, 'DELETE')[0][1]!.body as string)).toEqual({ epoch: 7 });
  expect(screen.queryByText(ownInsight.content)).not.toBeInTheDocument();
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  current = mission({ participation: { epoch: 8, active: false, joinedAt: now, optedOutAt: now }, canJoin: true, ownContributions: [] });
  await act(async () => { finishLeave(json(mission({ contributions: [ownInsight, insight] }))); });
  await userEvent.click(await screen.findByRole('button', { name: 'Freiwillig teilnehmen' }));
  await screen.findByRole('textbox', { name: 'Deine Erkenntnis' });
  expect(screen.getByRole('radio', { name: 'Eine Erkenntnis' })).toBeChecked();
  expect(screen.queryByDisplayValue('Ein privater Entwurf aus der alten Teilnahme.')).not.toBeInTheDocument();
  expect(JSON.parse(mutationCalls(`${base}/participation`, 'POST')[0][1]!.body as string)).toEqual({ expectedEpoch: 8 });
  expect(screen.queryByText(ownInsight.content)).not.toBeInTheDocument();
});

test.each(['INSIGHT', 'BUILD_ON'] as const)('posts %s with only its exact epoch, content, target, and stable request ID contract', async kind => {
  let current = mission();
  serveMission(() => current, (path, init) => {
    if (path === `${base}/contributions` && init?.method === 'POST') {
      current = mission({ ownContributions: [{ id: 'new', kind, hidden: false, targetUnavailable: false, canWithdraw: true }] });
      return Promise.resolve(json(current, 201));
    }
    return undefined;
  });
  render(<SpaceMissionPage />);
  await screen.findByRole('textbox', { name: 'Deine Erkenntnis' });
  if (kind === 'BUILD_ON') {
    await userEvent.click(screen.getByRole('radio', { name: 'Darauf aufbauen' }));
    expect(screen.getByRole('button', { name: 'Im Space teilen' })).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: `Jonas: ${insight.content}` }));
  }
  const label = kind === 'INSIGHT' ? 'Deine Erkenntnis' : 'Dein weiterführender Gedanke';
  const input = screen.getByRole('textbox', { name: label });
  expect(screen.getByText(/In kleinen Gruppen können Änderungen einzelne Personen erkennen lassen/)).toBeVisible();
  expect(input).toHaveAttribute('minlength', '10');
  expect(input).toHaveAttribute('maxlength', '2000');
  fireEvent.change(input, { target: { value: '  Ein gemeinsam formulierter Gedanke.  ' } });
  await userEvent.click(screen.getByRole('button', { name: 'Im Space teilen' }));
  await waitFor(() => expect(mutationCalls(`${base}/contributions`, 'POST')).toHaveLength(1));
  expect(JSON.parse(mutationCalls(`${base}/contributions`, 'POST')[0][1]!.body as string)).toEqual({
    kind, content: 'Ein gemeinsam formulierter Gedanke.', epoch: 7,
    targetContributionId: kind === 'BUILD_ON' ? insight.id : null, requestId: 'request-id-1',
  });
  await screen.findByText('Dein Beitrag ist im Space sichtbar.');
});

test.each([
  { kind: 'INSIGHT' as const, hidden: true, targetUnavailable: false, description: /Dein Beitrag \(Erkenntnis\) ist ausgeblendet/ },
  { kind: 'BUILD_ON' as const, hidden: false, targetUnavailable: true, description: /Dein Beitrag \(Weitergedacht\) ist wegen einer nicht mehr sichtbaren Erkenntnis verborgen/ },
])('retains withdrawal for an own $kind metadata-only contribution without exposing its hidden body', async metadata => {
  let current = mission({ ownContributions: [{ id: 'hidden-own', kind: metadata.kind, hidden: metadata.hidden, targetUnavailable: metadata.targetUnavailable, canWithdraw: true }] });
  serveMission(() => current, (path, init) => {
    if (path === `${base}/contributions/hidden-own` && init?.method === 'DELETE') {
      current = mission();
      return Promise.resolve(json(current));
    }
    return undefined;
  });
  render(<SpaceMissionPage />);
  expect(await screen.findByText(metadata.description)).toBeVisible();
  if (metadata.hidden) expect(screen.getByRole('radio', { name: 'Eine Erkenntnis' })).toBeEnabled();
  else expect(screen.getByRole('radio', { name: 'Darauf aufbauen (geteilt)' })).toBeDisabled();
  expect(screen.queryByText(ownInsight.content)).not.toBeInTheDocument();
  await confirm('Beitrag zurückziehen');
  expect(JSON.parse(mutationCalls(`${base}/contributions/hidden-own`, 'DELETE')[0][1]!.body as string)).toEqual({ epoch: 7 });
  expect(await screen.findByText('Dein verborgener Beitrag ist zurückgezogen.')).toBeVisible();
  expect(screen.queryByText(metadata.description)).not.toBeInTheDocument();
});

test('a closed mission blocks new joins and posts while preserving leave and own withdrawal controls', async () => {
  let current = mission({ closedAt: now, contributions: [ownInsight], ownContributions: [{ id: ownInsight.id, kind: 'INSIGHT', hidden: false, targetUnavailable: false, canWithdraw: true }] });
  serveMission(() => current);
  render(<SpaceMissionPage />);
  await screen.findByText(ownInsight.content);
  expect(screen.getByText(/Die Mission ist geschlossen. Du kannst deine Teilnahme weiterhin beenden/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Teilnahme beenden' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Beitrag zurückziehen' })).toBeEnabled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Freiwillig teilnehmen' })).not.toBeInTheDocument();
  current = mission({ closedAt: now, participation: { epoch: 8, active: false, joinedAt: now, optedOutAt: now }, canJoin: false });
  await act(async () => { fireEvent.focus(window); });
  await screen.findByText(insight.content);
  expect(screen.queryByRole('button', { name: 'Freiwillig teilnehmen' })).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test.each([
  { id: 'another-account', role: 'USER', label: 'account' },
  { id: 'member', role: 'INSTRUCTOR', label: 'role' },
])('switching the $label removes the previous snapshot and draft before the new read resolves', async next => {
  let oldRead = true;
  let finishNewRead!: (value: JsonResponse) => void;
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json(privateSpace));
    if (path === base) return oldRead ? Promise.resolve(json(mission())) : new Promise(resolve => { finishNewRead = resolve; });
    throw new Error(`Unexpected ${path}`);
  });
  const view = render(<SpaceMissionPage />);
  const input = await screen.findByRole('textbox', { name: 'Deine Erkenntnis' });
  await userEvent.type(input, 'A private draft from the previous session');
  oldRead = false;
  jest.mocked(useSession).mockReturnValue(session(next.id, next.role));
  view.rerender(<SpaceMissionPage />);
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('A private draft from the previous session')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Mission wird geladen' })).toBeVisible();
  await waitFor(() => expect(finishNewRead).toEqual(expect.any(Function)));
  await act(async () => { finishNewRead(json(mission({ contributions: [], canJoin: false }))); });
  expect(await screen.findByRole('textbox', { name: 'Deine Erkenntnis' })).toHaveValue('');
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
});

test('focus revalidation purges draft and private material immediately and ignores a late obsolete 200', async () => {
  let reads = 0;
  let finishOldRead!: (value: JsonResponse) => void;
  let oldSignal: AbortSignal | undefined;
  global.fetch = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json(privateSpace));
    if (path === base) {
      reads++;
      if (reads === 1) return Promise.resolve(json(mission()));
      if (reads === 2) { oldSignal = init?.signal as AbortSignal; return new Promise(resolve => { finishOldRead = resolve; }); }
      return Promise.resolve(json(mission({ contributions: [], ownContributions: [], progress: { insightAuthors: 0, hasCrossPersonBuildOn: false, complete: false } })));
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<SpaceMissionPage />);
  await userEvent.type(await screen.findByRole('textbox', { name: 'Deine Erkenntnis' }), 'Draft that must not survive revalidation');
  await act(async () => { fireEvent.focus(window); });
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Draft that must not survive revalidation')).not.toBeInTheDocument();
  await act(async () => { fireEvent.focus(window); });
  expect(oldSignal?.aborted).toBe(true);
  expect(await screen.findByRole('textbox', { name: 'Deine Erkenntnis' })).toHaveValue('');
  await act(async () => { finishOldRead(json(mission())); });
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  expect(screen.getByText('0/2')).toBeVisible();
});

test('focus preserves the selected kind within consent and resets it when a different participation epoch is observed', async () => {
  let current = mission();
  serveMission(() => current);
  render(<SpaceMissionPage />);
  await screen.findByRole('textbox', { name: 'Deine Erkenntnis' });
  await userEvent.click(screen.getByRole('radio', { name: 'Darauf aufbauen' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Dein weiterführender Gedanke' }), 'Privater Entwurf der bisherigen Teilnahme.');
  await act(async () => { fireEvent.focus(window); });
  expect(await screen.findByRole('textbox', { name: 'Dein weiterführender Gedanke' })).toHaveValue('');
  current = mission({ participation: { epoch: 8, active: true, joinedAt: now, optedOutAt: null }, ownContributions: [] });
  await act(async () => { fireEvent.focus(window); });
  expect(await screen.findByRole('textbox', { name: 'Deine Erkenntnis' })).toHaveValue('');
  expect(screen.getByRole('radio', { name: 'Eine Erkenntnis' })).toBeChecked();
  expect(screen.queryByRole('textbox', { name: 'Dein weiterführender Gedanke' })).not.toBeInTheDocument();
});

test.each([401, 403, 404])('a %i focus permission rejection clears the snapshot and prevents a late old read from restoring it', async status => {
  let reads = 0;
  let finishOldRead!: (value: JsonResponse) => void;
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json(privateSpace));
    if (path === base) {
      reads++;
      if (reads === 1) return Promise.resolve(json(mission()));
      if (reads === 2) return new Promise(resolve => { finishOldRead = resolve; });
      return Promise.resolve(json({ error: 'Access removed' }, status));
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<SpaceMissionPage />);
  await screen.findByText(insight.content);
  await act(async () => { fireEvent.focus(window); });
  await act(async () => { fireEvent.focus(window); });
  await screen.findByText('Du hast keinen Zugriff auf diese Mission.');
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  await act(async () => { finishOldRead(json(mission())); });
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test.each([401, 403, 404])('a report %i uses the mission access scope and purges the page rather than leaving private content behind', async status => {
  serveMission(() => mission(), (path, init) => path === '/api/reports' && init?.method === 'POST'
    ? Promise.resolve(json({ error: 'Report target unavailable' }, status)) : undefined);
  render(<SpaceMissionPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Missionsbeitrag melden' }));
  const dialog = await screen.findByRole('dialog', { name: 'Missionsbeitrag melden' });
  expect(within(dialog).getByText(/nur Admins dieses privaten Spaces prüfen/)).toBeVisible();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Meldung senden' }));
  expect(JSON.parse(mutationCalls('/api/reports', 'POST')[0][1]!.body as string)).toEqual({ targetType: 'SPACE_MISSION_CONTRIBUTION', targetId: insight.id, reason: 'SPAM', details: '' });
  await screen.findByText('Du hast keinen Zugriff auf diese Mission.');
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('admin creation enforces field limits and reuses the same request ID when replaying an unchanged failed request', async () => {
  const push = jest.fn();
  jest.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  let createAttempts = 0;
  const request = jest.fn().mockImplementation((path: string, init?: RequestInit) => {
    if (path !== '/api/spaces/secret/missions') throw new Error(`Unexpected ${path}`);
    if (init?.method === 'POST') {
      if (++createAttempts === 1) return Promise.reject(new Error('Bitte erneut versuchen.'));
      return Promise.resolve(mission());
    }
    return Promise.resolve({ items: [], nextCursor: null });
  });
  render(<SpaceMissionIndex spaceId="secret" canManage request={request} onUnavailable={jest.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Mission starten' }));
  const title = screen.getByRole('textbox', { name: 'Thema' });
  const prompt = screen.getByRole('textbox', { name: 'Aufgabe' });
  expect(title).toHaveFocus();
  expect(title).toHaveAttribute('minlength', '3');
  expect(title).toHaveAttribute('maxlength', '100');
  expect(prompt).toHaveAttribute('minlength', '10');
  expect(prompt).toHaveAttribute('maxlength', '2000');
  fireEvent.change(title, { target: { value: '  Gemeinsames Thema  ' } });
  fireEvent.change(prompt, { target: { value: '  Erklärt einen Zusammenhang in eigenen Worten.  ' } });
  await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
  await screen.findByText('Bitte erneut versuchen.');
  await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
  await waitFor(() => expect(push).toHaveBeenCalledWith('/community/spaces/secret/missions/mission-1'));
  const posted = request.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posted).toHaveLength(2);
  expect(JSON.parse(posted[0][1]!.body as string)).toEqual({ title: 'Gemeinsames Thema', prompt: 'Erklärt einen Zusammenhang in eigenen Worten.', requestId: 'request-id-1' });
  expect(posted[1][1]!.body).toBe(posted[0][1]!.body);
  expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
});

test('members cannot create a mission and an existing open mission prevents another admin creation', async () => {
  global.fetch = jest.fn().mockResolvedValue(json({ items: [mission()], nextCursor: null }));
  const onUnavailable = jest.fn();
  const view = render(<SpaceMissionIndex spaceId="secret" canManage={false} request={spaceJson} onUnavailable={onUnavailable} />);
  await screen.findByRole('link', { name: 'Gemeinsam Zusammenhänge erklären' });
  expect(screen.queryByRole('button', { name: 'Mission starten' })).not.toBeInTheDocument();
  view.rerender(<SpaceMissionIndex spaceId="secret" canManage request={spaceJson} onUnavailable={onUnavailable} />);
  expect(screen.queryByRole('button', { name: 'Mission starten' })).not.toBeInTheDocument();
});

test('admin close requires confirmation, sends only closed true, and keeps visible contributions after refresh', async () => {
  let current = mission({ canManage: true });
  serveMission(() => current, (path, init) => {
    if (path === base && init?.method === 'PATCH') {
      current = mission({ canManage: true, closedAt: now });
      return Promise.resolve(json(current));
    }
    return undefined;
  });
  render(<SpaceMissionPage />);
  await screen.findByText(insight.content);
  await userEvent.click(screen.getByRole('button', { name: 'Mission schließen' }));
  const dialog = await screen.findByRole('dialog', { name: 'Mission schließen?' });
  expect(within(dialog).getByText(/Teilnehmende können weiter austreten und eigene Beiträge zurückziehen/)).toBeVisible();
  expect(mutationCalls(base, 'PATCH')).toHaveLength(0);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Mission schließen' }));
  expect(JSON.parse(mutationCalls(base, 'PATCH')[0][1]!.body as string)).toEqual({ closed: true });
  expect(await screen.findByText('Die Mission ist geschlossen.')).toBeVisible();
  expect(screen.getByText(insight.content)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Teilnahme beenden' })).toBeEnabled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mission schließen' })).not.toBeInTheDocument();
});

test('retained admin material is fetched only on explicit expansion and a withdrawn contribution has no restoration control', async () => {
  const retained: MissionAuditContribution = { ...insight, id: 'retained', content: 'Retained moderation material', hiddenAt: now, withdrawnAt: null };
  const withdrawn: MissionAuditContribution = { ...retained, id: 'withdrawn', content: 'A person withdrew this old contribution', withdrawnAt: now };
  serveMission(() => mission({ canManage: true }), (path, init) => path === `${base}/contributions/moderation` && !init?.method
    ? Promise.resolve(json({ items: [retained, withdrawn], nextCursor: null })) : undefined);
  render(<SpaceMissionPage />);
  await screen.findByRole('button', { name: 'Moderation ansehen' });
  expect(jest.mocked(global.fetch).mock.calls.some(([path]) => path === `${base}/contributions/moderation`)).toBe(false);
  expect(screen.queryByText(retained.content)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Moderation ansehen' }));
  expect(await screen.findByText(retained.content)).toBeVisible();
  const withdrawnRow = screen.getByText(withdrawn.content).closest('li')!;
  expect(within(withdrawnRow).getByText(/Von der Person zurückgezogen/)).toBeVisible();
  expect(within(withdrawnRow).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Wieder einblenden' })).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Moderation schließen' }));
  expect(screen.queryByText(retained.content)).not.toBeInTheDocument();
  expect(screen.queryByText(withdrawn.content)).not.toBeInTheDocument();
});

test('admin restoration sends only hidden false and relies on the fresh visible projection', async () => {
  const retained: MissionAuditContribution = { ...insight, id: 'retained', content: 'Inactive participant retained content', hiddenAt: now, withdrawnAt: null };
  serveMission(() => mission({ canManage: true }), (path, init) => {
    if (path === `${base}/contributions/moderation`) return Promise.resolve(json({ items: [retained], nextCursor: null }));
    if (path === `${base}/contributions/retained/moderation` && init?.method === 'PATCH') return Promise.resolve(json({ ...mission(), contributions: [{ ...retained, canWithdraw: false }] }));
    return undefined;
  });
  render(<SpaceMissionPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Moderation ansehen' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Wieder einblenden' }));
  expect(JSON.parse(mutationCalls(`${base}/contributions/retained/moderation`, 'PATCH')[0][1]!.body as string)).toEqual({ hidden: false });
  await screen.findByText('Moderation gespeichert. Nur aktuell gültige Beiträge sind sichtbar.');
  expect(screen.queryByText(retained.content)).not.toBeInTheDocument();
  expect(screen.getByText(insight.content)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Moderation ansehen' })).toHaveAttribute('aria-expanded', 'false');
});

test('an admin audit 403 purges the entire mission and its private contribution material', async () => {
  serveMission(() => mission({ canManage: true }), (path, init) => path === `${base}/contributions/moderation` && !init?.method
    ? Promise.resolve(json({ error: 'Admin access removed' }, 403)) : undefined);
  render(<SpaceMissionPage />);
  await screen.findByText(insight.content);
  await userEvent.click(screen.getByRole('button', { name: 'Moderation ansehen' }));
  await screen.findByText('Du hast keinen Zugriff auf diese Mission.');
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Moderation ansehen' })).not.toBeInTheDocument();
});

test('focus role revalidation discards retained admin material and a late audit response cannot revive it', async () => {
  let current = mission({ canManage: true });
  let finishAudit!: (value: JsonResponse) => void;
  let auditSignal: AbortSignal | undefined;
  serveMission(() => current, (path, init) => {
    if (path === `${base}/contributions/moderation`) {
      auditSignal = init?.signal as AbortSignal;
      return new Promise(resolve => { finishAudit = resolve; });
    }
    return undefined;
  });
  render(<SpaceMissionPage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Moderation ansehen' }));
  current = mission({ canManage: false, contributions: [] });
  await act(async () => { fireEvent.focus(window); });
  expect(auditSignal?.aborted).toBe(true);
  await screen.findByRole('heading', { level: 1, name: current.title });
  await act(async () => { finishAudit(json({ items: [{ ...insight, content: 'Late retained private material', hiddenAt: now, withdrawnAt: now }], nextCursor: null })); });
  expect(screen.queryByText('Late retained private material')).not.toBeInTheDocument();
  expect(screen.queryByText(insight.content)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Moderation ansehen' })).not.toBeInTheDocument();
});

test('a failed contribution retains its replay key for the same exact epoch and payload retry', async () => {
  let attempts = 0;
  serveMission(() => mission(), (path, init) => {
    if (path !== `${base}/contributions` || init?.method !== 'POST') return undefined;
    return ++attempts === 1 ? Promise.reject(new Error('Verbindung unterbrochen. Bitte erneut versuchen.')) : Promise.resolve(json(mission()));
  });
  render(<SpaceMissionPage />);
  const content = 'Ein unveränderter Gedanke für einen sicheren erneuten Versuch.';
  await userEvent.type(await screen.findByRole('textbox', { name: 'Deine Erkenntnis' }), content);
  await userEvent.click(screen.getByRole('button', { name: 'Im Space teilen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Verbindung unterbrochen. Bitte erneut versuchen.');
  await userEvent.type(screen.getByRole('textbox', { name: 'Deine Erkenntnis' }), content);
  await userEvent.click(screen.getByRole('button', { name: 'Im Space teilen' }));
  await screen.findByText('Dein Beitrag ist im Space sichtbar.');
  const posted = mutationCalls(`${base}/contributions`, 'POST');
  expect(posted).toHaveLength(2);
  expect(posted[1][1]!.body).toBe(posted[0][1]!.body);
  expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
});

test('mission reports link to the exact private mission and label retained withdrawn content', async () => {
  jest.mocked(useSession).mockReturnValue(session('admin', 'ADMIN'));
  global.fetch = jest.fn().mockResolvedValue(json({ items: [{
    id: 'report-1', targetType: 'SPACE_MISSION_CONTRIBUTION', targetId: 'retained-post', reason: 'SPAM',
    details: 'A private report for admins', status: 'OPEN', createdAt: now, reviewedAt: null,
    reviewedById: null, resolutionNote: null, targetAvailable: true, targetTitle: 'Private mission title',
    targetPreview: 'Retained withdrawn content', scopeSpaceId: 'secret', targetMissionId: 'mission-1', targetWithdrawn: true,
  }], total: 1, page: 1, pageSize: 20 }));
  render(<ModerationQueue />);
  expect(await screen.findByRole('link', { name: 'Inhalt öffnen' })).toHaveAttribute('href', '/community/spaces/secret/missions/mission-1#mission-contribution-retained-post');
  expect(screen.getByText('Von der Person zurückgezogen. Nur zur Moderation aufbewahrt.')).toBeVisible();
  expect(screen.getByText(/Meldungen aus privaten Spaces können nur Admins prüfen/)).toBeVisible();
});

test('the three learning steps guide reading without tracking it or inventing a third progress counter', async () => {
  serveMission(() => mission());
  render(<SpaceMissionPage />);
  await screen.findByRole('heading', { name: '1. In eigenen Worten erklären' });
  const reading = screen.getByRole('heading', { name: '2. Eine andere Erklärung lesen' }).closest('li')!;
  expect(within(reading).getByText('Wird nicht erfasst')).toBeVisible();
  await userEvent.click(screen.getByText('So funktioniert das Ziel'));
  expect(screen.getByText(/Lesen wird nicht erfasst oder abgehakt/)).toBeVisible();
  expect(within(reading).queryByRole('checkbox')).not.toBeInTheDocument();
  expect(within(reading).queryByText(/[●○✓]|\d\/\d/)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '3. Darauf aufbauen' })).toBeVisible();
  await userEvent.click(screen.getByText('Teilnahme und Privatsphäre'));
  expect(screen.getByText(/Änderungen Rückschlüsse auf einzelne Personen erlauben/)).toBeVisible();
  expect(screen.getByText(/Bereits Gesehenes lässt sich nicht zurückholen/)).toBeVisible();
});

test.each([
  { week: { startDate: '2026-03-23', timezone: 'Europe/Berlin', startsAt: '2026-03-22T23:00:00.000Z', endsAt: '2026-03-29T22:00:00.000Z' }, expected: '23. März – 29. März 2026 · Europe/Berlin' },
  { week: autumnWeek, expected: '19. Oktober – 25. Oktober 2026 · Europe/Berlin' },
])('renders stored calendar dates in $week.timezone across DST', ({ week, expected }) => {
  expect(missionWeekDates(week)).toBe(expected);
  expect(missionWeekPreview(week.startDate, week.timezone)).toBe(expected);
});

test('suggested Mondays follow the explicitly selected IANA zone without a silent fallback', () => {
  const boundary = Date.parse('2026-10-18T23:30:00.000Z');
  expect(missionCurrentMonday('UTC', boundary)).toBe('2026-10-12');
  expect(missionCurrentMonday('Europe/Berlin', boundary)).toBe('2026-10-19');
  expect(missionCurrentMonday('Not/A_Zone', boundary)).toBe('');
  expect(missionWeekPreview('2026-10-20', 'Europe/Berlin')).toBe('');
  expect(missionWeekPreview('2026-02-30', 'Europe/Berlin')).toBe('');
});

test('weekly creation retains the exact failed draft key and changes it for a changed zone, week or mode', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00.000Z'));
  jest.mocked(crypto.randomUUID).mockReturnValueOnce('00000000-0000-4000-8000-000000000001').mockReturnValueOnce('00000000-0000-4000-8000-000000000002').mockReturnValueOnce('00000000-0000-4000-8000-000000000003').mockReturnValueOnce('00000000-0000-4000-8000-000000000004');
  const request = jest.fn().mockImplementation((_path: string, init?: RequestInit) => init?.method === 'POST'
    ? Promise.reject(new Error('Verbindung unterbrochen.')) : Promise.resolve({ items: [], nextCursor: null }));
  try {
    render(<SpaceMissionIndex spaceId="secret" canManage request={request} onUnavailable={jest.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mission starten' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Thema' }), { target: { value: 'Eine freiwillige Lernwoche' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Aufgabe' }), { target: { value: 'Erklärt eine Idee und denkt gemeinsam weiter.' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Diese Lernwoche' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'IANA-Zeitzone' }), { target: { value: 'UTC' } });
    expect(screen.getByLabelText('Wochenbeginn (Montag)')).toHaveValue('2026-10-12');
    expect(screen.getByText('12. Oktober – 18. Oktober 2026 · UTC')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
    await screen.findByText('Verbindung unterbrochen.');
    await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mission erstellen' })).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: 'IANA-Zeitzone' }), { target: { value: 'Europe/Berlin' } });
    await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(3));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mission erstellen' })).toBeEnabled());
    clock.mockReturnValue(Date.parse('2026-10-19T12:00:00.000Z'));
    fireEvent.change(screen.getByLabelText('Wochenbeginn (Montag)'), { target: { value: '2026-10-19' } });
    await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(4));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mission erstellen' })).toBeEnabled());
    await userEvent.click(screen.getByRole('checkbox', { name: 'Diese Lernwoche' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
    await waitFor(() => expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(5));
    const posted = request.mock.calls.filter(([, init]) => init?.method === 'POST').map(([, init]) => JSON.parse(init.body));
    expect(posted[0]).toEqual({ title: 'Eine freiwillige Lernwoche', prompt: 'Erklärt eine Idee und denkt gemeinsam weiter.', week: { startDate: '2026-10-12', timezone: 'UTC' }, requestId: '00000000-0000-4000-8000-000000000001' });
    expect(posted[1]).toEqual(posted[0]);
    expect(posted[2]).toMatchObject({ week: { startDate: '2026-10-12', timezone: 'Europe/Berlin' }, requestId: '00000000-0000-4000-8000-000000000002' });
    expect(posted[3]).toMatchObject({ week: { startDate: '2026-10-19', timezone: 'Europe/Berlin' }, requestId: '00000000-0000-4000-8000-000000000003' });
    expect(posted[4]).toEqual({ title: posted[0].title, prompt: posted[0].prompt, requestId: '00000000-0000-4000-8000-000000000004' });
  } finally { clock.mockRestore(); }
});

test('an unchanged lost creation response can be replayed after the selected week ends', async () => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T23:59:59.000Z'));
  const push = jest.fn();
  jest.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  let attempts = 0;
  const request = jest.fn().mockImplementation((_path: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return Promise.resolve({ items: [], nextCursor: null });
    return ++attempts === 1 ? Promise.reject(new Error('Antwort verloren.')) : Promise.resolve(mission({ week: { startDate: '2026-10-12', timezone: 'UTC', startsAt: '2026-10-12T00:00:00.000Z', endsAt: '2026-10-19T00:00:00.000Z' }, windowState: 'past' }));
  });
  try {
    render(<SpaceMissionIndex spaceId="secret" canManage request={request} onUnavailable={jest.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mission starten' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Thema' }), { target: { value: 'Ein unveränderter Wochenentwurf' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Aufgabe' }), { target: { value: 'Teilt eine Erklärung und denkt gemeinsam weiter.' } });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Diese Lernwoche' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'IANA-Zeitzone' }), { target: { value: 'UTC' } });
    await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
    await screen.findByText('Antwort verloren.');
    clock.mockReturnValue(Date.parse('2026-10-19T00:00:01.000Z'));
    await act(async () => { fireEvent.focus(window); });
    await waitFor(() => expect(screen.queryByText('Missionen werden geladen…')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Wochenbeginn (Montag)')).not.toHaveAttribute('min');
    await userEvent.click(screen.getByRole('button', { name: 'Mission erstellen' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/community/spaces/secret/missions/mission-1'));
    const posted = request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posted).toHaveLength(2);
    expect(posted[1][1].body).toBe(posted[0][1].body);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  } finally { clock.mockRestore(); }
});

test.each([
  { zone: 'Not/A_Zone', date: '2026-10-12' },
  { zone: 'UTC', date: '2026-10-19' },
  { zone: 'UTC', date: '2026-10-11' },
])('an invalid week draft ($zone, $date) is explained without posting or substituting a timezone', async ({ zone, date }) => {
  const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T12:00:00.000Z'));
  const request = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
  try {
    render(<SpaceMissionIndex spaceId="secret" canManage request={request} onUnavailable={jest.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mission starten' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Diese Lernwoche' }));
    const zoneInput = screen.getByRole('combobox', { name: 'IANA-Zeitzone' });
    fireEvent.change(zoneInput, { target: { value: zone } });
    fireEvent.change(screen.getByLabelText('Wochenbeginn (Montag)'), { target: { value: date } });
    fireEvent.submit(screen.getByRole('button', { name: 'Mission erstellen' }).closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/gültige IANA-Zeitzone und den Montag der dort aktuellen Woche/);
    expect(zoneInput).toHaveValue(zone);
    expect(zoneInput).toHaveAttribute('aria-invalid', 'true');
    expect(zoneInput).toHaveAccessibleDescription(/gültige IANA-Zeitzone/);
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
  } finally { clock.mockRestore(); }
});

test('a past learning week remains open for an ordinary contribution and is not an on-time claim', async () => {
  const current = mission({ week: autumnWeek, windowState: 'past' });
  serveMission(() => current, (path, init) => path === `${base}/contributions` && init?.method === 'POST'
    ? Promise.resolve(json(current, 201)) : undefined);
  render(<SpaceMissionPage />);
  expect(await screen.findByText('Lernwoche vorbei · Mission bleibt offen')).toBeVisible();
  expect(screen.getByText('19. Oktober – 25. Oktober 2026 · Europe/Berlin')).toBeVisible();
  expect(screen.getByText(/sie belegen keine Teilnahme innerhalb der Lernwoche/)).toBeVisible();
  await userEvent.type(screen.getByRole('textbox', { name: 'Deine Erkenntnis' }), 'Ein später Gedanke bleibt Teil des Austauschs.');
  await userEvent.click(screen.getByRole('button', { name: 'Im Space teilen' }));
  expect(await screen.findByText('Dein Beitrag ist im Space sichtbar.')).toBeVisible();
  expect(mutationCalls(`${base}/contributions`, 'POST')).toHaveLength(1);
  expect(JSON.parse(mutationCalls(`${base}/contributions`, 'POST')[0][1]!.body as string)).not.toHaveProperty('week');
});

test('a closed past-week mission does not promise to remain open and preserves existing withdrawal', async () => {
  serveMission(() => mission({ week: autumnWeek, windowState: 'past', closedAt: now, contributions: [ownInsight], ownContributions: [{ id: ownInsight.id, kind: 'INSIGHT', hidden: false, targetUnavailable: false, canWithdraw: true }] }));
  render(<SpaceMissionPage />);
  expect(await screen.findByText('Lernwoche vorbei')).toBeVisible();
  expect(screen.queryByText('Lernwoche vorbei · Mission bleibt offen')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Beitrag zurückziehen' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Teilnahme beenden' })).toBeEnabled();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('focus refresh advances the server window label and a late current-week read cannot overwrite it', async () => {
  let reads = 0;
  let finishOldRead!: (value: JsonResponse) => void;
  global.fetch = jest.fn().mockImplementation((path: string) => {
    if (path === '/api/spaces/secret') return Promise.resolve(json(privateSpace));
    if (path === base) {
      if (++reads === 2) return new Promise(resolve => { finishOldRead = resolve; });
      return Promise.resolve(json(mission({ week: autumnWeek, windowState: reads === 1 ? 'current' : 'past' })));
    }
    throw new Error(`Unexpected ${path}`);
  });
  render(<SpaceMissionPage />);
  expect(await screen.findByText('Diese Lernwoche')).toBeVisible();
  await act(async () => { fireEvent.focus(window); });
  await act(async () => { fireEvent.focus(window); });
  expect(await screen.findByText('Lernwoche vorbei · Mission bleibt offen')).toBeVisible();
  await act(async () => { finishOldRead(json(mission({ week: autumnWeek, windowState: 'current' }))); });
  expect(screen.queryByText('Diese Lernwoche')).not.toBeInTheDocument();
  expect(screen.getByText('Lernwoche vorbei · Mission bleibt offen')).toBeVisible();
});

test('the mission list shows stored weekly dates and an open past-week state without altering self-paced missions', async () => {
  const request = jest.fn().mockResolvedValue({ items: [mission({ week: autumnWeek, windowState: 'past' }), mission({ id: 'legacy', title: 'Zeitlich offener Austausch' })], nextCursor: null });
  render(<SpaceMissionIndex spaceId="secret" canManage request={request} onUnavailable={jest.fn()} />);
  expect(await screen.findByText('Lernwoche vorbei · Mission bleibt offen')).toBeVisible();
  expect(screen.getByText('19. Oktober – 25. Oktober 2026 · Europe/Berlin')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Zeitlich offener Austausch' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Mission starten' })).not.toBeInTheDocument();
});
