import { fireEvent, render, screen, within } from '@testing-library/react';
import { Sidebar } from '@/components/Sidebar';

let mockRole = 'USER';
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { name: 'Artwork QA', role: mockRole } } }), signOut: jest.fn() }));
jest.mock('next/navigation', () => ({ usePathname: () => '/community', useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/contexts/NotificationContext', () => ({ useNotifications: () => ({ unreadCount: 7 }) }));

beforeEach(() => { mockRole = 'USER'; window.localStorage.clear(); });

test.each(['USER', 'MODERATOR', 'ADMIN'])('generated artwork preserves %s role filters, active names and unread badge', role => {
  mockRole = role;
  render(<Sidebar />);
  const navigation = screen.getByRole('navigation', { name: 'Hauptnavigation' });
  const links = within(navigation).getAllByRole('link');
  for (const link of links) {
    expect(link).toHaveAccessibleName();
    expect(link).toHaveClass('min-h-11');
    const image = link.querySelector('img');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('aria-hidden', 'true');
    expect(image).toHaveAttribute('width', '28');
  }
  expect(within(navigation).getByRole('link', { name: 'Community' })).toHaveAttribute('aria-current', 'page');
  expect(within(navigation).getByLabelText('7 ungelesene Benachrichtigungen')).toHaveTextContent('7');
  expect(within(navigation).queryByRole('link', { name: 'Dashboard' }) !== null).toBe(role === 'ADMIN');
  expect(within(navigation).queryByRole('link', { name: 'Meldungen prüfen' }) !== null).toBe(role !== 'USER');
  const learnerPath = navigation.querySelector('a[href="/courses/pathways"]');
  expect(learnerPath !== null).toBe(role === 'USER');
});

test('collapsed navigation retains labelled links, active state, badge and 28px artwork', () => {
  render(<Sidebar />);
  fireEvent.click(screen.getByRole('button', { name: 'Navigation einklappen' }));
  expect(screen.getByRole('button', { name: 'Navigation erweitern' })).toHaveAttribute('aria-expanded', 'false');
  const navigation = screen.getByRole('navigation', { name: 'Hauptnavigation' });
  const community = within(navigation).getByRole('link', { name: 'Community' });
  expect(community).toHaveAttribute('aria-label', 'Community');
  expect(community).toHaveAttribute('aria-current', 'page');
  expect(community.querySelector('img')).toHaveAttribute('width', '28');
  expect(within(navigation).getByLabelText('7 ungelesene Benachrichtigungen')).toHaveTextContent('7');
});

test('drawer links retain their labels and close the drawer when selected', () => {
  const onClose = jest.fn();
  render(<Sidebar isOpen onClose={onClose} />);
  const drawer = screen.getByRole('dialog', { name: 'Navigation' });
  const community = within(drawer).getByRole('link', { name: 'Community' });
  expect(community.querySelector('img')).toHaveAttribute('alt', '');
  fireEvent.click(community);
  expect(onClose).toHaveBeenCalledTimes(1);
});
