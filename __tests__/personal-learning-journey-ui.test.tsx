import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from '@/lib/sites-auth/react';
import { setSparkVisible } from '@/hooks/useSparkVisibility';
import JourneyClient from '@/app/courses/journey/JourneyClient';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/app/courses/journey/JourneyMascot', () => ({ JourneyMascot: () => <div data-testid="journey-mascot" /> }));

function session(role: string, id = 'viewer') {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id, role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
}

function response(json: unknown) {
  return Promise.resolve({ ok: true, json: async () => json } as Response);
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({
    matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn(),
  }) });
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  session('USER');
});

it.each(['ADMIN', 'INSTRUCTOR'])('does not request learner data for a direct %s visit', role => {
  session(role);
  global.fetch = jest.fn();
  render(<JourneyClient />);
  expect(screen.getByRole('heading', { name: 'Lernweg für Lernende' })).toBeVisible();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(screen.queryByRole('link', { name: 'Lernschritt öffnen' })).not.toBeInTheDocument();
});

it('keeps an enrolled own course out of the journey', async () => {
  global.fetch = jest.fn().mockImplementation(() => response([
    { id: 'own', title: 'Eigener Kurs', isEnrolled: true, completed: false, canDelete: true },
  ]));
  render(<JourneyClient />);
  expect(await screen.findByRole('heading', { name: 'Dein Lernweg beginnt mit einem Kurs' })).toBeVisible();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link', { name: 'Lernschritt öffnen' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Space-Missionen entdecken' })).toHaveAttribute('href', '/community/missions');
  expect(screen.getByRole('link', { name: 'Gemerkte Space-Missionen' })).toHaveAttribute('href', '/community/missions?view=saved');
});

it('keeps mission discovery available when course loading fails', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<JourneyClient />);
  expect(await screen.findByRole('heading', { name: 'Deine Kurse konnten nicht geladen werden' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Space-Missionen entdecken' })).toHaveAttribute('href', '/community/missions');
  expect(screen.getByRole('link', { name: 'Gemerkte Space-Missionen' })).toHaveAttribute('href', '/community/missions?view=saved');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('recommends only a server-open step, then purges it on a role refresh', async () => {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/courses') return response([
      { id: 'other', title: 'Anderer Kurs', isEnrolled: true, completed: false, canDelete: false },
    ]);
    if (url === '/api/courses/other/contents') return response([
      { id: 'locked', title: 'Gesperrt', type: 'TEXT', order: 1, locked: true, publicationId: 'pub-1', subContents: [] },
      { id: 'open', title: 'Freier Schritt', type: 'TEXT', order: 2, locked: false, publicationId: 'pub-1', subContents: [] },
    ]);
    if (url === '/api/courses/other/progress') return response({
      completedContentIds: [], complete: false, canTrack: true, publicationId: 'pub-1',
    });
    throw new Error(`Unexpected request ${url}`);
  });
  const view = render(<JourneyClient />);
  expect(await screen.findByRole('link', { name: 'Lernschritt öffnen' }))
    .toHaveAttribute('href', '/courses/other/contents?content=open');
  session('ADMIN');
  view.rerender(<JourneyClient />);
  expect(screen.getByRole('heading', { name: 'Lernweg für Lernende' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Lernschritt öffnen' })).not.toBeInTheDocument();
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
});

it('keeps the decorative figure hidden across visits without changing the motion preference', async () => {
  window.localStorage.setItem('forge-journey-mascot-hidden', 'true');
  window.localStorage.setItem('forge-journey-motion-off', 'true');
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/courses') return response([
      { id: 'other', title: 'Anderer Kurs', isEnrolled: true, completed: false, canDelete: false },
    ]);
    if (url === '/api/courses/other/contents') return response([
      { id: 'open', title: 'Freier Schritt', type: 'TEXT', order: 1, locked: false, publicationId: 'pub-1', subContents: [] },
    ]);
    if (url === '/api/courses/other/progress') return response({
      completedContentIds: [], complete: false, canTrack: true, publicationId: 'pub-1',
    });
    throw new Error(`Unexpected request ${url}`);
  });

  const view = render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  expect(screen.queryByRole('button', { name: 'Maskottchen anzeigen' })).not.toBeInTheDocument();
  expect(screen.queryByTestId('journey-mascot')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Figurenanimationen/ })).not.toBeInTheDocument();

  act(() => setSparkVisible(true));
  expect(screen.getByTestId('journey-mascot')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Figurenanimationen/ })).toHaveAttribute('aria-pressed', 'false');
  act(() => setSparkVisible(false));
  expect(screen.queryByTestId('journey-mascot')).not.toBeInTheDocument();
  expect(window.localStorage.getItem('forge-journey-mascot-hidden')).toBe('true');
  expect(window.localStorage.getItem('forge-journey-motion-off')).toBe('true');

  view.unmount();
  render(<JourneyClient />);
  await screen.findByRole('link', { name: 'Lernschritt öffnen' });
  expect(screen.queryByTestId('journey-mascot')).not.toBeInTheDocument();
});
