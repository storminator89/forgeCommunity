import { act, fireEvent, render, screen } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import Home from '@/app/page';
import Community from '@/app/community/page';
import JourneyClient from '@/app/courses/journey/JourneyClient';
import { setSparkVisible } from '@/hooks/useSparkVisibility';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/landing/ForgeWorkbench', () => ({ ForgeWorkbench: () => null }));
jest.mock('@/components/community/StatsCard', () => ({ StatsCard: () => null }));
jest.mock('@/components/community/LeaderboardCard', () => ({ LeaderboardCard: () => null }));
jest.mock('@/components/community/ContributionMilestonesCard', () => ({ ContributionMilestonesCard: () => null }));
jest.mock('@/hooks/usePrivateContributions', () => ({ usePrivateContributions: () => ({ summary: null, loading: false, error: false, refresh: jest.fn() }) }));
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ unoptimized: _unoptimized, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img {...props} alt="" />;
  },
}));

function viewer(id: string | null = 'spark-member', role = 'USER') {
  jest.mocked(useSession).mockReturnValue({ data: id ? { user: { id, role }, expires: '2099-01-01' } : null,
    status: id ? 'authenticated' : 'unauthenticated', update: jest.fn() } as ReturnType<typeof useSession>);
}
const staticFigure = (container: HTMLElement) => container.querySelector('[data-spark-entry-figure] img');

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  setSparkVisible(true);
  window.localStorage.clear();
  viewer();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) });
  global.fetch = jest.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.startsWith('/api/posts?')
    ? { posts: [], nextCursor: null } : url === '/api/posts/me/stats' ? { posts: 0, comments: 0, receivedLikes: 0 } : [] }));
});

it('shows real static Spark at the public entry while preserving the main CTA', () => {
  viewer(null);
  const view = render(<Home />);
  expect(staticFigure(view.container)).toHaveAttribute('src', '/images/forge-spark-preview.webp');
  expect(screen.getByRole('link', { name: 'Konto erstellen' })).toHaveAttribute('href', '/register');
  expect(screen.getByRole('navigation', { name: 'Bereiche' }).querySelectorAll('a')).toHaveLength(6);
  expect(screen.getByRole('banner').querySelector('[data-spark-entry]')).toBeNull();
});

it('keeps the public Off choice when entering the signed-in feed', async () => {
  const home = render(<Home />);
  fireEvent.click(screen.getByRole('button', { name: 'Spark ausblenden' }));
  home.unmount();
  const member = render(<Community />);
  expect(screen.getByRole('button', { name: 'Spark anzeigen' })).toBeVisible();
  expect(staticFigure(member.container)).toBeNull();
  expect(screen.getByRole('button', { name: 'Neuen Beitrag erstellen' })).toBeVisible();
  await act(async () => {});
});

it('shows Spark to a signed-in member without adding a control to the shared header', async () => {
  const view = render(<Community />);
  expect(staticFigure(view.container)).toHaveAttribute('src', '/images/forge-spark-preview.webp');
  expect(screen.getByRole('button', { name: 'Neuen Beitrag erstellen' })).toBeVisible();
  expect(screen.getByRole('banner').querySelector('[data-spark-entry]')).toBeNull();
  await act(async () => {});
  viewer(null);
  view.rerender(<Community />);
  expect(staticFigure(view.container)).toBeNull();
  await act(async () => {});
});

it('shows a neutral Spark only after the genuine zero-enrollment request succeeds', async () => {
  let resolve!: (value: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>(settle => { resolve = settle; }));
  const view = render(<JourneyClient />);
  expect(staticFigure(view.container)).toBeNull();
  expect(screen.getByRole('heading', { name: 'Deine Kurse werden geladen' })).toBeVisible();
  await act(async () => resolve({ ok: true, json: async () => [] } as Response));
  expect(await screen.findByRole('heading', { name: 'Dein Lernweg beginnt mit einem Kurs' })).toBeVisible();
  expect(staticFigure(view.container)).toHaveAttribute('src', '/images/forge-spark-preview.webp');
  expect(screen.getByText('Hier erscheinen deine angemeldeten Kurse anderer Lehrkräfte.')).toBeVisible();
  const discover = screen.getByRole('link', { name: 'Kurse entdecken' });
  expect(discover).toHaveAttribute('href', '/courses');
  expect(view.container.querySelector('[data-spark-celebration]')).toBeNull();
  fireEvent.error(staticFigure(view.container)!);
  expect(discover).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Maskottchen anzeigen' }));
  expect(staticFigure(view.container)).toBeNull();
});

it('keeps a saved Off choice in the zero-enrollment state and preserves reduced-motion static visibility', async () => {
  window.localStorage.setItem('forge-journey-mascot-hidden', 'true');
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() }) });
  const view = render(<JourneyClient />);
  await screen.findByRole('heading', { name: 'Dein Lernweg beginnt mit einem Kurs' });
  expect(staticFigure(view.container)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Maskottchen anzeigen' }));
  expect(staticFigure(view.container)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Figurenanimationen aus' })).toBeDisabled();
  expect(view.container.querySelector('[data-spark-celebration]')).toBeNull();
});

it('leaves request errors and staff-role guidance without a new figure', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  const view = render(<JourneyClient />);
  await screen.findByRole('heading', { name: 'Deine Kurse konnten nicht geladen werden' });
  expect(staticFigure(view.container)).toBeNull();
  viewer('spark-member', 'INSTRUCTOR');
  view.rerender(<JourneyClient />);
  expect(screen.getByRole('heading', { name: 'Lernweg für Lernende' })).toBeVisible();
  expect(staticFigure(view.container)).toBeNull();
});
