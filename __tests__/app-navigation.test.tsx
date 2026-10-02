import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '@/components/Sidebar';
import { AppShell, AppHeader } from '@/components/app-shell';
import { isNavigationActive } from '@/lib/navigation';
import { useSession } from 'next-auth/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({ usePathname: () => '/courses/example/contents', useRouter: () => ({ push }) }));
jest.mock('next-auth/react', () => ({ useSession: jest.fn(), signOut: jest.fn() }));
jest.mock('@/contexts/NotificationContext', () => ({ useNotifications: () => ({ unreadCount: 3 }) }));

beforeEach(() => {
  window.localStorage.clear(); push.mockClear();
  jest.mocked(useSession).mockReturnValue({ data: { user: { name: 'Ada', role: 'USER' } }, status: 'authenticated', update: jest.fn() } as any);
});

it('marks nested routes active without activating knowledge twice for drafts', () => {
  expect(isNavigationActive('/courses/a/contents', '/courses')).toBe(true);
  expect(isNavigationActive('/courses-other', '/courses')).toBe(false);
  expect(isNavigationActive('/knowledgebase/drafts', '/knowledgebase')).toBe(false);
  expect(isNavigationActive('/knowledgebase/drafts', '/knowledgebase/drafts')).toBe(true);
  expect(isNavigationActive('/projects/a', '/showcases', ['/projects'])).toBe(true);
});

it('mobile navigation opens from the page header and closes after selection', () => {
  render(<AppShell><Sidebar /><div><AppHeader><div>Kurse</div></AppHeader><main id="page-content" /></div></AppShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('link', { name: 'Community' }).at(-1)!);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('opens content search with the keyboard shortcut and preserves the query', () => {
  render(<AppShell><Sidebar /></AppShell>);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' }), { target: { value: 'Power Shell' } });
  fireEvent.submit(screen.getByRole('textbox', { name: 'Bereich oder Inhalt suchen' }).closest('form')!);
  expect(push).toHaveBeenCalledWith('/search?q=Power%20Shell');
});

it('keeps admin navigation hidden for a regular member', () => {
  render(<AppShell><Sidebar /></AppShell>);
  expect(screen.queryByRole('link', { name: 'Benutzerverwaltung' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Kurse' })).toHaveAttribute('aria-current', 'page');
});
