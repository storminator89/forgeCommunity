import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ShowcaseDirectory from '@/app/showcases/page';

let mockSession: { user: { id: string } } | null = null;

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession }) }));
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Beschreibungstext" value={content} onChange={event => onChange(event.target.value)} /> }));

const project = {
  id: 'project-1', title: 'Offenes Projekt', description: '<p>Ein lesbarer Text.</p>', category: 'Design',
  link: 'https://example.com', imageUrl: null, createdAt: '2026-05-01T10:00:00.000Z', updatedAt: '2026-05-01T10:00:00.000Z',
  gradientFrom: '#000', gradientTo: '#fff', author: { id: 'author', name: 'Ada', image: null },
  tags: [{ id: 'tag-1', name: 'Figma' }], likes: [], comments: [],
};

beforeEach(() => {
  mockSession = null;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/projects?page=1') return { ok: true, json: async () => [project] } as Response;
    if (String(url) === '/api/projects/project-1' && init?.method === 'DELETE') return { ok: true, json: async () => ({}) } as Response;
    return { ok: false, json: async () => ({ error: 'Testfehler' }) } as Response;
  });
});

it('keeps project navigation, search, filters, and view choice accessible', async () => {
  render(<ShowcaseDirectory />);
  expect(await screen.findByRole('link', { name: 'Offenes Projekt' })).toHaveAttribute('href', '/projects/project-1');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
  expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute('href', '#page-content');
  expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute('href', '/profile/author');
  expect(screen.getByText('1 Projekt')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Listenansicht' }));
  expect(screen.getByRole('button', { name: 'Listenansicht' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.change(screen.getByLabelText('Projekte suchen'), { target: { value: 'kein Treffer' } });
  expect(screen.getByText('Keine Projekte gefunden')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  expect(screen.getByRole('link', { name: 'Offenes Projekt' })).toBeInTheDocument();
});

it('shows a retry instead of treating a network error as an empty list', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));
  render(<ShowcaseDirectory />);
  expect(await screen.findByText('Projekte konnten nicht geladen werden')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByRole('link', { name: 'Offenes Projekt' })).toBeInTheDocument();
  errorSpy.mockRestore();
});

it('lets an owner edit and confirms deletion before sending the request', async () => {
  mockSession = { user: { id: 'author' } };
  render(<ShowcaseDirectory />);
  await screen.findByRole('link', { name: 'Offenes Projekt' });
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  const editDialog = await screen.findByRole('dialog', { name: 'Projekt bearbeiten' });
  expect(within(editDialog).getByLabelText('Beschreibungstext')).toHaveValue(project.description);
  fireEvent.click(within(editDialog).getByRole('button', { name: 'Abbrechen' }));
  fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
  const deleteDialog = await screen.findByRole('dialog', { name: 'Projekt löschen' });
  expect(global.fetch).not.toHaveBeenCalledWith('/api/projects/project-1', expect.objectContaining({ method: 'DELETE' }));
  fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Projekt löschen' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/projects/project-1', { method: 'DELETE' }));
  expect(await screen.findByText('Noch keine Projekte')).toBeInTheDocument();
});

it('keeps comma-separated tags editable in the project form', async () => {
  mockSession = { user: { id: 'author' } };
  jest.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/projects?page=1') return { ok: true, json: async () => [project] } as Response;
    if (String(url) === '/api/projects/project-1' && init?.method === 'PUT') return { ok: true, json: async () => project } as Response;
    return { ok: false, json: async () => ({ error: 'Testfehler' }) } as Response;
  });
  render(<ShowcaseDirectory />);
  await screen.findByRole('link', { name: 'Offenes Projekt' });
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  const dialog = await screen.findByRole('dialog', { name: 'Projekt bearbeiten' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Tags' }), { target: { value: 'React, Figma' } });
  expect(within(dialog).getByRole('textbox', { name: 'Tags' })).toHaveValue('React, Figma');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Projekt aktualisieren' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/projects/project-1', expect.objectContaining({ method: 'PUT' })));
  const [, options] = jest.mocked(global.fetch).mock.calls.find(([url, init]) => String(url) === '/api/projects/project-1' && init?.method === 'PUT')!;
  expect((options?.body as FormData).get('tags')).toBe('React,Figma');
});

it('offers keyboard-sized tag controls and an inline validation message in the submit dialog', async () => {
  mockSession = { user: { id: 'author' } };
  render(<ShowcaseDirectory />);
  await screen.findByRole('link', { name: 'Offenes Projekt' });
  fireEvent.click(screen.getByRole('button', { name: 'Projekt einreichen' }));
  const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt einreichen' });
  fireEvent.change(within(dialog).getByLabelText('Tags'), { target: { value: ' React ' } });
  fireEvent.keyDown(within(dialog).getByLabelText('Tags'), { key: 'Enter' });
  expect(within(dialog).getByRole('button', { name: 'Tag React entfernen' })).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tag React entfernen' }));
  expect(within(dialog).queryByRole('button', { name: 'Tag React entfernen' })).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Titel' }), { target: { value: 'Testprojekt' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Projekt-Link' }), { target: { value: 'https://example.com' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Projekt einreichen' }));
  expect(within(dialog).getByRole('alert')).toHaveTextContent('Bitte fülle alle erforderlichen Felder aus.');
});

it('submits the existing multipart project contract from the directory dialog', async () => {
  mockSession = { user: { id: 'author' } };
  jest.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/projects?page=1') return { ok: true, json: async () => [project] } as Response;
    if (String(url) === '/api/projects' && init?.method === 'POST') return { ok: true, json: async () => ({ ...project, id: 'project-2', title: 'Neues Projekt' }) } as Response;
    return { ok: false, json: async () => ({ error: 'Testfehler' }) } as Response;
  });
  HTMLElement.prototype.scrollIntoView = jest.fn();
  HTMLElement.prototype.hasPointerCapture = () => false;
  render(<ShowcaseDirectory />);
  await screen.findByRole('link', { name: 'Offenes Projekt' });
  fireEvent.click(screen.getByRole('button', { name: 'Projekt einreichen' }));
  const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt einreichen' });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Titel' }), { target: { value: 'Neues Projekt' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Beschreibungstext' }), { target: { value: '<p>Eine Beschreibung.</p>' } });
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Projekt-Link' }), { target: { value: 'https://example.com/neues-projekt' } });
  fireEvent.click(within(dialog).getByRole('combobox', { name: 'Kategorie' }));
  fireEvent.click(await screen.findByRole('option', { name: 'Webentwicklung' }));
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Tags' }), { target: { value: 'React' } });
  fireEvent.keyDown(within(dialog).getByRole('textbox', { name: 'Tags' }), { key: 'Enter' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Projekt einreichen' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ method: 'POST' })));
  const [, options] = jest.mocked(global.fetch).mock.calls.find(([url, init]) => String(url) === '/api/projects' && init?.method === 'POST')!;
  expect((options?.body as FormData).get('category')).toBe('Webentwicklung');
  expect((options?.body as FormData).get('tags')).toBe('React');
  expect(await screen.findByRole('link', { name: 'Neues Projekt' })).toHaveAttribute('href', '/projects/project-2');
});

it('updates unlike state when the API returns only its confirmation message', async () => {
  mockSession = { user: { id: 'viewer' } };
  jest.mocked(global.fetch).mockImplementation(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === '/api/projects?page=1') return { ok: true, json: async () => [{ ...project, likes: [{ id: 'like-1', userId: 'viewer', projectId: project.id, createdAt: project.createdAt }] }] } as Response;
    if (String(url) === '/api/projects/project-1/like' && init?.method === 'DELETE') return { ok: true, json: async () => ({ message: 'Like entfernt' }) } as Response;
    return { ok: false, json: async () => ({ error: 'Testfehler' }) } as Response;
  });
  render(<ShowcaseDirectory />);
  const unlike = await screen.findByRole('button', { name: 'Gefällt mir zurücknehmen' });
  expect(unlike).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(unlike);
  expect(await screen.findByRole('button', { name: 'Projekt gefällt mir' })).toHaveAttribute('aria-pressed', 'false');
});

it('offers a sign-in path when a visitor tries to like a project', async () => {
  render(<ShowcaseDirectory />);
  fireEvent.click(await screen.findByRole('button', { name: 'Projekt gefällt mir' }));
  expect(screen.getByRole('link', { name: 'Zur Anmeldung' })).toHaveAttribute('href', '/login?callbackUrl=%2Fshowcases');
});
