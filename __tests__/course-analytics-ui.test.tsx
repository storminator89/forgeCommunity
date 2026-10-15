import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CourseAnalytics } from '@/app/courses/[courseId]/analytics/CourseAnalytics';

jest.mock('@/components/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AppHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header> }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));

const payload = {
  course: { id: 'course', title: 'Werkstattkurs', activePublicationId: 'pub-1' },
  summary: { enrolled: 1, currentComplete: 0, notStarted: 0, inProgress: 1, unmeasurable: 0,
    quizSignals: [{ contentId: 'quiz', title: 'Wissenstest', attemptedLearners: 1, latestFailureLearners: 1 }] },
  pagination: { page: 1, pageSize: 25, total: 1, pages: 1 },
  learners: [{ enrollmentId: 'enroll-1', displayName: 'Mara', enrolledAt: '2026-10-01T00:00:00.000Z',
    currentStatus: 'in-progress', completedLeaves: 1, totalLeaves: 2, firstIncomplete: { id: 'quiz', title: 'Wissenstest' },
    quizAttempts: 1, quizNeedsReview: 1, latestQuiz: { title: 'Wissenstest', score: 50, passed: false, submittedAt: '2026-10-02T00:00:00.000Z' },
    historicalCompletedAt: null, certificateIssuedAt: null }],
};

test('renders a populated, accessible author view and applies a keyboard-submitted filter', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => payload } as Response);
  render(<CourseAnalytics courseId="course" accountId="owner" sessionStatus="authenticated" />);
  expect(await screen.findByRole('heading', { name: 'Werkstattkurs' })).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Lernende im Kurs' })).toHaveTextContent('Mara');
  expect(screen.getByText('1 von 2 aktuellen Inhalten erledigt')).toBeInTheDocument();
  const search = screen.getByRole('textbox', { name: 'Name suchen' });
  fireEvent.change(search, { target: { value: 'Mara' } });
  fireEvent.submit(search.closest('form')!);
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('search=Mara'), expect.objectContaining({ cache: 'no-store' })));
  expect(screen.getByRole('button', { name: 'CSV exportieren' })).toBeEnabled();
});

test('clears previously displayed learner data when a refreshed authorization check fails', async () => {
  const mockFetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => payload } as Response)
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Kein Zugriff auf die Kursanalyse.' }) } as Response);
  global.fetch = mockFetch;
  render(<CourseAnalytics courseId="course" accountId="owner" sessionStatus="authenticated" />);
  expect(await screen.findByText('Mara')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Name suchen' }), { target: { value: 'Mara' } });
  fireEvent.click(screen.getByRole('button', { name: 'Anwenden' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kein Zugriff');
  expect(screen.queryByText('Mara')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'CSV exportieren' })).not.toBeInTheDocument();
});

test('clears learner data immediately when export discovers revoked access', async () => {
  const mockFetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => payload } as Response)
    .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ error: 'Kein Zugriff auf die Kursanalyse.' }) } as Response);
  global.fetch = mockFetch;
  render(<CourseAnalytics courseId="course" accountId="owner" sessionStatus="authenticated" />);
  expect(await screen.findByText('Mara')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Kein Zugriff');
  expect(screen.queryByText('Mara')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'CSV exportieren' })).not.toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledTimes(2);
});
