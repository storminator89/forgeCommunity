import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProjectDetail from '@/app/projects/[projectId]/page';

const mockPush = jest.fn();

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('next/navigation', () => ({ useParams: () => ({ projectId: 'project-1' }), useRouter: () => ({ push: mockPush }) }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'viewer' } } }) }));

const project = {
  id: 'project-1', title: 'Ein Projekt', description: '<p>Lesbarer Inhalt</p>', category: 'Design',
  link: 'https://example.com/projekt', imageUrl: null, createdAt: '2026-05-01T10:00:00.000Z',
  author: { id: 'author', name: 'Ada', image: null }, tags: [{ id: 'tag-1', name: 'Figma' }],
  likes: [], comments: [],
};

beforeEach(() => {
  mockPush.mockClear();
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/projects/project-1' && !init?.method) return { ok: true, json: async () => project } as Response;
    if (url.startsWith('/api/projects/project-1/comments?')) return { ok: true, json: async () => [] } as Response;
    if (url.endsWith('/like') && init?.method === 'POST') return { ok: true, json: async () => ({ id: 'like-1', userId: 'viewer', projectId: 'project-1', createdAt: new Date().toISOString() }) } as Response;
    return { ok: false, json: async () => ({ error: 'Testfehler' }) } as Response;
  });
});

it('provides one project title and a readable main landmark throughout loading and success', async () => {
  render(<ProjectDetail />);
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
  expect(await screen.findByRole('heading', { name: 'Ein Projekt', level: 1 })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Zur Projektübersicht' })).toHaveAttribute('href', '/showcases');
  expect(screen.getByText('Lesbarer Inhalt')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'https://example.com/projekt' })).toHaveAttribute('href', 'https://example.com/projekt');
  expect(screen.getByText('Noch keine Kommentare.')).toBeInTheDocument();
});

it('keeps a failed project in the shell with a retry', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));
  render(<ProjectDetail />);
  expect(await screen.findByText('Projekt nicht verfügbar')).toBeInTheDocument();
  expect(mockPush).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByRole('heading', { name: 'Ein Projekt', level: 1 })).toBeInTheDocument();
  errorSpy.mockRestore();
});

it('keeps the project like action as an accessible pressed state', async () => {
  render(<ProjectDetail />);
  const like = await screen.findByRole('button', { name: 'Projekt gefällt mir' });
  expect(like).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(like);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/projects/project-1/like', { method: 'POST' }));
  expect(await screen.findByRole('button', { name: 'Gefällt mir zurücknehmen' })).toHaveAttribute('aria-pressed', 'true');
});
