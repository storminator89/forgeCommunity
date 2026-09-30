import { Suspense } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useSession } from 'next-auth/react';
import CourseClient from '@/app/courses/CourseClient';
import CourseContentsPage from '@/app/courses/[courseId]/contents/page';
import { CourseContent } from '@/app/courses/[courseId]/contents/types';

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ courseId: 'course-1' }) }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }));
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }));
jest.mock('@/app/courses/[courseId]/contents/ContentRenderer', () => ({ ContentRenderer: ({ content }: { content: CourseContent }) => <p>{String(content.content)}</p> }));
jest.mock('@/app/courses/[courseId]/contents/EditContentForm', () => ({ EditContentForm: ({ content, onSubmit, onCancel }: { content: CourseContent; onSubmit: (content: CourseContent) => void; onCancel: () => void }) => <><button onClick={() => onSubmit({ ...content, isRequired: false })}>Pflichtinhalt speichern</button><button onClick={onCancel}>Abbrechen</button></> }));

const fetchMock = global.fetch as jest.Mock;
const sessionMock = useSession as jest.Mock;
const metadata = { id: 'course-1', name: 'Testkurs', description: 'Beschreibung', price: null, currency: null, maxStudents: null, participants: 1, canManage: false, hasAccess: true, enrollment: { id: 'enrollment', enrolledAt: '2026-09-30', completedAt: null } };
const progress = { enrollment: metadata.enrollment, learningContentIds: ['root', 'child', 'deep'], requiredContentIds: ['root', 'child', 'deep'], completedContentIds: [], completedCount: 0, requiredCount: 3, percentage: 0, certificate: null };
const tree = [{ id: 'root', title: 'Root', content: 'Root learning text', type: 'TEXT', courseId: 'course-1', order: 0, parentId: null, subContents: [{ id: 'child', title: 'Child', content: 'Child learning text', type: 'TEXT', courseId: 'course-1', order: 0, parentId: 'root', subContents: [{ id: 'deep', title: 'Deep', content: 'Deep learning text', type: 'TEXT', courseId: 'course-1', order: 0, parentId: 'child' }] }] }];
const jsonResponse = (data: unknown) => ({ ok: true, json: async () => data });

beforeEach(() => { fetchMock.mockReset(); sessionMock.mockReturnValue({ status: 'authenticated', data: { user: { id: 'user-1', role: 'USER' } } }); });
async function renderContents() {
  const params = Promise.resolve({ courseId: 'course-1' });
  await act(async () => { render(<Suspense fallback="Laden"><CourseContentsPage params={params} /></Suspense>); });
}

test('learner opening content never marks it; explicit save waits for server and then displays completion', async () => {
  fetchMock.mockImplementation((url: string, options?: RequestInit) => {
    if (url.endsWith('/contents/root/progress') && options?.method === 'PUT') return Promise.resolve(jsonResponse({ ...progress, completedContentIds: ['root', 'child', 'deep'], completedCount: 3, percentage: 100, enrollment: { ...metadata.enrollment, completedAt: '2026-09-30' }, certificate: { id: 'cert', issuedAt: '2026-09-30' } }));
    return Promise.resolve(jsonResponse(url.endsWith('/contents') ? tree : url.endsWith('/progress') ? progress : metadata));
  });
  await renderContents();
  fireEvent.click(await screen.findByRole('button', { name: 'Root' }));
  expect(screen.getByText('Root learning text')).toBeInTheDocument();
  expect(fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Als abgeschlossen markieren' }));
  await screen.findByText('Kurs abgeschlossen');
  expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Abgeschlossen' })).toBeDisabled();
});

test('course contents and progress remain gated until a free enrollment succeeds', async () => {
  let enrolled = false;
  fetchMock.mockImplementation((url: string, options?: RequestInit) => {
    if (url.endsWith('/enroll') && options?.method === 'POST') { enrolled = true; return Promise.resolve(jsonResponse({ enrollment: metadata.enrollment })); }
    return Promise.resolve(jsonResponse(url.endsWith('/contents') ? tree : url.endsWith('/progress') ? progress : { ...metadata, hasAccess: enrolled, enrollment: enrolled ? metadata.enrollment : null }));
  });
  await renderContents();
  await screen.findByRole('button', { name: 'Kostenlos einschreiben' });
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/contents') || url.endsWith('/progress'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Kostenlos einschreiben' }));
  await screen.findByRole('button', { name: 'Root' });
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/progress'))).toBe(true);
});

test('saving a parent requirement preserves nested content and updates deep nodes', async () => {
  const manager = { ...metadata, canManage: true };
  fetchMock.mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') { const update = JSON.parse(String(options.body)); return Promise.resolve(jsonResponse({ id: update.id, title: update.title, content: update.content, type: update.type, isRequired: false })); }
    return Promise.resolve(jsonResponse(url.endsWith('/contents') ? tree : url.endsWith('/progress') ? progress : manager));
  });
  await renderContents();
  fireEvent.click(await screen.findByRole('button', { name: 'Root' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pflichtinhalt speichern' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Pflichtinhalt speichern' })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Ausklappen: Root' }));
  expect(screen.getByRole('button', { name: 'Child' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Deep' }));
  fireEvent.click(screen.getByRole('button', { name: 'Bearbeiten' }));
  fireEvent.click(screen.getByRole('button', { name: 'Pflichtinhalt speichern' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Pflichtinhalt speichern' })).not.toBeInTheDocument());
  expect(screen.getByText('Deep learning text')).toBeInTheDocument();
  const updates = fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT');
  expect(updates).toHaveLength(2);
  expect(updates[1][0]).toBe('/api/courses/course-1/contents/deep');
});

test('switching catalog accounts immediately removes the previous account personalized cards', async () => {
  let resolveSecond!: (value: unknown) => void;
  fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'old', title: 'Privater alter Status', instructor: 'Teacher', category: 'Test', participants: 1, duration: 'Flexibel', startDate: null, endDate: null, imageUrl: null, price: null, currency: null, maxStudents: null, isEnrolled: true, completedAt: '2026-09-30', canManage: true }])).mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
  const { rerender } = render(<CourseClient />);
  await screen.findByText('Privater alter Status');
  sessionMock.mockReturnValue({ status: 'authenticated', data: { user: { id: 'user-2', role: 'USER' } } });
  rerender(<CourseClient />);
  expect(screen.queryByText('Privater alter Status')).not.toBeInTheDocument();
  expect(screen.queryByText('Abgeschlossen')).not.toBeInTheDocument();
  await act(async () => { resolveSecond(jsonResponse([])); });
  await screen.findByText('Keine Kurse gefunden');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});


test('failed progress save stays visible and retryable when the contents sidebar is collapsed', async () => {
  fetchMock.mockImplementation((url: string, options?: RequestInit) => {
    if (options?.method === 'PUT') return Promise.resolve({ ok: false, json: async () => ({ error: 'Temporary failure' }) });
    return Promise.resolve(jsonResponse(url.endsWith('/contents') ? tree : url.endsWith('/progress') ? progress : metadata));
  });
  await renderContents();
  fireEvent.click(await screen.findByRole('button', { name: 'Root' }));
  fireEvent.click(screen.getByRole('button', { name: 'Inhaltsverzeichnis ausblenden' }));
  fireEvent.click(screen.getByRole('button', { name: 'Als abgeschlossen markieren' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Fortschritt wurde nicht gespeichert'));
  expect(screen.getByRole('button', { name: 'Als abgeschlossen markieren' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Fortschritt erneut laden' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Als abgeschlossen markieren' })).toBeEnabled());
});
