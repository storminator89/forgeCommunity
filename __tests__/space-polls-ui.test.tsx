import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpacePolls } from '@/components/spaces/SpacePolls';
import { SpaceHttpError } from '@/components/spaces/space-api';
import type { PollRequest, SpacePoll } from '@/components/spaces/poll-api';

const base = '/api/spaces/secret/polls';
const poll = (overrides: Partial<SpacePoll> = {}): SpacePoll => ({
  id: 'poll-1', spaceId: 'secret', question: 'Welches Thema besprechen wir?', createdAt: '2026-10-16T00:00:00.000Z',
  closedAt: null, hiddenAt: null, moderationRevision: 0, options: [{ id: 'one', label: 'Zugänglichkeit', votes: 2 }, { id: 'two', label: 'Testen', votes: 1 }],
  totalVotes: 3, ownVote: { optionId: null, revision: 0 }, canVote: true, canManage: false, ...overrides,
});
const page = (items = [poll()], nextCursor: string | null = null) => ({ items, nextCursor });
const setup = (handler: (path: string, init?: RequestInit) => Promise<unknown>, canManage = false) => {
  const request = jest.fn(handler); const unavailable = jest.fn();
  render(<SpacePolls spaceId="secret" canManage={canManage} request={request as PollRequest} onUnavailable={unavailable} />);
  return { request, unavailable };
};
const mutationCalls = (request: jest.Mock) => request.mock.calls.filter(([, init]) => init?.method);
beforeEach(() => { jest.clearAllMocks(); let n = 0; Object.defineProperty(global.crypto, 'randomUUID', { configurable: true, value: jest.fn(() => `request-${++n}`) }); });

test('discloses voluntary voting and inference risk, renders aggregate counts and native grouped choices', async () => {
  setup(async () => page());
  expect(await screen.findByRole('heading', { name: poll().question })).toBeVisible();
  expect(screen.getByText(/In kleinen Gruppen können Antworten erkennbar sein/)).toBeVisible();
  expect(screen.getByText(/Keine sensiblen Fragen/)).toBeVisible();
  expect(screen.getByRole('group', { name: `Deine Auswahl zu: ${poll().question}` })).toBeVisible();
  expect(screen.getAllByRole('radio')).toHaveLength(2);
  expect(screen.getByRole('button', { name: 'Abstimmen' })).toBeDisabled();
  expect(screen.getByText('3 Stimmen insgesamt')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Umfrage erstellen' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Rangliste|Belohnung|XP|Zertifikat/i)).not.toBeInTheDocument();
});

test('keyboard vote locks repeated submissions and reloads fresh projection instead of trusting mutation payload', async () => {
  let current = poll(); let finish!: (value: unknown) => void;
  const { request } = setup(async (_path, init) => init?.method === 'PUT' ? new Promise(resolve => { finish = resolve; }) : page([current]));
  const choice = await screen.findByRole('radio', { name: /Zugänglichkeit/ }); choice.focus();
  await userEvent.keyboard(' ');
  const button = screen.getByRole('button', { name: 'Abstimmen' }); button.focus(); await userEvent.keyboard('{Enter}');
  expect(mutationCalls(request)).toHaveLength(1);
  expect(JSON.parse(mutationCalls(request)[0][1].body)).toEqual({ optionId: 'one', expectedRevision: 0, requestId: 'request-1' });
  fireEvent.submit(button.closest('form')!); expect(mutationCalls(request)).toHaveLength(1);
  current = poll({ ownVote: { optionId: 'one', revision: 1 }, totalVotes: 4 });
  await act(async () => finish(poll({ question: 'Stale mutation body' })));
  expect(await screen.findByText('Deine gespeicherte Auswahl')).toBeVisible();
  expect(screen.queryByText('Stale mutation body')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Auswahl ändern' })).toBeDisabled();
});

test('uncertain vote retries reuse request ID and revision; changed selection gets a new ID', async () => {
  const { request } = setup(async (_path, init) => { if (init?.method) throw new Error('Offline'); return page(); });
  await userEvent.click(await screen.findByRole('radio', { name: /Zugänglichkeit/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
  await waitFor(() => expect(mutationCalls(request)).toHaveLength(2));
  expect(JSON.parse(mutationCalls(request)[0][1].body)).toEqual(JSON.parse(mutationCalls(request)[1][1].body));
  await userEvent.click(screen.getByRole('radio', { name: /Testen/ })); await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
  expect(JSON.parse(mutationCalls(request)[2][1].body)).toMatchObject({ optionId: 'two', expectedRevision: 0, requestId: 'request-2' });
});

test('admin creation supports bounded options, keyboard Escape/cancel focus and clean reopen', async () => {
  const { request } = setup(async () => page([]), true);
  await screen.findByText(/Noch keine Umfragen/);
  const open = screen.getByRole('button', { name: 'Umfrage erstellen' }); await userEvent.click(open);
  expect(screen.getByRole('textbox', { name: 'Frage' })).toHaveFocus();
  await userEvent.type(screen.getByRole('textbox', { name: 'Frage' }), 'Welche Aufgabe folgt?');
  await userEvent.type(screen.getByRole('textbox', { name: 'Antwort 1' }), 'Planen');
  await userEvent.type(screen.getByRole('textbox', { name: 'Antwort 2' }), 'Umsetzen');
  for (let i = 0; i < 6; i++) await userEvent.click(screen.getByRole('button', { name: 'Antwort hinzufügen' }));
  expect(screen.getByRole('button', { name: 'Antwort hinzufügen' })).toBeDisabled(); expect(screen.getAllByRole('textbox')).toHaveLength(9);
  await userEvent.keyboard('{Escape}'); expect(open).toHaveFocus();
  await userEvent.click(open); expect(screen.getByRole('textbox', { name: 'Frage' })).toHaveValue(''); expect(screen.getAllByRole('textbox')).toHaveLength(3);
  await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' })); expect(open).toHaveFocus(); expect(mutationCalls(request)).toHaveLength(0);
});

test('creation sends only question/options/request ID and keeps ID across offline retries', async () => {
  const { request } = setup(async (_path, init) => { if (init?.method === 'POST') throw new Error('Offline create'); return page([]); }, true);
  await userEvent.click(screen.getByRole('button', { name: 'Umfrage erstellen' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Frage' }), 'Welche Aufgabe folgt?');
  await userEvent.type(screen.getByRole('textbox', { name: 'Antwort 1' }), 'Planen');
  await userEvent.type(screen.getByRole('textbox', { name: 'Antwort 2' }), 'Umsetzen');
  await userEvent.click(screen.getByRole('button', { name: 'Umfrage veröffentlichen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline create');
  await userEvent.click(screen.getByRole('button', { name: 'Umfrage veröffentlichen' }));
  expect(mutationCalls(request)).toHaveLength(2);
  const one = JSON.parse(mutationCalls(request)[0][1].body); expect(one).toEqual({ question: 'Welche Aufgabe folgt?', options: ['Planen', 'Umsetzen'], requestId: 'request-1' });
  expect(JSON.parse(mutationCalls(request)[1][1].body)).toEqual(one);
});

test('closed/read-only polls show counts and stored choice without enabled voting controls', async () => {
  setup(async () => page([poll({ closedAt: '2026-10-16T01:00:00.000Z', canVote: false, ownVote: { optionId: 'two', revision: 3 } })]));
  expect(await screen.findByRole('radio', { name: /Testen/ })).toBeChecked();
  expect(screen.getAllByRole('radio').every(radio => radio.matches(':disabled'))).toBe(true);
  expect(screen.queryByRole('button', { name: 'Abstimmen' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Tritt dem Space bei/)).not.toBeInTheDocument();
});

test('admin close/hide sends monotonic close or current moderation revision', async () => {
  let current = poll({ canManage: true });
  const { request } = setup(async (_path, init) => {
    if (init?.method === 'PATCH') { const data = JSON.parse(init.body as string); current = data.closed ? { ...current, closedAt: '2026-10-16T01:00:00Z', canVote: false } : { ...current, hiddenAt: '2026-10-16T01:00:00Z', moderationRevision: 1 }; return current; }
    return page([current]);
  }, true);
  await userEvent.click(await screen.findByText('Umfrage verwalten'));
  await userEvent.click(screen.getByRole('button', { name: 'Umfrage schließen' }));
  await screen.findByRole('heading', { name: poll().question });
  expect(JSON.parse(mutationCalls(request)[0][1].body)).toEqual({ closed: true });
  await userEvent.click(screen.getByText('Umfrage verwalten'));
  await userEvent.click(screen.getByRole('button', { name: 'Umfrage ausblenden' }));
  expect(JSON.parse(mutationCalls(request)[1][1].body)).toEqual({ hidden: true, expectedRevision: 0 });
  await screen.findByRole('heading', { name: poll().question });
  await userEvent.click(screen.getByText('Umfrage verwalten'));
  expect(screen.getByRole('button', { name: 'Umfrage einblenden' })).toBeVisible();
});

test('focus revalidation clears content and ignores stale pagination even if transport ignores abort', async () => {
  let finish!: (value: unknown) => void; let reads = 0;
  setup(async (path) => path.includes('?cursor=') ? new Promise(resolve => { finish = resolve; }) : ++reads === 1 ? page([poll()], 'next') : page([]));
  await screen.findByRole('heading', { name: poll().question });
  await userEvent.click(screen.getByRole('button', { name: 'Weitere Umfragen laden' }));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(await screen.findByText(/Noch keine Umfragen/)).toBeVisible();
  await act(async () => finish(page([poll({ id: 'late', question: 'A hidden late question' })])));
  expect(screen.queryByText('A hidden late question')).not.toBeInTheDocument();
});

test('revoked access clears poll text before notifying parent, and stale mutation cannot repopulate it', async () => {
  let reads = 0; let finish!: (value: unknown) => void;
  const { unavailable } = setup(async (_path, init) => {
    if (init?.method) return new Promise(resolve => { finish = resolve; });
    if (++reads === 1) return page(); throw new SpaceHttpError(404, 'Unavailable');
  });
  await userEvent.click(await screen.findByRole('radio', { name: /Testen/ })); await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await waitFor(() => expect(unavailable).toHaveBeenCalled());
  expect(screen.queryByText(poll().question)).not.toBeInTheDocument();
  await act(async () => finish(poll())); expect(screen.queryByText(poll().question)).not.toBeInTheDocument();
});


test('visual choices expose honest percentages, counts and a non-color choice cue before saving', async () => {
  setup(async () => page());
  const first = await screen.findByRole('radio', { name: /Zugänglichkeit/ });
  expect(screen.getByText('67%')).toBeVisible();
  expect(screen.getByText('33%')).toBeVisible();
  const label = first.closest('label')!;
  expect(label.querySelector('[aria-hidden="true"] svg')).toBeNull();
  await userEvent.click(first);
  expect(first).toBeChecked();
  expect(label.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  expect(screen.queryByText('Deine gespeicherte Auswahl')).not.toBeInTheDocument();
  expect(screen.getByText(/In kleinen Gruppen/)).toBeVisible();
  await userEvent.click(screen.getByText('So wird gezählt'));
  expect(screen.getByText(/Angezeigt werden nur Summen und deine eigene Auswahl/)).toBeVisible();
});

test('an empty result shows zero percentages and reduced-motion disables optional animation controls', async () => {
  setup(async () => page([poll({ totalVotes: 0, options: poll().options.map(option => ({ ...option, votes: 0 })) })]));
  await screen.findByRole('heading', { name: poll().question });
  expect(screen.getAllByText('0%')).toHaveLength(2);
  expect(screen.getByText('0 Stimmen insgesamt')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Animationen durch Systemeinstellung ausgeschaltet' })).toBeDisabled();
  expect(document.querySelector('[data-confirmed]')).toBeNull();
});


test.each([false, true])('vote refresh restores a useful checked choice without stealing moved focus (%s)', async moved => {
  let reads = 0;
  let finish!: (value: unknown) => void;
  const saved = poll({ ownVote: { optionId: 'two', revision: 1 }, totalVotes: 4 });
  const request = jest.fn(async (_path: string, init?: RequestInit) => {
    if (init?.method) return saved;
    if (++reads === 1) return page();
    return new Promise(resolve => { finish = resolve; });
  });
  render(<><SpacePolls spaceId="secret" canManage={false} request={request as PollRequest} onUnavailable={jest.fn()} /><button>Andere Aktion</button></>);
  await userEvent.click(await screen.findByRole('radio', { name: /Testen/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Abstimmen' }));
  await screen.findByText('Umfragen werden geladen…');
  if (moved) screen.getByRole('button', { name: 'Andere Aktion' }).focus();
  await act(async () => finish(page([saved])));
  expect(await screen.findByRole('radio', { name: /Testen/ })).toBeChecked();
  expect(moved ? screen.getByRole('button', { name: 'Andere Aktion' }) : screen.getByRole('radio', { name: /Testen/ })).toHaveFocus();
});
