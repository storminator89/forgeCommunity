import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import JourneyClient from '@/app/courses/journey/JourneyClient';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt="" />;
  },
}));

const clipSelector = 'img[src^="/images/forge-spark-celebrate-once.webp?play="]';
let complete: boolean;
let publicationId: string;
let reduced: boolean;
let mediaListeners: Set<() => void>;
let holdProgress: (() => Promise<Response>) | undefined;

function session(role = 'USER', id = 'viewer') {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id, role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
}
function response(json: unknown) {
  return Promise.resolve({ ok: true, json: async () => json } as Response);
}
function progress() {
  return { completedContentIds: complete ? ['open'] : [], complete, canTrack: true, publicationId };
}
async function refresh() {
  fireEvent.click(screen.getByRole('button', { name: 'Stand aktualisieren' }));
  await screen.findByRole('button', { name: 'Stand aktualisieren' });
}
function changeReduced(value: boolean) {
  act(() => { reduced = value; mediaListeners.forEach(callback => callback()); });
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  complete = false;
  publicationId = 'pub-1';
  reduced = false;
  mediaListeners = new Set();
  holdProgress = undefined;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
    get matches() { return reduced; },
    addEventListener: (_: string, callback: () => void) => mediaListeners.add(callback),
    removeEventListener: (_: string, callback: () => void) => mediaListeners.delete(callback),
  }) });
  session();
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/courses') return response(['other', 'second'].map(id => ({ id, title: `Kurs ${id}`, isEnrolled: true, canDelete: false })));
    if (url.endsWith('/contents')) return response([
      { id: 'open', title: 'Freier Schritt', type: 'TEXT', order: 1, locked: false, publicationId, subContents: [] },
    ]);
    if (url.endsWith('/progress')) return holdProgress ? holdProgress() : response(progress());
    throw new Error(`Unexpected request ${url}`);
  });
});

it.each([
  ['visible, motion on', false, false, false, true],
  ['visible, motion off', false, true, false, false],
  ['hidden, motion on', true, false, false, false],
  ['hidden, motion off', true, true, false, false],
  ['visible, reduced motion', false, false, true, false],
  ['visible, both motion settings off', false, true, true, false],
  ['hidden, reduced motion', true, false, true, false],
  ['hidden, all motion off', true, true, true, false],
])('requests the clip only on a newly observed completion: %s', async (_label, hidden, motionOff, osReduced, expected) => {
  window.localStorage.setItem('forge-journey-mascot-hidden', String(hidden));
  window.localStorage.setItem('forge-journey-motion-off', String(motionOff));
  reduced = Boolean(osReduced);
  const view = render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  expect(view.container.querySelector(clipSelector)).toBeNull();
  complete = true;
  await refresh();
  expect(screen.getByRole('status')).toHaveTextContent('Alle aktuellen Kursinhalte bestätigt');
  expect(Boolean(view.container.querySelector(clipSelector))).toBe(expected);
  if (hidden) expect(view.container.querySelector('[data-journey-mascot]')).toBeNull();
  // A second read of the same complete state is not another completion.
  await refresh();
  expect(view.container.querySelector(clipSelector)).toBeNull();
});

it('never animates an initially complete course or an already complete new publication', async () => {
  complete = true;
  const view = render(<JourneyClient />);
  await screen.findByRole('button', { name: 'Stand aktualisieren' });
  expect(view.container.querySelector(clipSelector)).toBeNull();
  complete = false;
  await refresh();
  complete = true;
  publicationId = 'pub-2';
  await refresh();
  expect(view.container.querySelector(clipSelector)).toBeNull();
});

it('allocates only a local counter URL for eligible events and restarts the native resource for the next event', async () => {
  const view = render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  complete = true;
  await refresh();
  const first = new URL(view.container.querySelector(clipSelector)!.getAttribute('src')!, 'http://localhost');
  expect([...first.searchParams.keys()]).toEqual(['play']);
  expect(first.searchParams.get('play')).toMatch(/^[1-9]\d*$/);
  view.rerender(<JourneyClient />);
  expect(view.container.querySelector(clipSelector)).toHaveAttribute('src', first.pathname + first.search);
  await refresh();
  expect(view.container.querySelector(clipSelector)).toBeNull();

  // Completion while motion is disabled consumes no playback token and must
  // not be revived by re-enabling motion.
  fireEvent.click(screen.getByRole('button', { name: 'Figurenanimationen an' }));
  complete = false;
  await refresh();
  complete = true;
  await refresh();
  fireEvent.click(screen.getByRole('button', { name: 'Figurenanimationen aus' }));
  expect(view.container.querySelector(clipSelector)).toBeNull();
  complete = false;
  await refresh();
  complete = true;
  await refresh();
  const later = new URL(view.container.querySelector(clipSelector)!.getAttribute('src')!, 'http://localhost');
  expect([...later.searchParams.keys()]).toEqual(['play']);
  expect(Number(later.searchParams.get('play'))).toBe(Number(first.searchParams.get('play')) + 1);
  expect(later.href).not.toBe(first.href);
});

it.each(['visibility', 'motion', 'reduced', 'storage'])('consumes a celebration when %s changes, without replay on re-enable', async kind => {
  const view = render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  complete = true;
  await refresh();
  expect(view.container.querySelector(clipSelector)).toBeInTheDocument();
  if (kind === 'visibility') {
    fireEvent.click(screen.getByRole('button', { name: 'Maskottchen anzeigen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maskottchen anzeigen' }));
  } else if (kind === 'motion') {
    fireEvent.click(screen.getByRole('button', { name: 'Figurenanimationen an' }));
    fireEvent.click(screen.getByRole('button', { name: 'Figurenanimationen aus' }));
  } else if (kind === 'reduced') {
    changeReduced(true);
    changeReduced(false);
  } else {
    act(() => {
      window.localStorage.setItem('forge-journey-motion-off', 'true');
      window.dispatchEvent(new StorageEvent('storage', { key: 'forge-journey-motion-off' }));
    });
    act(() => {
      window.localStorage.setItem('forge-journey-motion-off', 'false');
      window.dispatchEvent(new StorageEvent('storage', { key: 'forge-journey-motion-off' }));
    });
  }
  expect(view.container.querySelector(clipSelector)).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Alle aktuellen Kursinhalte bestätigt');
});

it('checks current preferences when a delayed completion response arrives', async () => {
  const view = render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  let settle!: (response: Response) => void;
  holdProgress = () => new Promise(resolve => { settle = resolve; });
  fireEvent.click(screen.getByRole('button', { name: 'Stand aktualisieren' }));
  fireEvent.click(screen.getByRole('button', { name: 'Figurenanimationen an' }));
  complete = true;
  await act(async () => settle(await response(progress())));
  await screen.findByRole('button', { name: 'Stand aktualisieren' });
  expect(view.container.querySelector(clipSelector)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Figurenanimationen aus' }));
  expect(view.container.querySelector(clipSelector)).toBeNull();
});

it('discards a previous course completion response after a new selection settles', async () => {
  const view = render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  let settle!: (response: Response) => void;
  holdProgress = () => new Promise(resolve => { settle = resolve; });
  fireEvent.click(screen.getByRole('button', { name: 'Stand aktualisieren' }));
  holdProgress = undefined;
  complete = true;
  fireEvent.change(screen.getByRole('combobox', { name: 'Kurs auswählen' }), { target: { value: 'second' } });
  await screen.findByRole('button', { name: 'Stand aktualisieren' });
  await act(async () => settle(await response(progress())));
  expect(screen.getByRole('combobox', { name: 'Kurs auswählen' })).toHaveValue('second');
  expect(view.container.querySelector(clipSelector)).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Alle aktuellen Kursinhalte bestätigt');
});

it('discards late responses after course selection and role/account changes', async () => {
  const view = render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  let settle!: (response: Response) => void;
  holdProgress = () => new Promise(resolve => { settle = resolve; });
  fireEvent.click(screen.getByRole('button', { name: 'Stand aktualisieren' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Kurs auswählen' }), { target: { value: 'second' } });
  session('ADMIN');
  view.rerender(<JourneyClient />);
  complete = true;
  await act(async () => settle(await response(progress())));
  expect(view.container.querySelector(clipSelector)).toBeNull();
  expect(screen.getByRole('heading', { name: 'Lernweg für Lernende' })).toBeInTheDocument();
  session('USER', 'new-account');
  holdProgress = undefined;
  view.rerender(<JourneyClient />);
  await screen.findByRole('button', { name: 'Stand aktualisieren' });
  expect(view.container.querySelector(clipSelector)).toBeNull();
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Alle aktuellen Kursinhalte bestätigt'));
});
