import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SearchPageClient from '@/app/search/SearchPageClient';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, exit, transition, ...props }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => (
      <div {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
}));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
let mockViewerId: string | null = 'viewer';
jest.mock('next-auth/react', () => ({ useSession: () => ({
  data: mockViewerId ? { user: { id: mockViewerId } } : null,
  status: mockViewerId ? 'authenticated' : 'unauthenticated',
}) }));
const mockToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

const results = [
  { id: 'course-1', title: 'Kurs Alpha', description: '', type: 'course', stats: { enrollments: 2 } },
  { id: 'event-1', title: 'Event Beta', description: '', type: 'event', stats: { attendees: 3 } },
  { id: 'member-1', title: 'Mitglied Gamma', description: '', type: 'member', stats: { followers: 1, posts: 0, courses: 0 } },
  { id: 'post-1', title: 'Beitrag Delta', description: '', type: 'post', stats: { likes: 0, comments: 0 } },
  { id: 'resource-1', title: 'Ressource Epsilon', description: '', type: 'resource', url: 'https://example.com/guide' },
  { id: 'resource-2', title: 'Unsichere Ressource', description: '', type: 'resource', url: 'javascript:alert(1)' },
  { id: 'article-1', title: 'Wissensartikel Zeta', description: 'Wissen', type: 'article' },
  { id: 'project-1', title: 'Projekt Eta', description: 'Projekt', type: 'project' },
  { id: 'skill-1', title: 'TypeScript & React', description: 'Fähigkeit im Skill-Verzeichnis', type: 'skill', category: 'Technik' },
];

beforeEach(() => {
  mockViewerId = 'viewer';
  window.history.replaceState({}, '', '/search?q=Alpha');
  (global.fetch as jest.Mock).mockReset();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({ results, pagination: { total: results.length, page: 1, limit: 10, pages: 2 } }),
  });
});

it('renders focusable result links with the existing destinations and safe external navigation', async () => {
  const user = userEvent.setup();
  render(<SearchPageClient initialQuery="Alpha" />);

  const course = await screen.findByRole('link', { name: /Kurs Alpha/ });
  expect(screen.getByRole('heading', { name: 'Ergebnisse (9)' })).toBeInTheDocument();
  expect(course).toHaveAttribute('href', '/courses/course-1');
  expect(screen.getByRole('link', { name: /Event Beta/ })).toHaveAttribute('href', '/events#event-event-1');
  expect(screen.getByRole('link', { name: /Mitglied Gamma/ })).toHaveAttribute('href', '/profile/member-1');
  expect(screen.getByRole('link', { name: /Beitrag Delta/ })).toHaveAttribute('href', '/community#post-post-1');
  expect(screen.getByRole('link', { name: /Ressource Epsilon/ })).toHaveAttribute('href', 'https://example.com/guide');
  expect(screen.getByRole('link', { name: /Ressource Epsilon/ })).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: /Ressource Epsilon/ })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByRole('link', { name: /Ressource Epsilon.*öffnet in neuem Tab/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Unsichere Ressource/ })).toHaveAttribute('href', '/resources');
  expect(screen.getByRole('link', { name: /Wissensartikel Zeta/ })).toHaveAttribute('href', '/knowledgebase/article-1');
  expect(screen.getByRole('link', { name: /Projekt Eta/ })).toHaveAttribute('href', '/projects/project-1');
  expect(screen.getByRole('link', { name: /TypeScript & React/ })).toHaveAttribute('href', '/skills?query=TypeScript%20%26%20React');
  expect(screen.getByText(/Bis zu fünf Treffer je Kategorie/)).toBeInTheDocument();

  let reachedWithTab = false;
  for (let index = 0; index < 12; index += 1) {
    await user.tab();
    if (document.activeElement === course) {
      reachedWithTab = true;
      break;
    }
  }
  expect(reachedWithTab).toBe(true);
});

it('counts displayed results in the All tab when the API has no aggregate total', async () => {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok: true,
    json: async () => ({ results, pagination: { total: 0, page: 1, limit: 10, pages: 0 } }),
  });
  render(<SearchPageClient initialQuery="Alpha" />);
  expect(await screen.findByRole('heading', { name: 'Ergebnisse (9)' })).toBeInTheDocument();
});

it('keeps all nine categories and controls reachable with mobile-sized touch targets', async () => {
  const user = userEvent.setup();
  render(<SearchPageClient initialQuery="Alpha" />);

  expect(screen.getByRole('searchbox', { name: /Suche nach Kursen/ })).toHaveClass('h-11');
  expect(screen.getByRole('button', { name: 'Suche löschen' })).toHaveClass('h-11', 'w-11');
  expect(screen.getByRole('tablist', { name: 'Suchkategorie' })).toHaveClass('overflow-x-auto');
  expect(screen.getByRole('tablist', { name: 'Suchkategorie' })).toHaveClass('h-auto', 'min-h-12');
  expect(screen.getByText(/Weitere Kategorien seitlich scrollen/)).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(9);
  screen.getAllByRole('tab').forEach((tab) => expect(tab).toHaveClass('min-h-11'));

  await user.click(screen.getByRole('tab', { name: 'Alle' }));
  await user.keyboard('{ArrowRight}');
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Kurse' })).toHaveAttribute('aria-selected', 'true'));
  expect(window.location.search).toBe('?q=Alpha&type=course');
});

it('shows an empty prompt and a visible, retryable error state', async () => {
  window.history.replaceState({}, '', '/search');
  const { unmount } = render(<SearchPageClient />);
  expect(screen.getByRole('heading', { name: 'Geben Sie einen Suchbegriff ein' })).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
  unmount();

  window.history.replaceState({}, '', '/search?q=Alpha');

  (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const user = userEvent.setup();
    render(<SearchPageClient initialQuery="Alpha" />);
    expect(screen.getByRole('status')).toHaveTextContent('Suche läuft');
    expect(await screen.findByRole('alert')).toHaveTextContent('Suche fehlgeschlagen');
    await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByRole('link', { name: /Kurs Alpha/ })).toBeInTheDocument();
  } finally {
    consoleSpy.mockRestore();
  }
});

it('clears results and aborts former-account searches on account switch or logout while keeping the current URL', async () => {
  mockViewerId = 'alice';
  const view = render(<SearchPageClient initialQuery="Alpha" />);
  await screen.findByRole('link', { name: /TypeScript & React/ });
  const input = screen.getByRole('searchbox', { name: /Suche nach Kursen/ });
  fireEvent.change(input, { target: { value: 'Script' } });
  let finishAlice!: (value: unknown) => void;
  const late = new Promise(resolve => { finishAlice = resolve; });
  (global.fetch as jest.Mock).mockReturnValueOnce(late);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/search?query=Script&type=all&page=1&limit=10', expect.anything()));
  const formerSignal = (global.fetch as jest.Mock).mock.calls.at(-1)[1].signal as AbortSignal;
  mockViewerId = 'bob';
  view.rerender(<SearchPageClient initialQuery="Alpha" />);
  expect(formerSignal.aborted).toBe(true);
  expect(screen.queryByRole('link', { name: /TypeScript & React/ })).not.toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: /Suche nach Kursen/ })).toHaveValue('Script');
  (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ results: [results[8]], pagination: { total: 0, page: 1, limit: 10, pages: 0 } }) });
  await screen.findByRole('link', { name: /TypeScript & React/ });
  await act(async () => finishAlice({ ok: true, json: async () => ({ results, pagination: { total: 0, page: 1, limit: 10, pages: 0 } }) }));
  expect(screen.queryByRole('link', { name: /Mitglied Gamma/ })).not.toBeInTheDocument();
  const reads = (global.fetch as jest.Mock).mock.calls.length;
  mockViewerId = null;
  view.rerender(<SearchPageClient initialQuery="Alpha" />);
  expect(screen.queryByRole('link', { name: /TypeScript & React/ })).not.toBeInTheDocument();
  expect(screen.getByText('Anmeldung erforderlich')).toBeInTheDocument();
  expect(window.location.search).toBe('?q=Script');
  expect((global.fetch as jest.Mock).mock.calls).toHaveLength(reads);
});

it('restores filters from the URL and keeps them there before following a result', async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, '', '/search?q=Alpha&type=member&page=2');
  render(<SearchPageClient initialQuery="Alpha" initialType="member" initialPage={2} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/search?query=Alpha&type=member&page=2&limit=10',
    expect.objectContaining({ credentials: 'include' }),
  ));
  expect(screen.getByRole('tab', { name: 'Mitglieder' })).toHaveAttribute('data-state', 'active');
  expect(screen.getByRole('button', { name: 'Seite 2' })).toHaveClass('h-11', 'min-w-11');
  await user.click(await screen.findByRole('button', { name: /Vorherige/ }));
  expect(window.location.search).toBe('?q=Alpha&type=member');
  await user.click(screen.getByRole('tab', { name: 'Kurse' }));
  expect(window.location.search).toBe('?q=Alpha&type=course');

  fireEvent.change(screen.getByRole('searchbox', { name: /Suche nach Kursen/ }), { target: { value: 'Neue Suche' } });
  expect(window.location.search).toBe('?q=Neue+Suche&type=course');
  expect(screen.getByRole('searchbox', { name: /Suche nach Kursen/ })).toHaveValue('Neue Suche');
});

it('ignores delayed URL props from an older keystroke and applies later navigation', async () => {
  const { rerender } = render(<SearchPageClient initialQuery="Alpha" />);
  const input = screen.getByRole('searchbox', { name: /Suche nach Kursen/ });

  fireEvent.change(input, { target: { value: 'Neue Suche' } });
  expect(window.location.search).toBe('?q=Neue+Suche');
  rerender(<SearchPageClient initialQuery="Neue" />);
  expect(input).toHaveValue('Neue Suche');

  rerender(<SearchPageClient initialQuery="Neue Suche" />);
  expect(input).toHaveValue('Neue Suche');

  window.history.replaceState({}, '', '/search?q=Zurück&type=post&page=2');
  rerender(<SearchPageClient initialQuery="Zurück" initialType="post" initialPage={2} />);
  await waitFor(() => expect(input).toHaveValue('Zurück'));
  expect(screen.getByRole('tab', { name: 'Beiträge' })).toHaveAttribute('data-state', 'active');
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/search?query=Zur%C3%BCck&type=post&page=2&limit=10',
    expect.objectContaining({ credentials: 'include' }),
  ));
});

it('paginates the article and project tabs and restores tab/page state through browser history', async () => {
  const user = userEvent.setup();
  (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
    const params = new URL(input, 'http://localhost').searchParams;
    const type = params.get('type');
    return {
      ok: true,
      json: async () => ({
        results: type === 'article' ? [results[6]] : type === 'project' ? [results[7]] : results,
        pagination: { total: 12, page: Number(params.get('page') ?? 1), limit: 10, pages: 2 },
      }),
    };
  });

  render(<SearchPageClient initialQuery="Alpha" />);
  await screen.findByRole('heading', { name: 'Ergebnisse (9)' });
  await user.click(screen.getByRole('tab', { name: 'Artikel' }));
  expect(window.location.search).toBe('?q=Alpha&type=article');
  expect(await screen.findByRole('heading', { name: 'Ergebnisse (12)' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Wissensartikel Zeta/ })).toHaveAttribute('href', '/knowledgebase/article-1');

  await user.click(screen.getByRole('button', { name: /Nächste/ }));
  expect(window.location.search).toBe('?q=Alpha&type=article&page=2');
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/search?query=Alpha&type=article&page=2&limit=10', expect.anything(),
  ));
  expect(screen.getByRole('button', { name: 'Seite 2' })).toHaveAttribute('aria-current', 'page');

  await user.click(screen.getByRole('tab', { name: 'Projekte' }));
  expect(window.location.search).toBe('?q=Alpha&type=project');
  expect(await screen.findByRole('link', { name: /Projekt Eta/ })).toHaveAttribute('href', '/projects/project-1');

  window.history.back();
  await waitFor(() => expect(window.location.search).toBe('?q=Alpha&type=article&page=2'));
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Artikel' })).toHaveAttribute('data-state', 'active'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Seite 2' })).toHaveAttribute('aria-current', 'page'));

  window.history.back();
  await waitFor(() => expect(window.location.search).toBe('?q=Alpha&type=article'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Seite 1' })).toHaveAttribute('aria-current', 'page'));

  window.history.forward();
  await waitFor(() => expect(window.location.search).toBe('?q=Alpha&type=article&page=2'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Seite 2' })).toHaveAttribute('aria-current', 'page'));
});


it('opens a skill result by keyboard and preserves typed skill pagination and history', async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, '', '/search?q=Script&type=skill');
  (global.fetch as jest.Mock).mockImplementation(async (input: string) => {
    const params = new URL(input, 'http://localhost').searchParams;
    return { ok: true, json: async () => ({ results: [results[8]], pagination: { total: 12, page: Number(params.get('page')), limit: 10, pages: 2 } }) };
  });
  render(<SearchPageClient initialQuery="Script" initialType="skill" />);
  const skill = await screen.findByRole('link', { name: /TypeScript & React/ });
  expect(screen.getByRole('tab', { name: 'Fähigkeiten' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('heading', { name: 'Ergebnisse (12)' })).toBeInTheDocument();
  const activate = jest.fn((event: Event) => event.preventDefault());
  skill.addEventListener('click', activate);
  skill.focus();
  await user.keyboard('{Enter}');
  expect(activate).toHaveBeenCalledTimes(1);
  expect(skill).toHaveAttribute('href', '/skills?query=TypeScript%20%26%20React');
  expect(skill).toHaveClass('focus-visible:ring-2');
  expect(skill.querySelector('h3')).toHaveClass('[overflow-wrap:anywhere]');

  await user.click(screen.getByRole('button', { name: /Nächste/ }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/search?query=Script&type=skill&page=2&limit=10', expect.anything()));
  expect(window.location.search).toBe('?q=Script&type=skill&page=2');
  await screen.findByRole('link', { name: /TypeScript & React/ });
  await user.click(screen.getByRole('tab', { name: 'Kurse' }));
  window.history.back();
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Fähigkeiten' })).toHaveAttribute('aria-selected', 'true'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Seite 2' })).toHaveAttribute('aria-current', 'page'));
  await user.click(screen.getByRole('button', { name: 'Suche löschen' }));
  expect(screen.getByRole('searchbox', { name: /Suche nach Kursen/ })).toHaveFocus();
  expect(window.location.search).toBe('?type=skill');
  expect(screen.queryByRole('link', { name: /TypeScript & React/ })).not.toBeInTheDocument();
});
