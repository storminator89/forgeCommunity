import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSession } from 'next-auth/react';
import CourseClient from '@/app/courses/CourseClient';

const mockRouter = { push: jest.fn() };
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }));
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: jest.fn() }) }));

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
