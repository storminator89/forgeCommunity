import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfilePage from '@/app/profile/[id]/page';

let mockSession: { user: { id: string } } | null = { user: { id: 'viewer' } };

jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'author' }) }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession, status: mockSession ? 'authenticated' : 'unauthenticated' }) }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/profile/ProfileEditor', () => ({ ProfileEditor: ({ onUpdate }: { onUpdate: (data: { name: string }) => void }) => <button onClick={() => onUpdate({ name: 'Ada Neu' })}>Profil speichern</button> }));
jest.mock('@/components/profile/ActivityFeed', () => ({ ActivityFeed: () => <p>Aktivitätseinträge</p> }));
jest.mock('@/components/profile/ProjectsList', () => ({ ProjectsList: () => <p>Projektliste</p> }));
jest.mock('@/components/profile/FollowButton', () => ({ FollowButton: () => <button>Folgen</button> }));
jest.mock('@/components/profile/FollowersList', () => ({ FollowersList: ({ count, type }: { count: number; type: string }) => <button>{count} {type}</button> }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const profile = {
  id: 'author', name: 'Ada', image: null, coverImage: '/images/uploads/cover.png', bio: 'Ich baue Ideen.',
  title: 'Designerin', contact: 'public@example.org', role: 'USER', endorsements: 3,
  createdAt: '2026-01-01T00:00:00.000Z', lastLogin: undefined,
  isFollowing: false, isCurrentUser: false, hasEndorsed: false,
  socialLinks: { github: 'https://github.com/ada', website: 'javascript:alert(1)' },
  skills: [{ id: 'skill-1', name: 'Design', level: 80, endorsements: 2 }], badges: [],
  stats: { followers: 2, following: 1, posts: 4, courses: 0, projects: 3, articles: 0 },
};

beforeEach(() => {
  mockSession = { user: { id: 'viewer' } };
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/users/author') return { ok: true, json: async () => profile } as Response;
    if (String(url) === '/api/users/author/social') return { ok: true, json: async () => ({ socialLinks: profile.socialLinks }) } as Response;
    if (String(url) === '/api/members/author/endorse' && init?.method === 'POST') return { ok: true, json: async () => ({ message: 'Empfohlen' }) } as Response;
    return { ok: false, status: 500 } as Response;
  });
});

it('renders a readable profile with safe social links and working activity tabs', async () => {
  render(<ProfilePage />);
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
  expect(await screen.findByRole('heading', { name: 'Ada', level: 1 })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/ada');
  expect(screen.queryByRole('link', { name: /Website/ })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Über mich' })).toBeInTheDocument();
  expect(screen.queryByText(/Zuletzt angemeldet/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('tab', { name: /Projekte 3/ }));
  expect(screen.getByRole('tab', { name: /Projekte 3/ })).toHaveAttribute('data-state', 'active');
  expect(await screen.findByText('Projektliste')).toBeInTheDocument();
});

it('keeps loading failures inside the page and retries them', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let attempts = 0;
  jest.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL) => {
    if (String(url) === '/api/users/author') {
      attempts++;
      if (attempts === 1) throw new Error('offline');
      return { ok: true, json: async () => profile } as Response;
    }
    return { ok: true, json: async () => ({ socialLinks: profile.socialLinks }) } as Response;
  });
  render(<ProfilePage />);
  expect(await screen.findByText('Profil konnte nicht geladen werden')).toBeInTheDocument();
  expect(screen.getByRole('main')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByRole('heading', { name: 'Ada', level: 1 })).toBeInTheDocument();
  errorSpy.mockRestore();
});

it('still renders the profile if the supplemental social endpoint is offline', async () => {
  jest.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL) => {
    if (String(url) === '/api/users/author') return { ok: true, json: async () => profile } as Response;
    throw new Error('social offline');
  });
  render(<ProfilePage />);
  expect(await screen.findByRole('heading', { name: 'Ada', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /GitHub/ })).toBeInTheDocument();
});

it('shows a useful not-found state for a missing profile', async () => {
  jest.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL) => String(url) === '/api/users/author'
    ? { ok: false, status: 404 } as Response
    : { ok: true, json: async () => ({ socialLinks: {} }) } as Response);
  render(<ProfilePage />);
  expect(await screen.findByText('Profil nicht gefunden')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Zu den Mitgliedern' })).toHaveAttribute('href', '/members');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
});

it('lets an owner edit their profile and retains the in-page update', async () => {
  mockSession = { user: { id: 'author' } };
  jest.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL) => String(url) === '/api/users/author'
    ? { ok: true, json: async () => ({ ...profile, isCurrentUser: true, lastLogin: '2026-05-01T00:00:00.000Z' }) } as Response
    : { ok: true, json: async () => ({ socialLinks: profile.socialLinks }) } as Response);
  render(<ProfilePage />);
  expect(await screen.findByRole('heading', { name: 'Ada', level: 1 })).toBeInTheDocument();
  expect(screen.getByText(/Zuletzt angemeldet/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Profil bearbeiten' }));
  fireEvent.click(screen.getByRole('button', { name: 'Profil speichern' }));
  expect(screen.getByRole('heading', { name: 'Ada Neu', level: 1 })).toBeInTheDocument();
});

it('starts an endorsement only for eligible visitors and announces success', async () => {
  render(<ProfilePage />);
  fireEvent.click(await screen.findByRole('button', { name: 'Empfehlen' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/members/author/endorse', expect.objectContaining({ method: 'POST' })));
  expect(await screen.findByRole('button', { name: 'Bereits empfohlen' })).toBeDisabled();
  expect(screen.getByText('4', { selector: 'p' })).toBeInTheDocument();
});

it('removes owner-only profile fields and editing immediately on account switch and logout', async () => {
  mockSession = { user: { id: 'author' } };
  jest.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL) => String(url) === '/api/users/author'
    ? { ok: true, json: async () => mockSession?.user.id === 'author'
      ? { ...profile, isCurrentUser: true, lastLogin: '2026-05-01T00:00:00.000Z' }
      : { ...profile, isCurrentUser: false, lastLogin: undefined } } as Response
    : { ok: true, json: async () => ({ socialLinks: profile.socialLinks }) } as Response);
  const view = render(<ProfilePage />);
  expect(await screen.findByRole('button', { name: 'Profil bearbeiten' })).toBeInTheDocument();
  expect(screen.getByText(/Zuletzt angemeldet/)).toBeInTheDocument();

  mockSession = { user: { id: 'viewer' } };
  view.rerender(<ProfilePage />);
  expect(screen.queryByRole('button', { name: 'Profil bearbeiten' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Zuletzt angemeldet/)).not.toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Folgen' })).toBeInTheDocument();

  mockSession = null;
  view.rerender(<ProfilePage />);
  expect(screen.getByText('Anmeldung erforderlich')).toBeInTheDocument();
  expect(screen.queryByText(/Zuletzt angemeldet/)).not.toBeInTheDocument();
});

it('ignores a late owner profile response after another account signs in', async () => {
  mockSession = { user: { id: 'author' } };
  let resolveOwner!: (response: Response) => void;
  jest.mocked(global.fetch).mockImplementation((url: RequestInfo | URL) => {
    if (String(url) === '/api/users/author') {
      if (mockSession?.user.id === 'author') return new Promise<Response>(resolve => { resolveOwner = resolve; });
      return Promise.resolve({ ok: true, json: async () => ({ ...profile, isCurrentUser: false }) } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({ socialLinks: profile.socialLinks }) } as Response);
  });
  const view = render(<ProfilePage />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/users/author', expect.anything()));
  mockSession = { user: { id: 'viewer' } };
  view.rerender(<ProfilePage />);
  expect(await screen.findByRole('button', { name: 'Folgen' })).toBeInTheDocument();

  await act(async () => resolveOwner({ ok: true, json: async () => ({ ...profile, isCurrentUser: true, lastLogin: '2026-05-01T00:00:00.000Z' }) } as Response));
  expect(screen.queryByRole('button', { name: 'Profil bearbeiten' })).not.toBeInTheDocument();
  expect(screen.queryByText(/Zuletzt angemeldet/)).not.toBeInTheDocument();
});
