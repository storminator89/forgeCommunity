import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useSession } from '@/lib/sites-auth/react';
import Events from '@/app/events/page';
import { eventApiFixture, participationFixture } from '../test-utils/event-participation';
import type { EventParticipationState } from '@/components/events/participation-state';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/EventForm', () => ({ __esModule: true, default: () => <div>Eventformular</div> }));
jest.mock('@/hooks/use-toast', () => {
  const toast = jest.fn();
  return { useToast: () => ({ toast }), mockToast: toast };
});
jest.mock('@/lib/sanitize-html', () => ({ sanitizeRichHtml: (value: string) => value }));
const mockToast = jest.requireMock('@/hooks/use-toast').mockToast as jest.Mock;

const future = () => {
  const date = new Date();
  date.setMonth(date.getMonth() + 3);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
};
const event = (isAttending = false, id = 'workshop') => ({
  id, title: 'Workshop', date: future(), description: 'Details', location: 'Community', timezone: 'Europe/Berlin',
  maxAttendees: null, attendeeCount: isAttending ? 1 : 0, isAttending, canCancelRsvp: isAttending,
});
const asUser = (id: string) => jest.mocked(useSession).mockReturnValue({
  data: { user: { id, role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
} as ReturnType<typeof useSession>);

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/events');
  asUser('alice');
  global.fetch = eventApiFixture([event()]);
});
afterEach(() => window.history.replaceState(null, '', '/events'));

test('opens and focuses an encoded event search anchor outside the current month', async () => {
  const target = event(false, 'event/with space');
  global.fetch = eventApiFixture([target]);
  window.history.replaceState(null, '', '/events#event-event%2Fwith%20space');
  render(<Events />);
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByRole('heading', { name: 'Workshop' })).toBeVisible();
  const anchor = document.getElementById('event-event%2Fwith%20space');
  expect(anchor).toBeInTheDocument();
  await waitFor(() => expect(anchor).toHaveFocus());
  fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(window.location.hash).toBe(''));
});

test('list cards expose the same stable event search anchor', async () => {
  render(<Events />);
  fireEvent.click(await screen.findByRole('button', { name: 'Liste' }));
  expect(await screen.findByRole('article')).toHaveAttribute('id', 'event-workshop');
});

test('removes the prior account’s RSVP immediately and reloads for the next viewer', async () => {
  let resolveBob!: (value: ReturnType<typeof event>[]) => void;
  const bobResponse = new Promise<ReturnType<typeof event>[]>(resolve => { resolveBob = resolve });
  let calls = 0;
  global.fetch = eventApiFixture(async () => ++calls === 1 ? [event(true)] : bobResponse);
  const { rerender } = render(<Events />);
  await screen.findByRole('button', { name: 'Liste' });
  fireEvent.click(screen.getByRole('button', { name: 'Liste' }));
  expect(await screen.findByRole('button', { name: 'Zusage zurücknehmen' })).toBeVisible();

  asUser('bob');
  rerender(<Events />);
  expect(screen.queryByRole('button', { name: 'Zusage zurücknehmen' })).not.toBeInTheDocument();
  await act(async () => resolveBob([event(false)]));
  fireEvent.click(await screen.findByRole('button', { name: 'Liste' }));
  expect(await screen.findByRole('button', { name: 'Teilnehmen' })).toBeVisible();

  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'bob', role: 'USER' }, expires: '2099-01-01' }, status: 'unauthenticated', update: jest.fn() } as unknown as ReturnType<typeof useSession>);
  rerender(<Events />);
  expect(screen.queryByRole('button', { name: 'Teilnehmen' })).not.toBeInTheDocument();
});

test('ignores a delayed previous-account event response after another account loads', async () => {
  let resolveAlice!: (value: ReturnType<typeof event>[]) => void;
  const oldResponse = new Promise<ReturnType<typeof event>[]>(resolve => { resolveAlice = resolve });
  let calls = 0;
  global.fetch = eventApiFixture(async () => ++calls === 1 ? oldResponse : [event(false)]);
  const { rerender } = render(<Events />);
  asUser('bob');
  rerender(<Events />);
  fireEvent.click(await screen.findByRole('button', { name: 'Liste' }));
  expect(await screen.findByRole('button', { name: 'Teilnehmen' })).toBeVisible();
  await act(async () => { resolveAlice([event(true)]); await oldResponse; });
  expect(screen.queryByRole('button', { name: 'Zusage zurücknehmen' })).not.toBeInTheDocument();
});

test('does not show a prior account’s RSVP result after switching viewers', async () => {
  let resolveRsvp!: (value: EventParticipationState) => void;
  const pendingRsvp = new Promise<EventParticipationState>(resolve => { resolveRsvp = resolve; });
  global.fetch = eventApiFixture([event(false)], async () => pendingRsvp);
  const { rerender } = render(<Events />);
  fireEvent.click(await screen.findByRole('button', { name: 'Liste' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Teilnehmen' }));
  asUser('bob');
  rerender(<Events />);
  fireEvent.click(await screen.findByRole('button', { name: 'Liste' }));
  await screen.findByRole('button', { name: 'Teilnehmen' });
  await act(async () => resolveRsvp(participationFixture(event(true))));
  expect(mockToast).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Zusage zurücknehmen' })).not.toBeInTheDocument();
});
