import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProjectDetail from '@/app/projects/[projectId]/page';

const mockPush = jest.fn();
let mockSession: { user: { id: string } } | null = { user: { id: 'viewer' } };

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('next/navigation', () => ({ useParams: () => ({ projectId: 'project-1' }), useRouter: () => ({ push: mockPush }) }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession, status: mockSession ? 'authenticated' : 'unauthenticated' }) }));

const project = {
  id: 'project-1', title: 'Ein Projekt', description: '<p>Lesbarer Inhalt</p>', category: 'Design',
  link: 'https://example.com/projekt', imageUrl: null, createdAt: '2026-05-01T10:00:00.000Z',
  author: { id: 'author', name: 'Ada', image: null }, tags: [{ id: 'tag-1', name: 'Figma' }],
  likes: [], comments: [],
};

beforeEach(() => {
  mockPush.mockClear();
  mockSession = { user: { id: 'viewer' } };
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

it('clears Alice’s unsent comment and edit dialog before Bob sees the project', async () => {
  mockSession = { user: { id: 'author' } };
  const view = render(<ProjectDetail />);
  await screen.findByRole('heading', { name: 'Ein Projekt', level: 1 });
  fireEvent.change(screen.getByRole('textbox', { name: 'Dein Kommentar zum Projekt' }), { target: { value: 'Alice private comment' } });
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  const editor = screen.getByRole('dialog', { name: 'Projekt bearbeiten' });
  fireEvent.change(within(editor).getByRole('textbox', { name: 'Titel' }), { target: { value: 'Alice private edit' } });

  mockSession = { user: { id: 'bob' } };
  view.rerender(<ProjectDetail />);
  expect(screen.queryByRole('dialog', { name: 'Projekt bearbeiten' })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Alice private comment')).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue('Alice private edit')).not.toBeInTheDocument();

  await screen.findByRole('heading', { name: 'Ein Projekt', level: 1 });
  expect(screen.getByRole('textbox', { name: 'Dein Kommentar zum Projekt' })).toHaveValue('');
  expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();

  mockSession = null;
  view.rerender(<ProjectDetail />);
  expect(screen.queryByRole('textbox', { name: 'Dein Kommentar zum Projekt' })).not.toBeInTheDocument();
});

it('ignores Alice’s late project response after Bob signs in', async () => {
  let resolveAlice!: (value: Response) => void;
  const aliceResponse = new Promise<Response>(resolve => { resolveAlice = resolve; });
  mockSession = { user: { id: 'author' } };
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/projects/project-1') return mockSession?.user.id === 'author'
      ? aliceResponse
      : Promise.resolve({ ok: true, json: async () => ({ ...project, title: 'Bob copy' }) } as Response);
    if (url.startsWith('/api/projects/project-1/comments?')) return Promise.resolve({ ok: true, json: async () => [] } as Response);
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const view = render(<ProjectDetail />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/projects/project-1', expect.objectContaining({ signal: expect.any(AbortSignal) })));

  mockSession = { user: { id: 'bob' } };
  view.rerender(<ProjectDetail />);
  expect(await screen.findByRole('heading', { name: 'Bob copy', level: 1 })).toBeInTheDocument();

  await act(async () => {
    resolveAlice({ ok: true, json: async () => ({ ...project, title: 'Alice stale copy' }) } as Response);
    await aliceResponse;
  });
  expect(screen.getByRole('heading', { name: 'Bob copy', level: 1 })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Alice stale copy', level: 1 })).not.toBeInTheDocument();
});
