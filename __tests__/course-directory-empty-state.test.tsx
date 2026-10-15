import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import CourseClient from '@/app/courses/CourseClient';

const mockRouter = { push: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

const courses = [
  {
    id: 'technology', title: 'Technik verstehen', instructor: 'Lehrkraft', duration: 'Flexibel',
    startDate: null, endDate: null, category: 'Technik', participants: 0,
    maxStudents: null, price: null, currency: null, isEnrolled: false,
    completed: false, canDelete: false, imageUrl: null,
  },
  {
    id: 'language', title: 'Spanisch lernen', instructor: 'Lehrkraft', duration: 'Flexibel',
    startDate: null, endDate: null, category: 'Sprache', participants: 0,
    maxStudents: null, price: null, currency: null, isEnrolled: false,
    completed: false, canDelete: false, imageUrl: null,
  },
];

function setRole(role: string | null | undefined) {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'viewer', role }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
}

beforeEach(() => {
  jest.clearAllMocks();
  setRole('USER');
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] });
});

it.each(['ADMIN', 'INSTRUCTOR', 'MODERATOR', null, undefined])('does not suggest private pathways to %s', role => {
  setRole(role);
  render(<CourseClient />);
  expect(screen.queryByRole('link', { name: 'Lernpfade' })).not.toBeInTheDocument();
});

it('suggests private pathways to a member', () => {
  render(<CourseClient />);
  expect(screen.getByRole('link', { name: 'Lernpfade' })).toHaveAttribute('href', '/courses/pathways');
});

it.each(['ADMIN', 'INSTRUCTOR', 'MODERATOR', null, undefined])('hides the learner journey entry from %s', async role => {
  setRole(role);
  render(<CourseClient />);
  await screen.findByRole('heading', { name: 'Noch keine Kurse' });
  expect(screen.queryByRole('link', { name: 'Mein Lernweg' })).not.toBeInTheDocument();
});

it('links a USER to the private learner journey', async () => {
  render(<CourseClient />);
  await screen.findByRole('heading', { name: 'Noch keine Kurse' });
  expect(screen.getByRole('link', { name: 'Mein Lernweg' })).toHaveAttribute('href', '/courses/journey');
});

it.each(['USER', 'MODERATOR', null, undefined, 'UNKNOWN'])('gives %s a truthful learner next step for an empty catalog', async role => {
  setRole(role);
  render(<CourseClient />);

  expect(await screen.findByRole('heading', { name: 'Noch keine Kurse' })).toBeVisible();
  expect(screen.getByText('0 Kurse verfügbar')).toBeVisible();
  expect(screen.getByText(/Hier sind aktuell keine Kurse verfügbar/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'Zur Community' })).toHaveAttribute('href', '/community');
  expect(screen.getByRole('link', { name: 'Veranstaltungen ansehen' })).toHaveAttribute('href', '/events');
  expect(screen.queryByText(/Erstelle den ersten Kurs/)).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Kurs erstellen' })).not.toBeInTheDocument();
  // The existing API permits creation by every authenticated account.
  expect(screen.getByRole('link', { name: 'Neuer Kurs' })).toHaveAttribute('href', '/courses/new');
});

it.each(['ADMIN', 'INSTRUCTOR'])('keeps the %s creator-first empty state and creation route', async role => {
  setRole(role);
  render(<CourseClient />);

  expect(await screen.findByRole('heading', { name: 'Noch keine Kurse' })).toBeVisible();
  expect(screen.getByText('Erstelle den ersten Kurs und teile dein Wissen mit der Community.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Kurs erstellen' })).toHaveAttribute('href', '/courses/new');
  expect(screen.getByRole('link', { name: 'Neuer Kurs' })).toHaveAttribute('href', '/courses/new');
  expect(screen.queryByRole('link', { name: 'Zur Community' })).not.toBeInTheDocument();
});

it('makes both learner next steps reachable and activatable with the keyboard', async () => {
  const user = userEvent.setup();
  render(<CourseClient />);
  const community = await screen.findByRole('link', { name: 'Zur Community' });
  const events = screen.getByRole('link', { name: 'Veranstaltungen ansehen' });
  const communityClick = jest.fn((event: Event) => event.preventDefault());
  const eventsClick = jest.fn((event: Event) => event.preventDefault());
  community.addEventListener('click', communityClick);
  events.addEventListener('click', eventsClick);

  // Category precedes the empty-state actions in the real tab order.
  screen.getByRole('combobox', { name: 'Kategorie' }).focus();
  await user.tab();
  expect(community).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(communityClick).toHaveBeenCalledTimes(1);
  await user.tab();
  expect(events).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(eventsClick).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each(['USER', 'ADMIN', 'INSTRUCTOR'])('keeps an unmatched query recoverable for %s with keyboard reset', async role => {
  const user = userEvent.setup();
  setRole(role);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => courses });
  render(<CourseClient />);
  await screen.findByText('Technik verstehen');
  const search = screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
  await user.type(search, 'Nicht vorhanden');

  expect(screen.getByRole('heading', { name: 'Keine Kurse gefunden' })).toBeVisible();
  expect(screen.getByText('0 Kurse gefunden')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Noch keine Kurse' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Zur Community' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Kurs erstellen' })).not.toBeInTheDocument();
  const reset = screen.getByRole('button', { name: 'Filter zurücksetzen' });
  expect(reset).toHaveAttribute('type', 'button');
  screen.getByRole('combobox', { name: 'Kategorie' }).focus();
  await user.tab();
  expect(reset).toHaveFocus();
  await user.keyboard('{Enter}');

  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(screen.getByText('2 Kurse verfügbar')).toBeVisible();
  expect(screen.getByText('Technik verstehen')).toBeVisible();
  expect(screen.getByText('Spanisch lernen')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Filter zurücksetzen' })).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('resets a combined category and query filter and supports repeated keyboard use', async () => {
  const user = userEvent.setup();
  // Radix scrolls the focused option; JSDOM has no layout implementation.
  const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: jest.fn() });
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => courses });
  try {
    render(<CourseClient />);
    await screen.findByText('Technik verstehen');
    const category = screen.getByRole('combobox', { name: 'Kategorie' });
    category.focus();
    await user.keyboard('{ArrowDown}');
    await screen.findByRole('option', { name: 'Technik' });
    await user.keyboard('{End}{Enter}');
    await waitFor(() => expect(category).toHaveTextContent('Technik'));
    expect(screen.getByText('1 Kurs gefunden')).toBeVisible();
    expect(screen.queryByText('Spanisch lernen')).not.toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
    await user.type(search, 'Spanisch');
    expect(screen.getByRole('heading', { name: 'Keine Kurse gefunden' })).toBeVisible();
    category.focus();
    await user.tab();
    await user.keyboard(' ');
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(category).toHaveTextContent('Alle Kategorien');
    expect(screen.getByText('2 Kurse verfügbar')).toBeVisible();

    await user.type(search, 'Wieder kein Treffer');
    category.focus();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(search).toHaveFocus();
    expect(screen.getByText('2 Kurse verfügbar')).toBeVisible();
  } finally {
    if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoView);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it('keeps the learner paths and reset available when the genuinely empty catalog has a query', async () => {
  const user = userEvent.setup();
  render(<CourseClient />);
  await screen.findByRole('heading', { name: 'Noch keine Kurse' });
  const search = screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
  await user.type(search, 'React');
  expect(screen.getByRole('heading', { name: 'Noch keine Kurse' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Zur Community' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Veranstaltungen ansehen' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  expect(search).toHaveValue('');
  expect(search).toHaveFocus();
  expect(screen.getByText('0 Kurse verfügbar')).toBeVisible();
});

it('does not claim that a pending course request is an empty catalog', async () => {
  let resolve!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
  global.fetch = jest.fn().mockReturnValue(new Promise(resolveRequest => { resolve = resolveRequest; }));
  render(<CourseClient />);
  expect(screen.getByRole('heading', { name: 'Kurse werden geladen' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Noch keine Kurse' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Zur Community' })).not.toBeInTheDocument();
  expect(screen.queryByText('0 Kurse verfügbar')).not.toBeInTheDocument();
  await act(async () => resolve({ ok: true, json: async () => [] }));
  expect(await screen.findByRole('heading', { name: 'Noch keine Kurse' })).toBeVisible();
});

it.each(['http', 'network', 'json'])('keeps a %s failure distinct from an empty catalog', async failure => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = failure === 'network'
    ? jest.fn().mockRejectedValue(new Error('Offline'))
    : jest.fn().mockResolvedValue({ ok: failure !== 'http', json: async () => { throw new Error('Invalid JSON'); } });
  try {
    render(<CourseClient />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Kurse konnten nicht geladen werden');
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Noch keine Kurse' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Zur Community' })).not.toBeInTheDocument();
    expect(screen.queryByText('0 Kurse verfügbar')).not.toBeInTheDocument();
  } finally {
    log.mockRestore();
  }
});

it('changes the empty-catalog suggestion immediately when the same account role changes', async () => {
  setRole('INSTRUCTOR');
  const view = render(<CourseClient />);
  expect(await screen.findByRole('link', { name: 'Kurs erstellen' })).toBeVisible();
  setRole('USER');
  view.rerender(<CourseClient />);
  expect(screen.queryByRole('link', { name: 'Kurs erstellen' })).not.toBeInTheDocument();
  expect(await screen.findByRole('link', { name: 'Zur Community' })).toBeVisible();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it.each(['loading', 'unauthenticated'] as const)('does not expose an empty catalog before authentication is %s', status => {
  jest.mocked(useSession).mockReturnValue({ data: null, status, update: jest.fn() } as ReturnType<typeof useSession>);
  render(<CourseClient />);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading', { name: 'Noch keine Kurse' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Neuer Kurs' })).not.toBeInTheDocument();
  if (status === 'unauthenticated') expect(mockRouter.push).toHaveBeenCalledWith('/');
});
