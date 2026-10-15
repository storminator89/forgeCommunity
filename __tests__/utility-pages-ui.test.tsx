import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { signOut } from 'next-auth/react';
import About from '@/app/about/page';
import LogoutPage from '@/app/logout/page';

const mockRouter = { replace: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('next-auth/react', () => ({ signOut: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Design wechseln</button> }));

beforeEach(() => jest.clearAllMocks());

it('explains the product and preserves the maker’s existing links', () => {
  render(<About />);
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { name: 'Hinter ForgeCommunity' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Patrick Meyhöfer' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/patrickmeyhoefer');
  expect(screen.getByRole('link', { name: 'E-Mail schreiben' })).toHaveAttribute('href', 'mailto:contact@patrickmeyhoefer.com');
  expect(screen.getByRole('link', { name: /Austausch/ })).toHaveAttribute('href', '/community');
  expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute('href', '#page-content');
});

it('announces logout inside a main landmark and starts it once under Strict Mode', async () => {
  jest.mocked(signOut).mockImplementation(() => new Promise(() => {}));
  render(<StrictMode><LogoutPage /></StrictMode>);
  expect(screen.getByRole('heading', { name: 'Abmelden', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('main')).toHaveAttribute('id', 'page-content');
  expect(screen.getByRole('link', { name: 'Zum Inhalt springen' })).toHaveAttribute('href', '#page-content');
  expect(screen.getByRole('status')).toHaveTextContent('Abmeldung läuft');
  await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
});
