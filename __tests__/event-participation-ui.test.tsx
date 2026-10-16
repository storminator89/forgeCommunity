import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EventParticipation } from '@/components/events/EventParticipation';
import { parseEventParticipation, type EventParticipationState } from '@/components/events/participation-state';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

const event = { id: 'workshop', title: 'Workshop', date: '2035-05-21T10:00:00Z', attendeeCount: 1, maxAttendees: 1 };
const none = (changes: Partial<EventParticipationState> = {}): EventParticipationState => ({
  registrationState: 'NONE', isAttending: false, isWaitlisted: false, canCancelRsvp: false, canLeaveWaitlist: false,
  attendeeCount: 1, maxAttendees: 1, waitlistCount: 0, waitlistPosition: null, registrationClosed: false, ...changes,
});
const waiting = (position = 2) => none({ registrationState: 'WAITLISTED', isWaitlisted: true, canLeaveWaitlist: true, waitlistPosition: position, waitlistCount: 3 });
const registered = () => none({ registrationState: 'REGISTERED', isAttending: true, canCancelRsvp: true });
const response = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const panel = (viewerId: string | null = 'alice') => <EventParticipation event={event} viewerId={viewerId} />;
const calls = () => jest.mocked(fetch).mock.calls;
const writes = () => calls().filter(([, options]) => options?.method === 'POST' || options?.method === 'DELETE');

beforeEach(() => {
  jest.mocked(fetch).mockReset();
  jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test('reads verified own state and keeps an ordinary join bodyless, with stable keyboard focus', async () => {
  const user = userEvent.setup();
  jest.mocked(fetch).mockResolvedValueOnce(response(none({ attendeeCount: 0 }))).mockResolvedValueOnce(response(registered()));
  render(panel());
  const join = await screen.findByRole('button', { name: 'Teilnehmen' });
  expect(fetch).toHaveBeenNthCalledWith(1, '/api/events/workshop/rsvp', expect.objectContaining({ cache: 'no-store' }));
  await user.click(join);
  const cancel = await screen.findByRole('button', { name: 'Zusage zurücknehmen' });
  expect(cancel).toHaveFocus();
  expect(screen.getByText('Du bist angemeldet')).toBeVisible();
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ method: 'POST' });
  expect(writes()[0][1]).not.toHaveProperty('body');
});

test('only explicit full-event opt-in sends waitlist:true; rapid clicks create one request and truthful own position', async () => {
  const pending = deferred<Response>();
  jest.mocked(fetch).mockResolvedValueOnce(response(none())).mockReturnValueOnce(pending.promise);
  render(panel());
  const join = await screen.findByRole('button', { name: 'Auf Warteliste setzen' });
  expect(join).toHaveAccessibleDescription(/automatisch angemeldet/);
  expect(writes()).toHaveLength(0);
  fireEvent.click(join); fireEvent.click(join);
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).toMatchObject({ method: 'POST', body: '{"waitlist":true}' });
  expect(screen.getByRole('button', { name: 'Wird verarbeitet …' })).toBeDisabled();
  await act(async () => pending.resolve(response(waiting())));
  expect(screen.getByText('Warteliste · Platz 2')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Warteliste verlassen' })).toBeEnabled();
  expect(screen.queryByText('Du bist angemeldet')).not.toBeInTheDocument();
});

test('leaves the queue with DELETE and an explicit rejoin gets the new tail position', async () => {
  const user = userEvent.setup();
  jest.mocked(fetch).mockResolvedValueOnce(response(waiting(1))).mockResolvedValueOnce(response(none())).mockResolvedValueOnce(response(waiting(3)));
  render(panel());
  await user.click(await screen.findByRole('button', { name: 'Warteliste verlassen' }));
  expect(await screen.findByRole('button', { name: 'Auf Warteliste setzen' })).toBeEnabled();
  expect(writes()[0][1]).toMatchObject({ method: 'DELETE' });
  await user.click(screen.getByRole('button', { name: 'Auf Warteliste setzen' }));
  expect(await screen.findByText('Warteliste · Platz 3')).toBeVisible();
  expect(writes()).toHaveLength(2);
});

test('a racing bodyless full409 refreshes but never silently queues or retries the mutation', async () => {
  const user = userEvent.setup();
  jest.mocked(fetch).mockResolvedValueOnce(response(none({ attendeeCount: 0 })))
    .mockResolvedValueOnce(response({ error: 'Event is full' }, 409)).mockResolvedValueOnce(response(none())).mockResolvedValueOnce(response(waiting(1)));
  render(panel());
  await user.click(await screen.findByRole('button', { name: 'Teilnehmen' }));
  const queue = await screen.findByRole('button', { name: 'Auf Warteliste setzen' });
  expect(screen.getByText(/Die Änderung konnte nicht bestätigt werden/)).toBeVisible();
  expect(writes()).toHaveLength(1);
  expect(writes()[0][1]).not.toHaveProperty('body');
  expect(screen.queryByRole('button', { name: 'Warteliste verlassen' })).not.toBeInTheDocument();
  await user.click(queue);
  expect(await screen.findByText('Warteliste · Platz 1')).toBeVisible();
  expect(writes()).toHaveLength(2);
});

test('failed reads disable changes and retry only a fresh read', async () => {
  const user = userEvent.setup();
  jest.mocked(fetch).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(none()));
  render(panel());
  expect(await screen.findByRole('alert')).toHaveTextContent(/nicht geladen/);
  expect(screen.queryByRole('button', { name: 'Auf Warteliste setzen' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Teilnahmestatus erneut laden' }));
  expect(await screen.findByRole('button', { name: 'Auf Warteliste setzen' })).toBeEnabled();
  expect(writes()).toHaveLength(0);
});

test('an uncertain network mutation clears private state and requires a read before another action', async () => {
  const user = userEvent.setup();
  jest.mocked(fetch).mockResolvedValueOnce(response(waiting())).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response(registered()));
  render(panel());
  await user.click(await screen.findByRole('button', { name: 'Warteliste verlassen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/nicht bestätigt/);
  expect(screen.queryByText('Warteliste · Platz 2')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Teilnahmestatus erneut laden' }));
  expect(await screen.findByText('Du bist angemeldet')).toBeVisible();
  expect(writes()).toHaveLength(1);
});

test.each(['GET', 'POST'])('a stalled %s times out with a read-only recovery action', async method => {
  jest.useFakeTimers();
  const stalled = (_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  if (method === 'POST') jest.mocked(fetch).mockResolvedValueOnce(response(none()));
  jest.mocked(fetch).mockImplementationOnce(stalled);
  render(panel());
  if (method === 'POST') {
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Auf Warteliste setzen' }));
  }
  await act(async () => { jest.advanceTimersByTime(15000); });
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Teilnahmestatus erneut laden' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Auf Warteliste setzen' })).not.toBeInTheDocument();
  expect(writes()).toHaveLength(method === 'POST' ? 1 : 0);
});

test('a mutation finishing in a hidden tab cannot restore private state until a fresh visible read', async () => {
  const pending = deferred<Response>();
  const visibility = jest.spyOn(document, 'visibilityState', 'get');
  jest.mocked(fetch).mockResolvedValueOnce(response(waiting())).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response(registered()));
  render(panel());
  fireEvent.click(await screen.findByRole('button', { name: 'Warteliste verlassen' }));
  visibility.mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.queryByText('Warteliste · Platz 2')).not.toBeInTheDocument();
  await act(async () => pending.resolve(response(none())));
  expect(screen.queryByText('Deine Teilnahme wurde zurückgenommen.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Auf Warteliste setzen' })).not.toBeInTheDocument();
  visibility.mockReturnValue('visible');
  fireEvent(document, new Event('visibilitychange'));
  expect(await screen.findByText('Du bist angemeldet')).toBeVisible();
  expect(writes()).toHaveLength(1);
});

test.each([401, 404])('focus revalidation clears a prior queue position and handles revoked/missing state %s', async status => {
  jest.mocked(fetch).mockResolvedValueOnce(response(waiting())).mockResolvedValueOnce(response({}, status));
  render(panel());
  await screen.findByText('Warteliste · Platz 2');
  fireEvent(window, new Event('focus'));
  expect(screen.queryByText('Warteliste · Platz 2')).not.toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent(status === 401 ? /erneut an/ : /nicht mehr verfügbar/);
  expect(screen.queryByRole('button', { name: 'Warteliste verlassen' })).not.toBeInTheDocument();
  if (status === 401) expect(screen.getByRole('link', { name: 'Erneut anmelden' })).toHaveAttribute('href', '/login');
});

test('a newer read wins over a delayed stale read even if the transport ignores abort', async () => {
  const old = deferred<Response>();
  jest.mocked(fetch).mockReturnValueOnce(old.promise).mockResolvedValueOnce(response(waiting()));
  render(panel());
  fireEvent(window, new Event('focus'));
  await screen.findByText('Warteliste · Platz 2');
  await act(async () => old.resolve(response(registered())));
  expect(screen.getByText('Warteliste · Platz 2')).toBeVisible();
  expect(screen.queryByText('Du bist angemeldet')).not.toBeInTheDocument();
});

test('an account switch aborts and ignores the prior account’s delayed queue mutation', async () => {
  const pending = deferred<Response>();
  jest.mocked(fetch).mockResolvedValueOnce(response(none())).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(none({ attendeeCount: 0 })));
  const view = render(panel());
  fireEvent.click(await screen.findByRole('button', { name: 'Auf Warteliste setzen' }));
  const signal = writes()[0][1]!.signal!;
  view.rerender(panel('bob'));
  expect(signal.aborted).toBe(true);
  await screen.findByRole('button', { name: 'Teilnehmen' });
  await act(async () => pending.resolve(response(waiting())));
  expect(screen.queryByText('Warteliste · Platz 2')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Teilnehmen' })).toBeEnabled();
});

test('unmounting prevents late mutation success from announcing or synchronizing old private state', async () => {
  const pending = deferred<Response>();
  jest.mocked(fetch).mockResolvedValueOnce(response(none())).mockReturnValueOnce(pending.promise);
  const sync = jest.fn(); window.addEventListener('forge:event-participation-changed', sync);
  const view = render(panel()); fireEvent.click(await screen.findByRole('button', { name: 'Auf Warteliste setzen' }));
  view.unmount();
  await act(async () => pending.resolve(response(waiting())));
  expect(sync).not.toHaveBeenCalled();
  window.removeEventListener('forge:event-participation-changed', sync);
});

test('manual refresh shows a server-confirmed promotion without sending a mutation', async () => {
  const user = userEvent.setup();
  jest.mocked(fetch).mockResolvedValueOnce(response(waiting())).mockResolvedValueOnce(response(registered()));
  render(panel());
  await user.click(await screen.findByRole('button', { name: 'Status aktualisieren' }));
  expect(await screen.findByText('Du bist angemeldet')).toBeVisible();
  expect(screen.queryByText('Warteliste · Platz 2')).not.toBeInTheDocument();
  expect(screen.getByText('Du bist jetzt für das Event angemeldet.')).toBeVisible();
  expect(writes()).toHaveLength(0);
});

test('read revalidation restores queue-control focus, or the new cancellation action after promotion', async () => {
  const user = userEvent.setup();
  jest.mocked(fetch).mockResolvedValueOnce(response(waiting())).mockResolvedValueOnce(response(waiting(1)))
    .mockResolvedValueOnce(response(registered()));
  render(panel());
  await user.click(await screen.findByRole('button', { name: 'Status aktualisieren' }));
  await screen.findByText('Warteliste · Platz 1');
  expect(screen.getByRole('button', { name: 'Status aktualisieren' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(await screen.findByRole('button', { name: 'Zusage zurücknehmen' })).toHaveFocus();
});

test('a background refresh never steals focus moved outside the panel', async () => {
  const user = userEvent.setup();
  const pending = deferred<Response>();
  jest.mocked(fetch).mockResolvedValueOnce(response(waiting())).mockReturnValueOnce(pending.promise);
  render(<>{panel()}<button>Andere Aktion</button></>);
  await user.click(await screen.findByRole('button', { name: 'Status aktualisieren' }));
  screen.getByRole('button', { name: 'Andere Aktion' }).focus();
  await act(async () => pending.resolve(response(registered())));
  expect(screen.getByRole('button', { name: 'Andere Aktion' })).toHaveFocus();
});

test.each([false, true])('restores focus inside the actual Radix details dialog without stealing a new control focus (%s)', async moved => {
  const user = userEvent.setup();
  const pending = deferred<Response>();
  jest.mocked(fetch).mockResolvedValueOnce(response(waiting())).mockReturnValueOnce(pending.promise);
  render(<Dialog defaultOpen><DialogContent aria-describedby={undefined}><DialogTitle>Workshopdetails</DialogTitle>{panel()}</DialogContent></Dialog>);
  await user.click(await screen.findByRole('button', { name: 'Status aktualisieren' }));
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  if (moved) screen.getByRole('button', { name: 'Schließen' }).focus();
  await act(async () => pending.resolve(response(registered())));
  expect(screen.getByRole('button', { name: moved ? 'Schließen' : 'Zusage zurücknehmen' })).toHaveFocus();
});

test('a peer cancellation during a delayed successful write is revalidated before stale own state can persist', async () => {
  const pending = deferred<Response>();
  jest.mocked(fetch).mockResolvedValueOnce(response(none({ attendeeCount: 0 }))).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(response(registered())).mockResolvedValue(response(none({ attendeeCount: 0 })));
  const view = render(<section aria-label="Liste">{panel()}</section>);
  const list = within(screen.getByRole('region', { name: 'Liste' }));
  fireEvent.click(await list.findByRole('button', { name: 'Teilnehmen' }));
  view.rerender(<><section aria-label="Liste">{panel()}</section><section aria-label="Details">{panel()}</section></>);
  const details = within(screen.getByRole('region', { name: 'Details' }));
  fireEvent.click(await details.findByRole('button', { name: 'Zusage zurücknehmen' }));
  expect(await details.findByRole('button', { name: 'Teilnehmen' })).toBeEnabled();
  await act(async () => pending.resolve(response(registered())));
  expect(await list.findByRole('button', { name: 'Teilnehmen' })).toBeEnabled();
  expect(list.queryByText('Du bist angemeldet')).not.toBeInTheDocument();
  expect(details.getByRole('button', { name: 'Teilnehmen' })).toBeEnabled();
  expect(writes()).toHaveLength(2);
});

test.each([null, [], {}, none({ isWaitlisted: true }), waiting(0), none({ attendeeCount: -1 })])('rejects incomplete or contradictory response %j', async body => {
  expect(() => parseEventParticipation(body)).toThrow();
  jest.mocked(fetch).mockResolvedValue(response(body));
  render(panel());
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Auf Warteliste setzen' })).not.toBeInTheDocument();
});

test('closed registration and recorded attendance cannot gain a new queue action', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response(none({ registrationClosed: true })));
  const view = render(panel());
  expect(await screen.findByRole('button', { name: 'Anmeldung geschlossen' })).toBeDisabled();
  view.unmount();
  jest.mocked(fetch).mockResolvedValueOnce(response(none({ registrationState: 'ATTENDED', isAttending: true })));
  render(panel());
  expect(await screen.findByRole('button', { name: 'Teilgenommen' })).toBeDisabled();
  expect(writes()).toHaveLength(0);
});

test('a queued past event remains withdrawable without promising a future promotion', async () => {
  jest.mocked(fetch).mockResolvedValue(response({ ...waiting(), registrationClosed: true }));
  render(panel());
  expect(await screen.findByRole('button', { name: 'Warteliste verlassen' })).toBeEnabled();
  expect(screen.getByText(/keine Plätze mehr vergeben/)).toBeVisible();
  expect(screen.queryByText(/automatisch angemeldet/)).not.toBeInTheDocument();
});

test('guests receive sign-in navigation without reading private RSVP state', () => {
  render(panel(null));
  expect(screen.getByRole('link', { name: 'Anmelden' })).toHaveAttribute('href', '/login');
  expect(fetch).not.toHaveBeenCalled();
});

test('offscreen list panels defer private reads and ignore focus until they enter the viewport', async () => {
  let intersect!: IntersectionObserverCallback;
  const disconnect = jest.fn();
  const original = global.IntersectionObserver;
  global.IntersectionObserver = jest.fn().mockImplementation(callback => { intersect = callback; return { observe: jest.fn(), disconnect }; });
  try {
    jest.mocked(fetch).mockResolvedValue(response(none()));
    const view = render(panel());
    fireEvent(window, new Event('focus'));
    expect(fetch).not.toHaveBeenCalled();
    act(() => intersect([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(await screen.findByRole('button', { name: 'Auf Warteliste setzen' })).toBeEnabled();
    act(() => intersect([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    fireEvent(window, new Event('focus'));
    expect(fetch).toHaveBeenCalledTimes(1);
    view.unmount(); expect(disconnect).toHaveBeenCalledTimes(1);
  } finally { global.IntersectionObserver = original; }
});


test('queue decisions disclose order, automatic signup and no guarantee without repeating the saved success visually', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response(none())).mockResolvedValueOnce(response(waiting(1)));
  render(panel());
  const queue = await screen.findByRole('button', { name: 'Auf Warteliste setzen' });
  expect(queue).toHaveAccessibleDescription(/der Reihe nach.*automatisch angemeldet.*Jederzeit verlassen.*kein Platz garantiert/);
  await userEvent.click(queue);
  expect(await screen.findByText('Warteliste · Platz 1')).toBeVisible();
  expect(screen.getByText('Du stehst auf der Warteliste.')).toHaveClass('sr-only');
  expect(screen.getByRole('button', { name: 'Animationen durch Systemeinstellung ausgeschaltet' })).toBeDisabled();
  expect(document.querySelector('[data-confirmed]')).toBeNull();
});
