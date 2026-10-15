import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import CourseClient from '@/app/courses/CourseClient';

const mockRouter = { push: jest.fn() };
const mockToast = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));

const freeCourse = {
  id: 'free', title: 'Freier Kurs', instructor: 'Lehrkraft', duration: 'Flexibel',
  startDate: null, endDate: null, category: 'Technik', participants: 0,
  maxStudents: 2, price: null, currency: null, isEnrolled: false,
  completed: false, canDelete: false, imageUrl: null,
};
const paidCourse = { ...freeCourse, id: 'paid', title: 'Bezahlter Kurs', price: 49, currency: 'EUR' };

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'student', role: 'USER' }, expires: '2099-01-01' },
    status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>);
  global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/courses') return { ok: true, json: async () => [freeCourse, paidCourse] };
    if (url === '/api/courses/free/enrollment' && init?.method === 'POST') {
      return { ok: true, json: async () => ({ isEnrolled: true, participants: 1 }) };
    }
    if (url === '/api/courses/free/enrollment' && init?.method === 'DELETE') {
      return { ok: true, json: async () => ({ isEnrolled: false, participants: 0 }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

it('joins and leaves a free course, while keeping paid joining unavailable', async () => {
  const user = userEvent.setup();
  render(<CourseClient />);
  await user.click(await screen.findByRole('button', { name: 'Kurs beitreten' }));
  expect(global.fetch).toHaveBeenCalledWith('/api/courses/free/enrollment', { method: 'POST' });
  expect(mockRouter.push).toHaveBeenCalledWith('/courses/free/contents');
  await user.click(await screen.findByRole('button', { name: 'Kurs verlassen' }));
  expect(global.fetch).toHaveBeenCalledWith('/api/courses/free/enrollment', { method: 'DELETE' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Kurs beitreten' })).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Anmeldung derzeit nicht verfügbar' })).toBeDisabled();
  expect(global.fetch).not.toHaveBeenCalledWith('/api/courses/paid/enrollment', expect.anything());
});

it('shows the certificate protection error when a course deletion is rejected', async () => {
  const user = userEvent.setup();
  const protectedCourse = { ...freeCourse, id: 'protected', title: 'Zertifizierter Kurs', canDelete: true };
  global.fetch = jest.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/courses') return { ok: true, json: async () => [protectedCourse] };
    if (url === '/api/courses/protected' && init?.method === 'DELETE') return { ok: false, status: 409, json: async () => ({ error: 'Der Kurs hat ausgestellte Zertifikate und kann nicht gelöscht werden.' }) };
    throw new Error(`Unexpected fetch: ${url}`);
  });
  render(<CourseClient />);
  await user.click(await screen.findByRole('button', { name: 'Löschen' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Löschen' }));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Der Kurs hat ausgestellte Zertifikate und kann nicht gelöscht werden.', variant: 'destructive' })));
  expect(screen.getByText('Zertifizierter Kurs')).toBeInTheDocument();
});

it('filters the directory by title or instructor and offers a reset with an updated count', async () => {
  const user = userEvent.setup();
  render(<CourseClient />);
  expect(await screen.findByText('Freier Kurs')).toBeInTheDocument();
  expect(screen.getByText('2 Kurse verfügbar')).toBeInTheDocument();

  await user.type(screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' }), 'Bezahlter');
  expect(screen.getByText('1 Kurs gefunden')).toBeInTheDocument();
  expect(screen.queryByText('Freier Kurs')).not.toBeInTheDocument();

  await user.clear(screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' }));
  await user.type(screen.getByRole('searchbox', { name: 'Suche nach Kursen oder Dozenten' }), 'Unbekannt');
  expect(screen.getByText('Keine Kurse gefunden')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Filter zurücksetzen' })).toHaveLength(1);

  await user.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
  expect(screen.getByText('2 Kurse verfügbar')).toBeInTheDocument();
  expect(screen.getByText('Freier Kurs')).toBeInTheDocument();
});

it('keeps a full course unavailable to visitors but manageable by its owner', async () => {
  const fullCourse = { ...freeCourse, participants: 2 };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [fullCourse] });
  const view = render(<CourseClient />);
  expect(await screen.findByRole('button', { name: 'Kurs ausgebucht' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  view.unmount();

  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [{ ...fullCourse, canDelete: true }] });
  render(<CourseClient />);
  expect(await screen.findByRole('button', { name: 'Kurs verwalten' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Löschen' })).toBeInTheDocument();
});
