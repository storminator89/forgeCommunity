import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { DateTime } from 'luxon';
import { useSession } from 'next-auth/react';
import Events from '@/app/events/page';
import { eventApiFixture, participationFixture } from '../test-utils/event-participation';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/EventForm', () => ({ __esModule: true, default: () => <input aria-label="Eventtitel" /> }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('@/lib/sanitize-html', () => ({ sanitizeRichHtml: (value: string) => value }));

const monthDate = (offset: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + offset, 12, 12);
};
const futureYearDate = () => new Date(new Date().getFullYear() + 1, 0, 20, 12);
const event = (id: string, title: string, date: Date, category = 'Workshop') => ({
  id, title, date: date.toISOString(), description: '<p>Details</p>', location: 'Community', category,
  startTime: '12:00', endTime: '13:00', timezone: 'Europe/Berlin', maxAttendees: null,
  attendeeCount: 0, isAttending: false, canCancelRsvp: false,
});
const nextMonth = () => event('next-month', 'Nächster Workshop', monthDate(1));
const nextYear = () => event('next-year', 'Jahrestreffen', futureYearDate(), 'Seminar');

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/events');
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'member', role: 'USER' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  global.fetch = eventApiFixture([nextYear(), nextMonth()]);
});
afterEach(() => window.history.replaceState(null, '', '/events'));

test('exposes chronologically ordered events in later months and years without changing the initial month', async () => {
  render(<Events />);
  const upcoming = await screen.findByRole('region', { name: 'Nächste Events' });
  expect(within(upcoming).getByText('2 von 2 Events ab heute')).toBeVisible();
  const previews = within(upcoming).getAllByRole('button', { name: /^Details öffnen:/ });
  expect(previews[0]).toHaveAccessibleName(/Nächster Workshop/);
  expect(previews[1]).toHaveAccessibleName(/Jahrestreffen/);
  expect(within(screen.getByRole('region', { name: 'Monatskalender' })).getByRole('heading', {
    name: format(new Date(), 'MMMM yyyy', { locale: de }),
  })).toBeVisible();
  expect(screen.queryByRole('button', { name: /, 1 Event$/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Event erstellen' })).not.toBeInTheDocument();
});

test('opens a later-year event with keyboard focus and returns to its preview after repeated dismissal', async () => {
  const user = userEvent.setup();
  render(<Events />);
  const preview = await screen.findByRole('button', { name: /^Details öffnen: Jahrestreffen/ });
  preview.focus();
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Jahrestreffen' })).toBeVisible();
  const anchor = document.getElementById('event-next-year');
  await waitFor(() => expect(anchor).toHaveFocus());
  expect(await within(dialog).findByRole('button', { name: 'Teilnehmen' })).toBeEnabled();
  expect(within(dialog).queryByRole('button', { name: /bearbeiten|löschen/ })).not.toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(preview).toHaveFocus();
  expect(within(screen.getByRole('region', { name: 'Monatskalender' })).getByRole('heading', {
    name: format(futureYearDate(), 'MMMM yyyy', { locale: de }),
  })).toBeVisible();
  await user.keyboard('{Enter}');
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Schließen' }));
  await waitFor(() => expect(preview).toHaveFocus());
  expect(window.location.hash).toBe('');
});

test('preserves search for upcoming details and calendar navigation, and resets it accessibly', async () => {
  const user = userEvent.setup();
  render(<Events />);
  const search = await screen.findByRole('searchbox', { name: 'Events durchsuchen' });
  await user.type(search, 'Seminar');
  const upcoming = screen.getByRole('region', { name: 'Nächste Events' });
  expect(within(upcoming).queryByRole('button', { name: /^Details öffnen: Nächster Workshop/ })).not.toBeInTheDocument();
  await user.click(within(upcoming).getByRole('button', { name: /^Details öffnen: Jahrestreffen/ }));
  expect(within(await screen.findByRole('dialog')).getByRole('heading', { name: 'Jahrestreffen' })).toBeVisible();
  await user.keyboard('{Escape}');
  expect(search).toHaveValue('Seminar');
  await user.click(screen.getByRole('button', { name: 'Nächster Monat' }));
  expect(search).toHaveValue('Seminar');
  await user.clear(search);
  await user.type(search, 'Kein Treffer');
  expect(within(upcoming).getByRole('status')).toHaveTextContent('Keine passenden Events ab heute gefunden.');
  await user.click(screen.getByRole('button', { name: 'Eventsuche löschen' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(within(upcoming).getAllByRole('button', { name: /^Details öffnen:/ })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'Eventsuche löschen' })).not.toBeInTheDocument();
});

test.each(['empty', 'past-only'])('keeps the calendar and list empty states truthful with %s data', async scenario => {
  const past = new Date();
  past.setDate(past.getDate() - 1);
  global.fetch = eventApiFixture(scenario === 'empty' ? [] : [event('past', 'Gestern', past)]);
  render(<Events />);
  const upcoming = await screen.findByRole('region', { name: 'Nächste Events' });
  expect(within(upcoming).getByRole('status')).toHaveTextContent('Keine Events ab heute geplant.');
  expect(within(upcoming).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Monatskalender' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Liste' }));
  expect(screen.getByText('Keine zukünftigen Events gefunden.')).toBeVisible();
});

test('shows at most three previews and moves keyboard focus to the complete filtered list', async () => {
  const user = userEvent.setup();
  const fixtures = [4, 3, 2, 1].map(offset => event(`month-${offset}`, `Workshop ${offset}`, monthDate(offset)));
  global.fetch = eventApiFixture(fixtures);
  render(<Events />);
  const upcoming = await screen.findByRole('region', { name: 'Nächste Events' });
  expect(within(upcoming).getByText('3 von 4 Events ab heute')).toBeVisible();
  expect(within(upcoming).getAllByRole('button', { name: /^Details öffnen:/ })).toHaveLength(3);
  expect(within(upcoming).queryByText('Workshop 4')).not.toBeInTheDocument();
  const showList = within(upcoming).getByRole('button', { name: 'Alle in der Liste ansehen' });
  showList.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('heading', { name: 'Listenansicht' })).toHaveFocus();
  expect(screen.getAllByRole('article')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Liste' })).toHaveAttribute('aria-pressed', 'true');
  await user.click(screen.getByRole('button', { name: 'Woche' }));
  expect(screen.getByRole('region', { name: 'Nächste Events' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'Wochenkalender' })).toBeVisible();
});

test('retains today’s events and their closed RSVP rather than advertising them as future registrations', async () => {
  const today = DateTime.now().setZone('Europe/Berlin').startOf('day').toJSDate();
  global.fetch = eventApiFixture([event('today', 'Heute', today)]);
  render(<Events />);
  fireEvent.click(await screen.findByRole('button', { name: /^Details öffnen: Heute/ }));
  expect(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Anmeldung geschlossen' })).toBeDisabled();
});

test.each(['USER', 'ADMIN'])('preserves %s controls and full-event RSVP constraints in upcoming details', async role => {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'member', role }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  global.fetch = eventApiFixture([{ ...nextMonth(), maxAttendees: 1, attendeeCount: 1 }]);
  render(<Events />);
  const preview = await screen.findByRole('button', { name: /^Details öffnen: Nächster Workshop/ });
  expect(Boolean(screen.queryByRole('button', { name: 'Event erstellen' }))).toBe(role === 'ADMIN');
  fireEvent.click(preview);
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByRole('button', { name: 'Auf Warteliste setzen' })).toBeEnabled();
  expect(within(dialog).getByText('Ausgebucht')).toBeVisible();
  expect(Boolean(within(dialog).queryByRole('button', { name: 'Event Nächster Workshop bearbeiten' }))).toBe(role === 'ADMIN');
  expect(Boolean(within(dialog).queryByRole('button', { name: 'Event Nächster Workshop löschen' }))).toBe(role === 'ADMIN');
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(jest.mocked(global.fetch).mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
  if (role === 'ADMIN') {
    fireEvent.click(within(dialog).getByRole('button', { name: 'Event Nächster Workshop bearbeiten' }));
    const editor = await screen.findByRole('dialog', { name: 'Event bearbeiten' });
    await waitFor(() => expect(within(editor).getByRole('textbox', { name: 'Eventtitel' })).toHaveFocus());
  }
});

test('keeps keyboard focus on the RSVP control after joining from an upcoming preview', async () => {
  const user = userEvent.setup();
  global.fetch = eventApiFixture([nextMonth()], async () => participationFixture({ ...nextMonth(), isAttending: true, canCancelRsvp: true, attendeeCount: 1 }));
  render(<Events />);
  await user.click(await screen.findByRole('button', { name: /^Details öffnen: Nächster Workshop/ }));
  const dialog = await screen.findByRole('dialog');
  await waitFor(() => expect(document.getElementById('event-next-month')).toHaveFocus());
  await user.click(await within(dialog).findByRole('button', { name: 'Teilnehmen' }));
  const cancel = await within(dialog).findByRole('button', { name: 'Zusage zurücknehmen' });
  await waitFor(() => expect(cancel).toHaveFocus());
  expect(global.fetch).toHaveBeenCalledWith('/api/events/next-month/rsvp', expect.objectContaining({ method: 'POST' }));
  const write = jest.mocked(global.fetch).mock.calls.find(([, options]) => options?.method === 'POST')![1]!;
  expect(write).not.toHaveProperty('body');
});

test('month, week, preview, list and deep link keep an event-zone day across a UTC year boundary', async () => {
  const user = userEvent.setup();
  const tokyo = { ...event('tokyo-midnight', 'Tokio nach Mitternacht', new Date('2029-12-31T15:30:00Z')),
    timezone: 'Asia/Tokyo', startTime: '00:30', endTime: '01:30' };
  global.fetch = eventApiFixture([tokyo]);
  render(<Events />);
  const preview = await screen.findByRole('button', { name: 'Details öffnen: Tokio nach Mitternacht, 01. Januar 2030' });
  expect(within(preview).getByText('01. Jan. 2030 · 00:30 (Asia/Tokyo)')).toBeVisible();
  await user.click(preview);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: '01. Januar 2030' })).toBeVisible();
  expect(within(dialog).getByText('00:30 - 01:30 (Asia/Tokyo)')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.getByRole('button', { name: 'Dienstag, 01. Januar 2030, 1 Event' })).toBeVisible();
  expect(within(screen.getByRole('region', { name: 'Monatskalender' })).getByRole('heading', { name: 'Januar 2030' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Woche' }));
  expect(within(screen.getByRole('region', { name: 'Wochenkalender' })).getByRole('button', { name: 'Dienstag, 01. Januar 2030, 1 Event' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Liste' }));
  expect(screen.getByText('01. Jan. 2030, 00:30 - 01:30 (Asia/Tokyo)')).toBeVisible();
  window.history.replaceState(null, '', '/events#event-tokyo-midnight');
  fireEvent(window, new HashChangeEvent('hashchange'));
  expect(within(await screen.findByRole('dialog')).getByRole('heading', { name: '01. Januar 2030' })).toBeVisible();
  await waitFor(() => expect(document.getElementById('event-tokyo-midnight')).toHaveFocus());
});

test('a western-zone event stays on the preceding local day and shows its timezone', async () => {
  const user = userEvent.setup();
  const newYork = { ...event('new-york-evening', 'Abend in New York', new Date('2030-01-01T00:30:00Z')),
    timezone: 'America/New_York', startTime: '19:30', endTime: '20:30' };
  global.fetch = eventApiFixture([newYork]);
  render(<Events />);
  await user.click(await screen.findByRole('button', { name: 'Details öffnen: Abend in New York, 31. Dezember 2029' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: '31. Dezember 2029' })).toBeVisible();
  expect(within(dialog).getByText('19:30 - 20:30 (America/New_York)')).toBeVisible();
});
