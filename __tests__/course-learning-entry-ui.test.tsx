import { fireEvent, render, screen, within } from '@testing-library/react';
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
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
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
  releaseLocked: false, publicationId: 'qa-publication', subContents: [] };
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
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/courses') return response([course]);
    if (url.endsWith('/contents')) return response(contents);
    if (url.endsWith('/progress')) return response({ completedContentIds: [], complete: false, canTrack: true, publicationId: 'qa-publication' });
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
  global.fetch = jest.fn().mockImplementation(() => response([course]));
  render(<CourseClient />);
  const title = await screen.findByRole('heading', { name: course.title });
  const search = screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' });
  const navigation = screen.getByRole('navigation', { name: 'Weitere Kursbereiche' });
  comesBefore(search, title);
  comesBefore(search, navigation);
  comesBefore(navigation, title);
  expect(screen.queryByText('Wissen teilen. Gemeinsam weiterkommen.')).not.toBeInTheDocument();
  for (const [name, href] of [
    ['Mein Lernweg', '/courses/journey'], ['Lernpfade', '/courses/pathways'], ['Mein Lernziel', '/courses/goals'],
    ['Meine Kursentwürfe', '/courses/authoring'], ['Neuer Kurs', '/courses/new'],
  ]) expect(within(navigation).getByRole('link', { name })).toHaveAttribute('href', href);
  expect(screen.getByRole('button', { name: 'Kurs öffnen' })).toBeEnabled();
});

it.each(['USER', 'MODERATOR', 'INSTRUCTOR', 'ADMIN'])('keeps one new-course route for %s without changing access', async role => {
  setSession(role);
  global.fetch = jest.fn().mockImplementation(() => response([course]));
  render(<CourseClient />);
  await screen.findByRole('heading', { name: course.title });
  expect(screen.getAllByRole('link', { name: 'Neuer Kurs' })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Meine Kursentwürfe' })).toHaveAttribute('href', '/courses/authoring');
});

it('places the selected course and unlocked next action before figure controls and mission discovery', async () => {
  journeyResponses();
  const view = render(<JourneyClient />);
  const next = await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  expect(next).toHaveAttribute('href', '/courses/qa-route-course/contents?content=qa-open');
  comesBefore(screen.getByRole('combobox', { name: 'Kurs auswählen' }), screen.getByRole('heading', { name: course.title }));
  comesBefore(screen.getByRole('status'), next);
  comesBefore(next, screen.getByRole('button', { name: 'Maskottchen anzeigen' }));
  comesBefore(next, screen.getByRole('link', { name: 'Space-Missionen entdecken' }));
  expect(screen.getByRole('status')).toHaveTextContent('0 von 2 Inhalten aktuell bestätigt');
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  expect(view.container.querySelector('[data-journey-mascot]')).toBeInTheDocument();
  expect(view.container.querySelector('img[src*="forge-spark-blink"]')).toBeNull();
  expect(view.container.querySelector('[data-spark-celebration]')).toBeNull();
});

it.each([
  ['empty', [], 'Noch keine Kursinhalte verfügbar'],
  ['locked', [locked], 'Gerade ist kein weiterer Inhalt frei.'],
] as const)('keeps the %s journey truthful and leaves its controls reachable', async (_state, contents, message) => {
  journeyResponses([...contents]);
  render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Kurs ansehen' });
  expect(screen.getByText(message)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Lernschritt öffnen' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Maskottchen anzeigen' })).toBeEnabled();
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
