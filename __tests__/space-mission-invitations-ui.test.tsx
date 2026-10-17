import '@testing-library/jest-dom';
import React, { type ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import MissionOverviewPage from '@/app/community/missions/page';
import { SpaceMissionDetail } from '@/components/spaces/SpaceMissionDetail';
import { MissionInvitationComposer } from '@/components/spaces/MissionInvitationComposer';
import { MissionInvitationInbox } from '@/components/spaces/MissionInvitationInbox';
import { MissionInvitationDecision } from '@/components/spaces/MissionInvitationDecision';
import { missionNextStep, useInvitationMutation, useInvitationScope } from '@/components/spaces/mission-invitation-ui';
import { spaceJson, SpaceHttpError } from '@/components/spaces/space-api';
import { missionInvitationAcknowledgment, missionInvitationConsent, missionInvitationPreferencePrivacy, type MissionNextAction } from '@/types/space-mission-invitations';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useSearchParams: jest.fn() }));
const mockHandlers = new Map<string, () => void>();
jest.mock('@/components/ui/button', () => ({ Button: function MockButton({ children, variant: _variant, asChild, size: _size, ...props }: ComponentProps<'button'> & { variant?: string; asChild?: boolean; size?: string }) {
  if (typeof children === 'string' && props.onClick) mockHandlers.set(children, () => props.onClick?.({} as React.MouseEvent<HTMLButtonElement>));
  return asChild ? <>{children}</> : <button {...props}>{children}</button>;
} }));
jest.mock('@/components/spaces/SpaceShell', () => ({ SpaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
jest.mock('next/link', () => ({ __esModule: true, default: function MockLink({ prefetch: _prefetch, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) { return <a {...props} />; } }));

const base = '/api/spaces/space/missions/mission';
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
function deferred() { let resolve!: (value: ReturnType<typeof json>) => void; let reject!: (reason: Error) => void; const promise = new Promise<ReturnType<typeof json>>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const selection = { validUntil: '2026-10-17T05:30:00.000Z', nonce: 'nonce-a', token: 'token-a' };
const candidates = { items: [{ user: { id: 'peer', name: 'Mara Peer', image: null }, selection }], senderEpoch: 7, senderAccessEpoch: 3 };
const pending = { id: 'invite', revision: 1, createdAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-24T00:00:00.000Z', mission: { id: 'mission', title: 'Gemeinsam lernen', space: { id: 'space', name: 'Lernraum' } }, sender: { id: 'sender', name: 'Ada Sender', image: null }, canAccept: true, unavailableReason: null };
const mission = { id: 'mission', spaceId: 'space', participation: { active: true, epoch: 1 }, contributions: [], ownContributions: [], myNextAction: { kind: 'SHARE_INSIGHT' } };
let sequence = 0;
let account = '';
const composer = (id = account, spaceId = 'space', missionId = 'mission', participantEpoch = 7) => <MissionInvitationComposer viewerId={id} spaceId={spaceId} missionId={missionId} participantEpoch={participantEpoch} eligible />;
const decision = (onMission = jest.fn(), id = account, spaceId = 'space', missionId = 'mission') => <MissionInvitationDecision viewerId={id} spaceId={spaceId} missionId={missionId} invitationId="invite" onMission={onMission} />;
const mutations = () => jest.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'PUT' || init?.method === 'POST');
async function selectPeer() { await userEvent.type(screen.getByLabelText('Nach Namen suchen'), 'Mara'); await userEvent.click(screen.getByRole('button', { name: 'Person suchen' })); await userEvent.click(await screen.findByRole('radio', { name: 'Mara Peer' })); }
async function openInbox(id = account) { render(<MissionInvitationInbox viewerId={id} role="USER" />); await userEvent.click(screen.getByRole('button', { name: 'Meine Einladungen' })); await screen.findByText('Einladungen sind ausgeschaltet.'); }

beforeEach(() => { account = `account-${++sequence}`; jest.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as ReturnType<typeof useSearchParams>); mockHandlers.clear(); global.fetch = jest.fn(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => `request-${sequence}`) }); });

it('does not search, send, join or write storage on mount/refocus', async () => {
  const local = jest.spyOn(Storage.prototype, 'setItem'); render(composer()); fireEvent.focus(window);
  expect(fetch).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Person suchen' })).toBeDisabled(); local.mockRestore();
});
it('requires explicit 2..80-character search, an existing named different peer and deliberate send; uses only neutral acknowledgment', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockResolvedValueOnce(json({ processed: true, requestId: `request-${sequence}` }) as Response);
  render(composer()); await userEvent.type(screen.getByLabelText('Nach Namen suchen'), 'M'); expect(screen.getByRole('button', { name: 'Person suchen' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('Nach Namen suchen'), 'ara'); await userEvent.click(screen.getByRole('button', { name: 'Person suchen' }));
  expect(await screen.findByRole('radio', { name: 'Mara Peer' })).not.toBeChecked(); expect(mutations()).toHaveLength(0);
  await userEvent.click(screen.getByRole('radio', { name: 'Mara Peer' })); await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' }));
  expect(await screen.findByText(missionInvitationAcknowledgment)).toBeVisible();
  expect(mutations()).toHaveLength(1); expect(JSON.parse(mutations()[0][1]!.body as string)).toEqual({ recipientId: 'peer', senderEpoch: 7, senderAccessEpoch: 3, requestId: `request-${sequence}`, selection });
  expect(screen.queryByText(/zugestellt|angenommen|Empfangsstatus/i)).not.toBeInTheDocument(); expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  expect(jest.mocked(fetch).mock.calls[0]).toEqual([`${base}/invitation-candidates?q=Mara`, expect.objectContaining({ cache: 'no-store' })]);
});
it('invalidates selection as soon as the query changes and excludes self', async () => {
  jest.mocked(fetch).mockResolvedValue(json({ ...candidates, items: [...candidates.items, { ...candidates.items[0], user: { id: account, name: 'Own Name', image: null } }] }) as Response);
  render(composer()); await selectPeer(); expect(screen.queryByRole('radio', { name: 'Own Name' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Nach Namen suchen'), 'a'); expect(screen.queryByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })).not.toBeInTheDocument(); expect(mutations()).toHaveLength(0);
});
it('requires refinement for oversized matches and never submits a guessed recipient', async () => {
  jest.mocked(fetch).mockResolvedValue(json({ ...candidates, items: Array.from({ length: 11 }, (_, index) => ({ ...candidates.items[0], user: { id: `p${index}`, name: 'Mara', image: null } })) }) as Response);
  render(composer()); await userEvent.type(screen.getByLabelText('Nach Namen suchen'), 'Ma'); await userEvent.click(screen.getByRole('button', { name: 'Person suchen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Suche genauer'); expect(screen.queryByRole('radio')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(0);
});
it.each(['network', 'server', 'malformed'])('retains exact unknown send body across refocus/remount after %s failure, retry is explicit and duplicate clicks lock', async failure => {
  jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockImplementationOnce(() => failure === 'network' ? Promise.reject(new Error('offline')) : Promise.resolve(json(failure === 'server' ? { error: 'unknown' } : { processed: false }, failure === 'server' ? 503 : 200) as Response)).mockResolvedValueOnce(json({ processed: true, requestId: `request-${sequence}` }) as Response);
  const view = render(composer()); await selectPeer(); fireEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' }));
  await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' }); const original = mutations()[0][1]!.body;
  fireEvent.focus(window); expect(mutations()).toHaveLength(1); view.unmount(); render(composer());
  const retry = await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' }); expect(screen.queryByText('Mara Peer')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(1);
  fireEvent.click(retry); fireEvent.click(retry); await screen.findByText(missionInvitationAcknowledgment);
  expect(mutations()).toHaveLength(2); expect(mutations()[1][1]!.body).toBe(original); expect(mutations()[1][0]).toBe(mutations()[0][0]);
});
it('retains an in-flight request across same-scope remount and handles its later unknown result without resubmitting', async () => {
  const old = deferred(); jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockReturnValueOnce(old.promise as Promise<Response>);
  const view = render(composer()); await selectPeer(); await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' }));
  view.unmount(); render(composer()); expect(screen.getByRole('button', { name: 'Anfrage wird verarbeitet…' })).toBeDisabled();
  await act(async () => old.reject(new Error('offline'))); expect(await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })).toBeEnabled(); expect(mutations()).toHaveLength(1);
});
it.each(['account', 'space', 'mission', 'epoch'])('suppresses deferred A search data on %s switch on a committed scope transition and drops stale handlers', async change => {
  const old = deferred(); jest.mocked(fetch).mockReturnValue(old.promise as Promise<Response>);
  const view = render(composer()); await userEvent.type(screen.getByLabelText('Nach Namen suchen'), 'Mara'); await userEvent.click(screen.getByRole('button', { name: 'Person suchen' }));
  view.rerender(composer(change === 'account' ? 'B' : account, change === 'space' ? 'B-space' : 'space', change === 'mission' ? 'B-mission' : 'mission', change === 'epoch' ? 9 : 7));
  expect(screen.getByLabelText('Nach Namen suchen')).toHaveValue(''); await act(async () => old.resolve(json(candidates))); expect(screen.queryByText('Mara Peer')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(0);
});
it.each(['account', 'space', 'mission', 'epoch'])('guards captured A send closure and delayed POST after %s switch', async change => {
  const old = deferred(); jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockReturnValueOnce(old.promise as Promise<Response>);
  const view = render(composer()); await selectPeer(); const stale = mockHandlers.get('Einladung an ausgewählte Person anfragen')!;
  await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' }));
  view.rerender(composer(change === 'account' ? 'B' : account, change === 'space' ? 'B-space' : 'space', change === 'mission' ? 'B-mission' : 'mission', change === 'epoch' ? 9 : 7));
  act(() => stale()); expect(mutations()).toHaveLength(1); expect(screen.queryByText('Mara Peer')).not.toBeInTheDocument();
  await act(async () => old.resolve(json({ processed: true, requestId: `request-${sequence}` }))); expect(screen.queryByText(missionInvitationAcknowledgment)).not.toBeInTheDocument(); expect(mutations()).toHaveLength(1);
});
it('never renders the composer for ineligible participation', () => { render(<MissionInvitationComposer viewerId={account} spaceId="space" missionId="mission" participantEpoch={0} eligible={false} />); expect(screen.queryByRole('heading')).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled(); });

it('loads only own consent/inbox after opening, default off, explicit checked consent required', async () => {
  jest.mocked(fetch).mockImplementation((path, init) => Promise.resolve(json(init?.method ? { enabled: true, revision: 1 } : String(path).endsWith('invitation-preference') ? { enabled: false, revision: 0 } : { items: [], nextCursor: null }) as Response));
  render(<MissionInvitationInbox viewerId={account} role="USER" />); expect(fetch).not.toHaveBeenCalled(); await userEvent.click(screen.getByRole('button', { name: 'Meine Einladungen' }));
  await screen.findByText('Einladungen sind ausgeschaltet.'); expect(screen.getByText(missionInvitationPreferencePrivacy)).toBeVisible(); expect(screen.getByRole('button', { name: 'Einladungen einschalten' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Ich möchte Missionseinladungen erhalten.' })); await userEvent.click(screen.getByRole('button', { name: 'Einladungen einschalten' }));
  await screen.findByText('Du erhältst jetzt Missionseinladungen.'); expect(JSON.parse(mutations()[0][1]!.body as string)).toEqual({ enabled: true, expectedRevision: 0 });
});
it.each([false, true])('unknown preference change from %s keeps prior visible consent, blocks opposite change and retries exact revision across remount/refocus', async wasEnabled => {
  let puts = 0; jest.mocked(fetch).mockImplementation((path, init) => {
    if (init?.method === 'PUT') { ++puts; return puts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(json({ enabled: !wasEnabled, revision: 8 }) as Response); }
    return Promise.resolve(json(String(path).endsWith('invitation-preference') ? { enabled: wasEnabled, revision: 7 } : { items: [], nextCursor: null }) as Response);
  });
  const view = render(<MissionInvitationInbox viewerId={account} role="USER" />); await userEvent.click(screen.getByRole('button', { name: 'Meine Einladungen' })); await screen.findByText(wasEnabled ? 'Einladungen sind eingeschaltet.' : 'Einladungen sind ausgeschaltet.');
  if (!wasEnabled) await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: wasEnabled ? 'Einladungen ausschalten' : 'Einladungen einschalten' }));
  await screen.findByRole('button', { name: 'Dieselbe Einstellung erneut prüfen' }); const body = mutations()[0][1]!.body;
  expect(screen.getByText(wasEnabled ? 'Einladungen sind eingeschaltet.' : 'Einladungen sind ausgeschaltet.')).toBeVisible(); fireEvent.focus(window); await waitFor(() => expect(fetch).toHaveBeenCalled()); expect(mutations()).toHaveLength(1);
  view.unmount(); render(<MissionInvitationInbox viewerId={account} role="USER" />); await userEvent.click(screen.getByRole('button', { name: 'Meine Einladungen' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Dieselbe Einstellung erneut prüfen' })); await screen.findByText(wasEnabled ? 'Missionseinladungen sind ausgeschaltet.' : 'Du erhältst jetzt Missionseinladungen.'); expect(mutations()[1][1]!.body).toBe(body);
});
it('shows only own pending links without reception receipts and full has no reservation', async () => {
  jest.mocked(fetch).mockImplementation(path => Promise.resolve(json(String(path).endsWith('invitation-preference') ? { enabled: false, revision: 0 } : { items: [{ ...pending, canAccept: false, unavailableReason: 'FULL' }], nextCursor: null }) as Response));
  await openInbox(); expect(screen.getByRole('link', { name: 'Gemeinsam lernen' })).toHaveAttribute('href', '/community/spaces/space/missions/mission?invitation=invite#mission-invitation'); expect(screen.getByText(/Alle fünf Plätze sind belegt/)).toBeVisible(); expect(mutations()).toHaveLength(0);
});
it('suppresses deferred own inbox/preference and stale toggle after account switch', async () => {
  const old = deferred(); let gets = 0; jest.mocked(fetch).mockImplementation(path => ++gets <= 2 ? old.promise as Promise<Response> : Promise.resolve(json(String(path).endsWith('invitation-preference') ? { enabled: false, revision: 0 } : { items: [], nextCursor: null }) as Response));
  const view = render(<MissionInvitationInbox viewerId={account} role="USER" />); await userEvent.click(screen.getByRole('button', { name: 'Meine Einladungen' }));
  view.rerender(<MissionInvitationInbox viewerId="B" role="USER" />); await act(async () => old.resolve(json({ items: [pending], nextCursor: null })));
  expect(screen.queryByText('Ada Sender')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: 'Gemeinsam lernen' })).not.toBeInTheDocument(); expect(mutations()).toHaveLength(0);
});
it('does not offer receiving controls to an administrator', () => { render(<MissionInvitationInbox viewerId={account} role="ADMIN" />); expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled(); });

it('requires full recipient consent, sends own revision and applies the existing unwrapped mission response', async () => {
  const onMission = jest.fn(); jest.mocked(fetch).mockResolvedValueOnce(json({ state: 'PENDING', invitation: pending }) as Response).mockResolvedValueOnce(json({ invitation: { id: 'invite', state: 'ACCEPTED', revision: 2 }, mission }) as Response);
  render(decision(onMission)); await screen.findByText(missionInvitationConsent); expect(screen.getByRole('button', { name: 'Einladung annehmen' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: 'Ich möchte freiwillig an dieser Mission teilnehmen.' })); await userEvent.click(screen.getByRole('button', { name: 'Einladung annehmen' }));
  await screen.findByText(/Du hast die Einladung angenommen/); expect(onMission).toHaveBeenCalledWith(mission); expect(mutations()[0][0]).toBe(`${base}/invitations/invite/decision`); expect(JSON.parse(mutations()[0][1]!.body as string)).toEqual({ decision: 'ACCEPT', expectedRevision: 1 });
});
it('full invitation disables consent/accept, still allows decline; closed/unavailable is quiet', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(json({ state: 'PENDING', invitation: { ...pending, canAccept: false, unavailableReason: 'FULL' } }) as Response).mockResolvedValueOnce(json({ invitation: { id: 'invite', state: 'DECLINED', revision: 2 }, mission }) as Response);
  render(decision()); expect(await screen.findByRole('checkbox')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Einladung annehmen' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Einladung ablehnen' })); expect(await screen.findByText('Du hast die Einladung abgelehnt.')).toBeVisible(); expect(JSON.parse(mutations()[0][1]!.body as string).decision).toBe('DECLINE');
});
it.each(['UNAVAILABLE', 'ACCEPTED', 'DECLINED'])('renders %s with no sender identity or new mutation', async state => {
  jest.mocked(fetch).mockResolvedValue(json({ state, invitation: state === 'UNAVAILABLE' ? null : { id: 'invite', state, revision: 2 } }) as Response); render(decision()); await screen.findByRole('heading', { name: 'Deine Einladung' }); await waitFor(() => expect(screen.queryByText('Einladung wird geprüft…')).not.toBeInTheDocument()); expect(screen.queryByText(/Ada Sender/)).not.toBeInTheDocument(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(0);
});
it.each(['ACCEPT', 'DECLINE'])('retries the exact unknown %s decision after remount/refocus without opposite action or automatic POST', async choice => {
  let posts = 0; jest.mocked(fetch).mockImplementation((_path, init) => { if (init?.method === 'POST') return ++posts === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(json({ invitation: { id: 'invite', state: choice === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED', revision: 2 }, mission }) as Response); return Promise.resolve(json({ state: 'PENDING', invitation: pending }) as Response); });
  const view = render(decision()); await screen.findByRole('checkbox'); if (choice === 'ACCEPT') await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: choice === 'ACCEPT' ? 'Einladung annehmen' : 'Einladung ablehnen' }));
  await screen.findByRole('button', { name: 'Dieselbe Entscheidung erneut prüfen' }); const body = mutations()[0][1]!.body; fireEvent.focus(window); view.unmount(); render(decision());
  expect(mutations()).toHaveLength(1); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); await userEvent.click(await screen.findByRole('button', { name: 'Dieselbe Entscheidung erneut prüfen' })); await waitFor(() => expect(mutations()).toHaveLength(2)); expect(mutations()[1][1]!.body).toBe(body);
});
it.each(['account', 'space', 'mission'])('prevents delayed decision GET/POST and captured A decision closure from changing %s B', async change => {
  const old = deferred(); const onMission = jest.fn(); jest.mocked(fetch).mockResolvedValueOnce(json({ state: 'PENDING', invitation: pending }) as Response).mockReturnValueOnce(old.promise as Promise<Response>).mockResolvedValueOnce(json({ state: 'UNAVAILABLE', invitation: null }) as Response);
  const view = render(decision(onMission)); await screen.findByRole('checkbox'); await userEvent.click(screen.getByRole('checkbox')); const stale = mockHandlers.get('Einladung annehmen')!; await userEvent.click(screen.getByRole('button', { name: 'Einladung annehmen' }));
  view.rerender(decision(onMission, change === 'account' ? 'B' : account, change === 'space' ? 'B-space' : 'space', change === 'mission' ? 'B-mission' : 'mission'));
  act(() => stale()); await act(async () => old.resolve(json({ invitation: { id: 'invite', state: 'ACCEPTED', revision: 2 }, mission }))); expect(onMission).not.toHaveBeenCalled(); expect(screen.queryByText(/Ada Sender/)).not.toBeInTheDocument(); expect(mutations()).toHaveLength(1);
});
it('preserves focus on unrelated controls when asynchronous decision/refocus reads complete', async () => {
  const old = deferred(); jest.mocked(fetch).mockReturnValue(old.promise as Promise<Response>); render(<><button>Andere Aufgabe</button>{decision()}</>); const outside = screen.getByRole('button', { name: 'Andere Aufgabe' }); outside.focus(); await act(async () => old.resolve(json({ state: 'PENDING', invitation: pending }))); expect(outside).toHaveFocus(); fireEvent.focus(window); await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(outside).toHaveFocus();
});
it.each([
  [{ kind: 'CLOSED' }, null], [{ kind: 'CURRENT_GOAL_REACHED' }, '#mission-contributions'], [{ kind: 'SHARE_INSIGHT' }, '#mission-contributions-composer'], [{ kind: 'REVIEW_BUILD_ON', contributionId: 'own' }, '#mission-own-contribution-own'], [{ kind: 'BUILD_ON', targetContributionId: 'peer' }, '#mission-contribution-peer'], [{ kind: 'LIMIT_REACHED' }, '#mission-contributions'], [{ kind: 'WAIT_FOR_PEER' }, '#mission-contributions'],
] as [MissionNextAction, string | null][])('maps existing meaningful %s action to a stable task target', (action, href) => { expect(missionNextStep(action).href).toBe(href); expect(missionNextStep(action).text.length).toBeGreaterThan(10); });
it('preserves optional stable API error code and all responses are no-store', async () => {
  jest.mocked(fetch).mockResolvedValue(json({ error: 'full', code: 'MISSION_FULL' }, 409) as Response); await expect(spaceJson('/private')).rejects.toEqual(new SpaceHttpError(409, 'full', 'MISSION_FULL')); expect(fetch).toHaveBeenCalledWith('/private', { cache: 'no-store' });
});

it('scope lease suppresses private state on a committed scope transition and retained handlers cannot submit A data under B', async () => {
  let old!: () => Promise<unknown>;
  const valid = (value: unknown): value is { ok: boolean } => Boolean(value && typeof value === 'object');
  function Harness({ id }: { id: string }) { const scope = useInvitationScope(id, 'scope'); const mutation = useInvitationMutation(scope.identity, scope.isCurrent, 'test'); const invoke = () => mutation.execute('/private', 'POST', { recipient: id }, valid); if (id === account) old = invoke; return <button onClick={() => void invoke()}>Act {id}</button>; }
  jest.mocked(fetch).mockResolvedValue(json({ ok: true }) as Response); const view = render(<Harness id={account} />); view.rerender(<Harness id="B" />); await act(async () => { await old(); }); expect(mutations()).toHaveLength(0);
});


it('acceptance inside the existing detail renders the real next task and contribution composer without async focus theft', async () => {
  const original = { ...mission, title: 'Gemeinsam lernen', prompt: 'Eine wichtige Verbindung erklären.', creator: null, createdAt: '2026-10-17T00:00:00.000Z', closedAt: null, week: null, windowState: 'self-paced', ownBookmark: null, participants: [], participantLimit: 5, canManage: false, canJoin: true, participation: { active: false, epoch: 0, joinedAt: null, optedOutAt: null }, progress: { insightAuthors: 0, hasCrossPersonBuildOn: false, complete: false }, myNextAction: null };
  const accepted = { ...original, participation: { active: true, epoch: 1, joinedAt: '2026-10-17T00:00:00.000Z', optedOutAt: null }, canJoin: false, myNextAction: { kind: 'SHARE_INSIGHT' } };
  jest.mocked(fetch).mockImplementation((path, init) => Promise.resolve(json(String(path).endsWith('/decision') && init?.method === 'POST' ? { invitation: { id: 'invite', state: 'ACCEPTED', revision: 2 }, mission: accepted } : path === '/api/spaces/space' ? { id: 'space', name: 'Lernraum', visibility: 'PRIVATE', isMember: true, canWrite: true } : path === base ? original : { state: 'PENDING', invitation: pending }) as Response));
  render(<><button>Andere Aufgabe</button><SpaceMissionDetail viewerId={account} spaceId="space" missionId="mission" invitationId="invite" /></>);
  await screen.findByRole('checkbox', { name: 'Ich möchte freiwillig an dieser Mission teilnehmen.' }); await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: 'Einladung annehmen' }));
  const target = await screen.findByRole('heading', { name: 'Dein nächster Schritt' }); expect(target).toHaveAttribute('id', 'mission-next-action'); expect(screen.getByRole('link', { name: 'Teile eine eigene Erkenntnis.' })).toHaveAttribute('href', '#mission-contributions-composer'); expect(screen.getByRole('heading', { name: 'Dein Beitrag' })).toHaveAttribute('id', 'mission-contributions-composer'); expect(screen.getByLabelText('Deine Erkenntnis')).toBeVisible(); expect(target).not.toHaveFocus(); expect(mutations()).toHaveLength(1);
});


it('A→B→A requires a fresh authorized search and ignores the first A response and captured handler', async () => {
  const old = deferred(); jest.mocked(fetch).mockReturnValueOnce(old.promise as Promise<Response>).mockResolvedValueOnce(json({ ...candidates, items: [] }) as Response);
  const view = render(composer()); await userEvent.type(screen.getByLabelText('Nach Namen suchen'), 'Mara'); await userEvent.click(screen.getByRole('button', { name: 'Person suchen' })); view.rerender(composer('B')); view.rerender(composer());
  expect(screen.getByLabelText('Nach Namen suchen')).toHaveValue(''); await act(async () => old.resolve(json(candidates))); expect(screen.queryByText('Mara Peer')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(0);
  await userEvent.type(screen.getByLabelText('Nach Namen suchen'), 'Mara'); await userEvent.click(screen.getByRole('button', { name: 'Person suchen' })); await screen.findByText('Keine passende Person gefunden. Verfeinere den Namen.'); expect(fetch).toHaveBeenCalledTimes(2);
});
it('A→B→A discards an unknown A send lease and never revives its selection or retry', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockRejectedValueOnce(new Error('offline'));
  const view = render(composer()); await selectPeer(); const stale = mockHandlers.get('Einladung an ausgewählte Person anfragen')!; await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })); await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' });
  view.rerender(composer('B')); view.rerender(composer()); act(() => stale()); expect(screen.queryByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })).not.toBeInTheDocument(); expect(screen.queryByText('Mara Peer')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(1);
});
it('known terminal send response clears unresolved body and requires a new explicit search', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockResolvedValueOnce(json({ error: 'stale' }, 409) as Response); const view = render(composer()); await selectPeer(); await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })); await screen.findByRole('alert'); view.unmount(); render(composer()); expect(screen.queryByRole('button', { name: /Dieselbe/ })).not.toBeInTheDocument(); expect(mutations()).toHaveLength(1);
});
it('mismatched success acknowledgement is unknown and exact retry stays available', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockResolvedValueOnce(json({ processed: true, requestId: 'different-request' }) as Response); render(composer()); await selectPeer(); await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })); expect(await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })).toBeEnabled(); expect(screen.queryByText(missionInvitationAcknowledgment)).not.toBeInTheDocument();
});
it('guards captured preference toggle and a late PUT from account A after B takes over', async () => {
  const old = deferred(); jest.mocked(fetch).mockImplementation((path, init) => init?.method === 'PUT' ? old.promise as Promise<Response> : Promise.resolve(json(String(path).endsWith('invitation-preference') ? { enabled: false, revision: 0 } : { items: [], nextCursor: null }) as Response));
  const view = render(<MissionInvitationInbox viewerId={account} role="USER" />); await userEvent.click(screen.getByRole('button', { name: 'Meine Einladungen' })); await screen.findByText('Einladungen sind ausgeschaltet.'); await userEvent.click(screen.getByRole('checkbox')); const stale = mockHandlers.get('Einladungen einschalten')!; await userEvent.click(screen.getByRole('button', { name: 'Einladungen einschalten' })); view.rerender(<MissionInvitationInbox viewerId="B" role="USER" />); act(() => stale()); await act(async () => old.resolve(json({ enabled: true, revision: 1 }))); expect(mutations()).toHaveLength(1); expect(screen.queryByText('Du erhältst jetzt Missionseinladungen.')).not.toBeInTheDocument(); expect(await screen.findByText('Einladungen sind ausgeschaltet.')).toBeVisible();
});
it('a fresh document module has no unresolved writes and mount/refocus cannot restore an old body', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockRejectedValueOnce(new Error('offline')); const view = render(composer()); await selectPeer(); await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })); await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' }); view.unmount();
  let FreshComposer!: typeof MissionInvitationComposer;
  jest.isolateModules(() => { jest.doMock('react', () => React); FreshComposer = require('@/components/spaces/MissionInvitationComposer').MissionInvitationComposer; });
  render(<FreshComposer viewerId={account} spaceId="space" missionId="mission" participantEpoch={7} eligible />); fireEvent.focus(window); expect(screen.queryByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })).not.toBeInTheDocument(); expect(mutations()).toHaveLength(1);
});

it.each(['MISSION_FULL', 'MISSION_CLOSED', 'UNAVAILABLE'])('settled acceptance race %s removes stale accept authority and never autojoins', async code => {
  jest.mocked(fetch).mockResolvedValueOnce(json({ state: 'PENDING', invitation: pending }) as Response).mockResolvedValueOnce(json({ error: 'changed', code }, code === 'UNAVAILABLE' ? 404 : 409) as Response);
  render(decision()); await screen.findByRole('checkbox'); await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: 'Einladung annehmen' })); await screen.findByRole('alert');
  if (code === 'MISSION_FULL') { expect(screen.getByRole('checkbox')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Einladung ablehnen' })).toBeEnabled(); }
  else { expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(screen.queryByText(/Ada Sender/)).not.toBeInTheDocument(); }
  expect(mutations()).toHaveLength(1);
});


it('never TTL-evicts an unresolved send or preference and fails safely at bounded memory capacity', async () => {
  let putCount = 0;
  jest.mocked(fetch).mockImplementation((path, init) => {
    if (init?.method === 'PUT') { ++putCount; return Promise.reject(new Error('offline')); }
    if (init?.method === 'POST') return Promise.reject(new Error('offline'));
    return Promise.resolve(json(String(path).includes('invitation-candidates') ? candidates : String(path).endsWith('invitation-preference') ? { enabled: false, revision: 17 } : { items: [], nextCursor: null }) as Response);
  });
  const first = render(composer()); await selectPeer(); await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })); await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' }); const sendBody = mutations()[0][1]!.body;
  const second = render(<MissionInvitationInbox viewerId={account} role="USER" />); await userEvent.click(screen.getByRole('button', { name: 'Meine Einladungen' })); await screen.findByText('Einladungen sind ausgeschaltet.'); await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button', { name: 'Einladungen einschalten' })); await screen.findByRole('button', { name: 'Dieselbe Einstellung erneut prüfen' }); const prefBody = mutations()[1][1]!.body;
  let pressure!: () => Promise<void>;
  const valid = (value: unknown): value is { ok: boolean } => Boolean(value);
  const pressureActions: (() => Promise<unknown>)[] = [];
  function PressureAction({ index }: { index: number }) { const scope = useInvitationScope(account, 'pressure'); const action = useInvitationMutation(scope.identity, scope.isCurrent, `pressure-${index}`); pressureActions[index] = () => action.execute('/private-pressure', 'POST', { index }, valid); return null; }
  function Pressure() { pressure = async () => { for (const action of pressureActions) { try { await action(); } catch { /* Each unresolved request remains leased. */ } } }; return <>{Array.from({ length: 31 }, (_, index) => <PressureAction key={index} index={index} />)}</>; }
  const pressureView = render(<Pressure />); await act(async () => { await pressure(); });
  // 2 integrated unresolved actions plus30 pressure actions occupy32 slots.
  expect(mutations()).toHaveLength(32); expect(putCount).toBe(1);
  const advanced = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
  first.unmount(); second.unmount(); render(composer()); render(<MissionInvitationInbox viewerId={account} role="USER" />); await userEvent.click(screen.getByRole('button', { name: 'Meine Einladungen' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })); await userEvent.click(await screen.findByRole('button', { name: 'Dieselbe Einstellung erneut prüfen' }));
  expect(mutations()).toHaveLength(34); expect(mutations()[32][1]!.body).toBe(sendBody); expect(mutations()[33][1]!.body).toBe(prefBody); expect(screen.getByText('Einladungen sind ausgeschaltet.')).toBeVisible(); advanced.mockRestore(); pressureView.unmount();
});


it.each(['space', 'mission', 'epoch'])('same-account %s A→B→A suppresses private projection and old handlers while exact unknown A retry remains explicit', async change => {
  jest.mocked(fetch).mockResolvedValueOnce(json(candidates) as Response).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(json({ processed: true, requestId: `request-${sequence}` }) as Response); const view = render(composer()); await selectPeer(); const stale = mockHandlers.get('Einladung an ausgewählte Person anfragen')!; await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })); await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' }); const body = mutations()[0][1]!.body;
  view.rerender(composer(account, change === 'space' ? 'B-space' : 'space', change === 'mission' ? 'B-mission' : 'mission', change === 'epoch' ? 9 : 7)); expect(screen.queryByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })).not.toBeInTheDocument(); view.rerender(composer()); act(() => stale()); expect(screen.queryByText('Mara Peer')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(1); await userEvent.click(await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })); await screen.findByText(missionInvitationAcknowledgment); expect(mutations()[1][1]!.body).toBe(body);
});


it('actual closed-inbox overview account B clears A unresolved memory even without B opening invitation controls', async () => {
  jest.mocked(fetch).mockImplementation((path, init) => init?.method === 'POST' ? Promise.reject(new Error('offline')) : Promise.resolve(json(String(path).includes('invitation-candidates') ? candidates : { items: [], nextCursor: null }) as Response));
  const a = render(composer()); await selectPeer(); await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })); await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' }); a.unmount();
  const session = (id: string) => jest.mocked(useSession).mockReturnValue({ data: { user: { id, role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>);
  session('B'); const b = render(<MissionOverviewPage />); expect(screen.getByRole('button', { name: 'Meine Einladungen' })).toHaveAttribute('aria-expanded', 'false'); await screen.findByRole('heading', { name: 'Keine offenen Missionen' }); expect(jest.mocked(fetch).mock.calls.filter(([path]) => String(path).includes('invitation-preference'))).toHaveLength(0);
  session(account); b.rerender(<MissionOverviewPage />); b.unmount(); render(composer()); expect(screen.queryByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })).not.toBeInTheDocument(); expect(screen.queryByText('Mara Peer')).not.toBeInTheDocument(); expect(mutations()).toHaveLength(1);
});

it('transient session loading on the actual overview preserves the same-account exact unknown request without writing', async () => {
  jest.mocked(fetch).mockImplementation((path, init) => init?.method === 'POST' ? Promise.reject(new Error('offline')) : Promise.resolve(json(String(path).includes('invitation-candidates') ? candidates : { items: [], nextCursor: null }) as Response));
  const a = render(composer()); await selectPeer(); await userEvent.click(screen.getByRole('button', { name: 'Einladung an ausgewählte Person anfragen' })); await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' }); const body = mutations()[0][1]!.body; a.unmount();
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'loading', update: jest.fn() }); const overview = render(<MissionOverviewPage />); await screen.findByRole('heading', { name: 'Space-Missionen werden geladen' });
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: account, role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>); overview.rerender(<MissionOverviewPage />); await screen.findByRole('button', { name: 'Meine Einladungen' }); overview.unmount(); render(composer()); expect(await screen.findByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })).toBeEnabled(); expect(mutations()).toHaveLength(1); await userEvent.click(screen.getByRole('button', { name: 'Dieselbe Einladungsanfrage erneut prüfen' })); await waitFor(() => expect(mutations()).toHaveLength(2)); expect(mutations()[1][1]!.body).toBe(body);
});
