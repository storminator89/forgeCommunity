import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDashboard from '@/app/admin/dashboard/page';

const mockUseSession = jest.fn();
jest.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));

const stats = {
  totalUsers: 1234,
  totalCourses: 12,
  totalEvents: 0,
  totalPosts: 98,
  activities: [{
    type: 'POST_CREATED',
    user: { name: 'Ada Beispiel', email: 'ada@example.test', image: null },
    action: 'hat einen neuen Beitrag erstellt',
    time: '2026-10-14T10:00:00.000Z',
  }],
};

const successfulResponse = (data = stats): Response => ({ ok: true, json: async () => data } as Response);

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSession.mockReturnValue({ data: { user: { id: 'admin', role: 'ADMIN' } }, status: 'authenticated' });
  global.fetch = jest.fn().mockResolvedValue(successfulResponse());
});

it('preserves the stats endpoint, linked destinations, German numbers, and a single page heading', async () => {
  const { container } = render(<AdminDashboard />);
  expect(await screen.findByText('1.234')).toBeVisible();
  expect(global.fetch).toHaveBeenCalledWith('/api/admin/dashboard-stats', expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard');
  expect(container.querySelector('main')).toBeNull();

  for (const [title, href, value] of [
    ['Benutzer', '/admin/users', '1.234'],
    ['Kurse', '/courses', '12'],
    ['Events', '/events', '0'],
    ['Beiträge', '/community', '98'],
  ]) {
    const link = screen.getByRole('link', { name: `${title} öffnen` });
    expect(link).toHaveAttribute('href', href);
    expect(link).toHaveAccessibleDescription(`${title} insgesamt: ${value}`);
    expect(link.querySelector('button')).toBeNull();
  }
  const activities = screen.getByRole('region', { name: 'Letzte Aktivitäten' });
  expect(within(activities).getByText('Ada Beispiel')).toBeVisible();
  expect(within(activities).getByText('hat einen neuen Beitrag erstellt')).toBeVisible();
  expect(within(activities).getByText('1 Aktivität')).toBeVisible();
});

it('announces loading and waits before showing an empty activity state', async () => {
  let resolve!: (response: ReturnType<typeof successfulResponse>) => void;
  jest.mocked(global.fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }) as Promise<Response>);
  render(<AdminDashboard />);
  expect(screen.getByRole('region', { name: 'Community im Überblick' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: 'Wird geladen' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Dashboard-Daten werden geladen.');
  expect(screen.queryByText('Noch keine Aktivitäten')).not.toBeInTheDocument();
  expect(screen.queryByText('Keine Aktivitäten gefunden.')).not.toBeInTheDocument();
  await act(async () => resolve(successfulResponse()));
  expect(screen.getByRole('region', { name: 'Letzte Aktivitäten' })).toHaveAttribute('aria-busy', 'false');
});

it('renders zero counts honestly and gives an empty activity stream a useful next step', async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce(successfulResponse({ ...stats, totalUsers: 0, totalCourses: 0, totalPosts: 0, activities: [] }) as Response);
  render(<AdminDashboard />);
  expect(await screen.findByText('Noch keine Aktivitäten')).toBeVisible();
  expect(screen.getAllByText('0')).toHaveLength(4);
  expect(screen.getByRole('link', { name: 'Zur Community' })).toHaveAttribute('href', '/community');
  expect(screen.queryByText('Aktivitäten')).not.toBeInTheDocument();
});

it.each(['network', 'http'])('offers a working retry after a %s failure without displaying fabricated counts', async (failure) => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  if (failure === 'network') jest.mocked(global.fetch).mockRejectedValueOnce(new Error('offline'));
  else jest.mocked(global.fetch).mockResolvedValueOnce({ ok: false } as Response);
  render(<AdminDashboard />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Dashboard-Daten konnten nicht geladen werden');
  expect(screen.getAllByText('—')).toHaveLength(4);
  expect(screen.queryByText('Noch keine Aktivitäten')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
  expect(await screen.findByText('1.234')).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  errorSpy.mockRestore();
});

it('supports keyboard refresh and prevents duplicate requests while refreshing', async () => {
  const user = userEvent.setup();
  render(<AdminDashboard />);
  await screen.findByText('1.234');
  let resolve!: (response: ReturnType<typeof successfulResponse>) => void;
  jest.mocked(global.fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }) as Promise<Response>);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Aktualisieren' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Wird geladen' })).toBeDisabled();
  await user.keyboard('{Enter}{Enter}');
  expect(global.fetch).toHaveBeenCalledTimes(2);
  await act(async () => resolve(successfulResponse({ ...stats, totalUsers: 1235 })));
  expect(screen.getByText('1.235')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Aktualisieren' })).toBeEnabled();
  await user.tab();
  expect(screen.getByRole('link', { name: 'Benutzer öffnen' })).toHaveFocus();
});

it.each([
  { data: null, status: 'unauthenticated' },
  { data: { user: { id: 'member', role: 'MEMBER' } }, status: 'authenticated' },
])('preserves the admin-only gate without requesting privileged data for $status', (session) => {
  mockUseSession.mockReturnValue(session);
  render(<AdminDashboard />);
  expect(screen.getByRole('alert')).toHaveTextContent('Du hast keine Berechtigung für diese Seite.');
  expect(screen.queryByRole('link', { name: 'Benutzer öffnen' })).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('waits for session resolution and aborts a pending stats request when admin access disappears', async () => {
  mockUseSession.mockReturnValue({ data: null, status: 'loading' });
  const view = render(<AdminDashboard />);
  expect(screen.getByRole('status')).toHaveTextContent('Berechtigung wird geprüft');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();

  let resolve!: (response: ReturnType<typeof successfulResponse>) => void;
  jest.mocked(global.fetch).mockImplementationOnce(() => new Promise(done => { resolve = done; }) as Promise<Response>);
  mockUseSession.mockReturnValue({ data: { user: { id: 'admin', role: 'ADMIN' } }, status: 'authenticated' });
  view.rerender(<AdminDashboard />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  const signal = jest.mocked(global.fetch).mock.calls[0][1]?.signal;
  expect(signal?.aborted).toBe(false);

  mockUseSession.mockReturnValue({ data: null, status: 'unauthenticated' });
  view.rerender(<AdminDashboard />);
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(successfulResponse()));
  expect(screen.getByRole('alert')).toHaveTextContent('Du hast keine Berechtigung für diese Seite.');
  expect(screen.queryByText('Ada Beispiel')).not.toBeInTheDocument();
});
