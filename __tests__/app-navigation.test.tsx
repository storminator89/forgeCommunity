import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '@/components/Sidebar';
import { AppShell, AppHeader } from '@/components/app-shell';
import { AdminHeader } from '@/components/admin/AdminHeader';
import { UserNav } from '@/components/user-nav';
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
  expect(screen.getByRole('link', { name: 'ForgeCommunity Start' })).toHaveClass('min-h-11');
  const trigger = screen.getByRole('button', { name: 'Navigation öffnen' });
  expect(trigger).not.toHaveAttribute('aria-controls');
  fireEvent.click(trigger);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(trigger).toHaveAttribute('aria-controls', 'app-navigation');
  expect(document.getElementById('app-navigation')).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('link', { name: 'Community' }).at(-1)!);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('mobile navigation also closes with its visible close control', () => {
  render(<AppShell><Sidebar /><div><AppHeader><div>Kurse</div></AppHeader><main id="page-content" /></div></AppShell>);
  fireEvent.click(screen.getByRole('button', { name: 'Navigation öffnen' }));
  const close = screen.getByRole('button', { name: 'Navigation schließen' });
  expect(close).toHaveClass('h-11', 'w-11');
  fireEvent.click(close);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each(['Escape', 'close control'])('returns focus to the mobile navigation opener after %s dismissal', async (dismissal) => {
  const user = userEvent.setup();
  render(<AppShell><Sidebar /><div><AppHeader><div>Kurse</div></AppHeader><main id="page-content" /></div></AppShell>);
  const opener = screen.getByRole('button', { name: 'Navigation öffnen' });
  await user.click(opener);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(opener).not.toHaveFocus();

  if (dismissal === 'Escape') await user.keyboard('{Escape}');
  else await user.click(screen.getByRole('button', { name: 'Navigation schließen' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
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

it('gives the account menu a comfortable touch target', () => {
  render(<UserNav />);
  expect(screen.getByRole('button', { name: 'Benutzermenü öffnen' })).toHaveClass('h-11', 'w-11');
});

it('keeps the mobile admin title compact beside the menu and account controls', () => {
  render(<AppShell><AdminHeader onMenuClick={() => {}} /></AppShell>);
  const title = screen.getByRole('heading', { level: 2, name: 'Administration' });
  expect(title).toHaveClass('truncate', 'text-base', 'sm:text-xl');
  expect(title.parentElement?.parentElement).toHaveClass('gap-2', 'sm:gap-4');
  expect(screen.getByRole('button', { name: 'Navigation öffnen' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Farbschema auswählen' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Benutzermenü öffnen' })).toBeInTheDocument();
});
