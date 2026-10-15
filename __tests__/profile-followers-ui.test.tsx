import { fireEvent, render, screen, within } from '@testing-library/react';
import { FollowersList } from '@/components/profile/FollowersList';

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ users: [{ id: 'bea', name: 'Bea', image: null, followedAt: '2026-01-01T00:00:00.000Z' }] }) } as Response));
});

it('opens a follower list with a readable profile link', async () => {
  render(<FollowersList userId="author" count={1} type="followers" />);
  fireEvent.click(screen.getByRole('button', { name: '1 Follower' }));
  const dialog = await screen.findByRole('dialog', { name: 'Follower' });
  expect(await within(dialog).findByRole('link', { name: /Bea/ })).toHaveAttribute('href', '/profile/bea');
});

it('keeps a fetch error distinct from an empty follower list and offers retry', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));
  render(<FollowersList userId="author" count={1} type="followers" />);
  fireEvent.click(screen.getByRole('button', { name: '1 Follower' }));
  const dialog = await screen.findByRole('dialog', { name: 'Follower' });
  expect(await within(dialog).findByText('Die Liste konnte nicht geladen werden.')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Erneut versuchen' }));
  expect(await within(dialog).findByRole('link', { name: /Bea/ })).toBeInTheDocument();
  errorSpy.mockRestore();
});
