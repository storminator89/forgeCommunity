import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ActivityFeed } from '@/components/profile/ActivityFeed';
import { ProjectsList } from '@/components/profile/ProjectsList';

const activity = {
  type: 'project', id: 'project-1', title: 'Gemeinsames Projekt',
  description: '<p>Lesbare Beschreibung</p>', createdAt: '2026-05-01T00:00:00.000Z',
  stats: { likes: 2, comments: 1 },
};
const project = {
  id: 'project-1', title: 'Gemeinsames Projekt', description: '<p>Lesbare Beschreibung</p>',
  imageUrl: '', link: 'https://example.com/demo', githubUrl: 'javascript:alert(1)',
  category: 'Design', tags: ['Figma'], createdAt: '2026-05-01T00:00:00.000Z',
  stats: { likes: 2, comments: 1 }, isLiked: false,
};

beforeEach(() => {
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).startsWith('/api/users/author/activity?')) return { ok: true, json: async () => ({ activities: [activity], pagination: { hasMore: false } }) } as Response;
    if (String(url).startsWith('/api/users/author/projects?')) return { ok: true, json: async () => ({ projects: [project], pagination: { hasMore: false } }) } as Response;
    if (String(url) === '/api/projects/project-1/like' && init?.method === 'POST') return { ok: true, json: async () => ({}) } as Response;
    return { ok: false } as Response;
  });
});

it('shows linked activity without nested paragraph markup or raw HTML tags', async () => {
  render(<ActivityFeed userId="author" />);
  expect(await screen.findByRole('link', { name: 'Gemeinsames Projekt' })).toHaveAttribute('href', '/projects/project-1');
  expect(screen.getByText('Lesbare Beschreibung')).toBeInTheDocument();
  expect(screen.queryByText('<p>Lesbare Beschreibung</p>')).not.toBeInTheDocument();
  expect(screen.getByText('2 Likes')).toBeInTheDocument();
});

it('keeps activity loading errors retryable', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));
  render(<ActivityFeed userId="author" />);
  expect(await screen.findByText('Aktivitäten konnten nicht geladen werden.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByRole('link', { name: 'Gemeinsames Projekt' })).toBeInTheDocument();
  errorSpy.mockRestore();
});

it('shows safe project destinations and updates the like toggle', async () => {
  render(<ProjectsList userId="author" isOwner={false} />);
  expect(await screen.findByRole('link', { name: 'Gemeinsames Projekt' })).toHaveAttribute('href', '/projects/project-1');
  expect(screen.getByRole('link', { name: /Demo/ })).toHaveAttribute('href', 'https://example.com/demo');
  expect(screen.queryByRole('link', { name: /Code/ })).not.toBeInTheDocument();
  expect(screen.getByText('Lesbare Beschreibung')).toBeInTheDocument();
  const like = screen.getByRole('button', { name: 'Projekt gefällt mir' });
  expect(like).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(like);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/projects/project-1/like', expect.objectContaining({ method: 'POST' })));
  expect(await screen.findByRole('button', { name: 'Gefällt mir zurücknehmen' })).toHaveAttribute('aria-pressed', 'true');
});

it('keeps project loading errors retryable', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));
  render(<ProjectsList userId="author" isOwner={false} />);
  expect(await screen.findByText('Projekte konnten nicht geladen werden.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByRole('link', { name: 'Gemeinsames Projekt' })).toBeInTheDocument();
  errorSpy.mockRestore();
});

it('gives owners a path to create their first project', async () => {
  jest.mocked(global.fetch).mockImplementation(async () => ({ ok: true, json: async () => ({ projects: [], pagination: { hasMore: false } }) } as Response));
  render(<ProjectsList userId="author" isOwner />);
  expect(await screen.findByText('Noch keine Projekte')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Projekt erstellen' })).toHaveAttribute('href', '/projects/new');
});
