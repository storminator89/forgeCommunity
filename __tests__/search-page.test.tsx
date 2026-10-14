import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const mockToast = jest.fn();
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

const results = [
  { id: 'course-1', title: 'Kurs Alpha', description: '', type: 'course', stats: { enrollments: 2 } },
  { id: 'event-1', title: 'Event Beta', description: '', type: 'event', stats: { attendees: 3 } },
  { id: 'member-1', title: 'Mitglied Gamma', description: '', type: 'member', stats: { followers: 1, posts: 0, courses: 0 } },
  { id: 'post-1', title: 'Beitrag Delta', description: '', type: 'post', stats: { likes: 0, comments: 0 } },
  { id: 'resource-1', title: 'Ressource Epsilon', description: '', type: 'resource', url: 'https://example.com/guide' },
  { id: 'resource-2', title: 'Unsichere Ressource', description: '', type: 'resource', url: 'javascript:alert(1)' },
];

beforeEach(() => {
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
  expect(course).toHaveAttribute('href', '/courses/course-1');
  expect(screen.getByRole('link', { name: /Event Beta/ })).toHaveAttribute('href', '/events/event-1');
  expect(screen.getByRole('link', { name: /Mitglied Gamma/ })).toHaveAttribute('href', '/profile/member-1');
  expect(screen.getByRole('link', { name: /Beitrag Delta/ })).toHaveAttribute('href', '/posts/post-1');
  expect(screen.getByRole('link', { name: /Ressource Epsilon/ })).toHaveAttribute('href', 'https://example.com/guide');
  expect(screen.getByRole('link', { name: /Ressource Epsilon/ })).toHaveAttribute('target', '_blank');
  expect(screen.getByRole('link', { name: /Ressource Epsilon/ })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByRole('link', { name: /Ressource Epsilon.*öffnet in neuem Tab/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Unsichere Ressource/ })).toHaveAttribute('href', '/resources');

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

it('restores filters from the URL and keeps them there before following a result', async () => {
  const user = userEvent.setup();
  window.history.replaceState({}, '', '/search?q=Alpha&type=member&page=2');
  render(<SearchPageClient initialQuery="Alpha" initialType="member" initialPage={2} />);

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/search?query=Alpha&type=member&page=2&limit=10',
    expect.objectContaining({ credentials: 'include' }),
  ));
  expect(screen.getByRole('tab', { name: 'Mitglieder' })).toHaveAttribute('data-state', 'active');
  await user.click(await screen.findByRole('button', { name: /Vorherige/ }));
  expect(window.location.search).toBe('?q=Alpha&type=member');
  await user.click(screen.getByRole('tab', { name: 'Kurse' }));
  expect(window.location.search).toBe('?q=Alpha&type=course');

  fireEvent.change(screen.getByRole('textbox', { name: /Suche nach Kursen/ }), { target: { value: 'Neue Suche' } });
  expect(window.location.search).toBe('?q=Neue+Suche&type=course');
  expect(screen.getByRole('textbox', { name: /Suche nach Kursen/ })).toHaveValue('Neue Suche');
});

it('ignores delayed URL props from an older keystroke and applies later navigation', async () => {
  const { rerender } = render(<SearchPageClient initialQuery="Alpha" />);
  const input = screen.getByRole('textbox', { name: /Suche nach Kursen/ });

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
