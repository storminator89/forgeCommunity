import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import CourseClient from '@/app/courses/CourseClient';
import JourneyClient from '@/app/courses/journey/JourneyClient';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null, useSignInHref: () => '/login?callbackUrl=%2Fcommunity' }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt="" />;
  },
}));

const course = {
  id: 'qa-route-course', title: 'Route QA Lernkurs', instructor: 'Lehrkraft', duration: 'Flexibel',
  startDate: null, endDate: null, category: 'Technik', participants: 1, maxStudents: null,
  price: null, currency: null, isEnrolled: true, completed: false, canDelete: false, imageUrl: null,
};
const leaf = { id: 'qa-open', title: 'Route QA offener Lernschritt', type: 'TEXT', order: 2, locked: false,
  courseId: 'qa-route-course', parentId: null, prerequisiteIds: [], missingPrerequisites: [], releaseOn: null, contentVersionToken: 'fixture-token', releaseLocked: false, publicationId: 'qa-publication', subContents: [] };
const locked = { ...leaf, id: 'qa-locked', title: 'Route QA gesperrter Schritt', order: 1, locked: true, releaseLocked: true };
function response(json: unknown) { return Promise.resolve({ ok: true, json: async () => json } as Response); }
function setSession(role = 'USER') {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'viewer', role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
}
function comesBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}
function journeyResponses(contents: unknown[] = [locked, leaf]) {
  window.history.replaceState({}, '', '/courses/journey');
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/courses') return response([course]);
    if (url.endsWith('/contents')) return response(contents);
    if (url.endsWith('/progress')) return response({ awaitingGradeContentIds: [], completedContentIds: [], complete: false, canTrack: true, publicationId: 'qa-publication' });
    throw new Error(`Unexpected request ${url}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setSession();
  window.localStorage.clear();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
    matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }) });
});

it('prioritizes catalog controls and real course results while preserving all secondary destinations', async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn().mockImplementation(() => response([course]));
  render(<CourseClient />);
  const title = await screen.findByRole('heading', { name: course.title });
  const search = screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
  const navigation = screen.getByRole('navigation', { name: 'Weitere Kursbereiche' });
  comesBefore(search, title);
  comesBefore(search, navigation);
  comesBefore(navigation, title);
  expect(screen.queryByText('Wissen teilen. Gemeinsam weiterkommen.')).not.toBeInTheDocument();
  expect(within(navigation).getByRole('link', { name: 'Mein Lernweg' })).toHaveAttribute('href', '/courses/journey');
  const trigger = within(navigation).getByRole('button', { name: 'Kursbereiche' });
  expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  trigger.focus();
  await user.keyboard('{Enter}');
  const menu = await screen.findByRole('menu', { name: 'Kursbereiche' });
  const destinations = [
    ['Lernpfade', '/courses/pathways'], ['Mein Lernziel', '/courses/goals'],
    ['Meine Kursentwürfe', '/courses/authoring'], ['Neuer Kurs', '/courses/new'],
  ];
  expect(within(menu).getAllByRole('menuitem')).toHaveLength(destinations.length);
  for (const [index, [name, href]] of destinations.entries()) {
    const item = within(menu).getByRole('menuitem', { name });
    expect(item).toHaveAttribute('href', href);
    expect(item).toBeVisible();
    if (index > 0) await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(item).toHaveFocus());
  }
  await user.keyboard('{Home}');
  expect(within(menu).getByRole('menuitem', { name: 'Lernpfade' })).toHaveFocus();
  await user.keyboard('{End}');
  expect(within(menu).getByRole('menuitem', { name: 'Neuer Kurs' })).toHaveFocus();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Kurs öffnen' })).toBeEnabled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it.each(['USER', 'COMPANY', 'MODERATOR', 'INSTRUCTOR', 'ADMIN'])('keeps every authorized destination and one new-course route for %s', async role => {
  const user = userEvent.setup();
  setSession(role);
  global.fetch = jest.fn().mockImplementation(() => response([course]));
  render(<CourseClient />);
  await screen.findByRole('heading', { name: course.title });
  const creator = role === 'INSTRUCTOR' || role === 'ADMIN';
  const search = screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
  if (creator) {
    const create = screen.getByRole('link', { name: 'Neuer Kurs' });
    expect(create).toHaveAttribute('href', '/courses/new');
    comesBefore(create, search);
  } else expect(screen.queryByRole('link', { name: 'Neuer Kurs' })).not.toBeInTheDocument();
  expect(screen.queryAllByRole('link', { name: 'Mein Lernweg' })).toHaveLength(role === 'USER' ? 1 : 0);
  await user.click(screen.getByRole('button', { name: 'Kursbereiche' }));
  const menu = await screen.findByRole('menu', { name: 'Kursbereiche' });
  expect(within(menu).queryAllByRole('menuitem', { name: 'Lernpfade' })).toHaveLength(role === 'USER' ? 1 : 0);
  expect(within(menu).getByRole('menuitem', { name: 'Mein Lernziel' })).toHaveAttribute('href', '/courses/goals');
  expect(within(menu).getByRole('menuitem', { name: 'Meine Kursentwürfe' })).toHaveAttribute('href', '/courses/authoring');
  expect(within(menu).queryAllByRole('menuitem', { name: 'Neuer Kurs' })).toHaveLength(creator ? 0 : 1);
  if (!creator) expect(within(menu).getByRole('menuitem', { name: 'Neuer Kurs' })).toHaveAttribute('href', '/courses/new');
  expect(screen.getAllByRole(creator ? 'link' : 'menuitem', { name: 'Neuer Kurs' })).toHaveLength(1);
});

it('dismisses course areas on outside interaction and discards an open menu on account perspective changes', async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn().mockImplementation(() => response([course]));
  const view = render(<CourseClient />);
  await screen.findByRole('heading', { name: course.title });
  const trigger = screen.getByRole('button', { name: 'Kursbereiche' });
  trigger.focus();
  await user.keyboard('{ArrowDown}');
  await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Lernpfade' })).toHaveFocus());
  const search = screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
  await user.click(search);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  expect(search).toHaveFocus();
  expect(global.fetch).toHaveBeenCalledTimes(1);

  await user.click(trigger);
  expect(await screen.findByRole('menuitem', { name: 'Lernpfade' })).toBeVisible();
  setSession('COMPANY');
  view.rerender(<CourseClient />);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await screen.findByRole('heading', { name: course.title });
  await user.click(screen.getByRole('button', { name: 'Kursbereiche' }));
  expect(await screen.findByRole('menu', { name: 'Kursbereiche' })).toBeVisible();
  expect(screen.queryByRole('menuitem', { name: 'Lernpfade' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Mein Lernweg' })).not.toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Neuer Kurs' })).toHaveAttribute('href', '/courses/new');
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('places the selected course and unlocked next action before figure controls and mission discovery', async () => {
  const user = userEvent.setup();
  journeyResponses();
  const view = render(<JourneyClient />);
  const next = await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  expect(next).toHaveAttribute('href', '/courses/qa-route-course/contents?content=qa-open');
  comesBefore(screen.getByText('Dein angemeldeter Kurs'), screen.getByRole('heading', { name: course.title }));
  comesBefore(screen.getByRole('status'), next);
  expect(screen.queryByRole('button', { name: 'Maskottchen anzeigen' })).not.toBeInTheDocument();
  const animation = screen.getByRole('button', { name: 'Figurenanimationen an' });
  comesBefore(next, animation);
  next.focus();
  await user.tab();
  expect(animation).toHaveFocus();
  comesBefore(next, screen.getByRole('link', { name: 'Space-Missionen entdecken' }));
  expect(screen.getByRole('status')).toHaveTextContent('0 von 2 Stationen bestätigt');
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  expect(view.container.querySelector('[data-journey-mascot]')).toBeInTheDocument();
  expect(view.container.querySelector('img[src*="forge-spark-blink"]')).toBeNull();
  expect(view.container.querySelector('[data-spark-celebration]')).toBeNull();
});

it.each([
  ['empty', [], 'Noch keine Stationen verfügbar'],
  ['locked', [locked], 'Gerade ist kein weiterer Inhalt frei.'],
] as const)('keeps the %s journey truthful and leaves its controls reachable', async (_state, contents, message) => {
  const user = userEvent.setup();
  journeyResponses([...contents]);
  render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Kurs ansehen' });
  expect(screen.getByText(message)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Lernschritt öffnen' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Maskottchen anzeigen' })).not.toBeInTheDocument();
  const animation = screen.getByRole('button', { name: 'Figurenanimationen an' });
  expect(animation).toBeEnabled();
  screen.getByRole('link', { name: 'Kurs ansehen' }).focus();
  await user.tab();
  expect(animation).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Space-Missionen entdecken' })).toBeInTheDocument();
  if (contents.length === 0) expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

it('retains figure preferences while a requested course refresh is pending', async () => {
  journeyResponses();
  render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  global.fetch = jest.fn().mockReturnValue(new Promise(() => {}));
  fireEvent.click(screen.getByRole('button', { name: 'Stand aktualisieren' }));
  expect(screen.getByRole('heading', { name: 'Lernschritte werden geprüft' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Figurenanimationen an' }));
  expect(window.localStorage.getItem('forge-journey-motion-off')).toBe('true');
  expect(screen.getByRole('button', { name: 'Figurenanimationen aus' })).toHaveAttribute('aria-pressed', 'false');
});
