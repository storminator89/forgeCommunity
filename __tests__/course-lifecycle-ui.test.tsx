import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { CourseProgressState, useCourseProgress } from '@/app/courses/[courseId]/contents/hooks/useCourseProgress';
import { CourseProgress } from '@/app/courses/[courseId]/contents/components/CourseProgress';
import { CourseAccessManager, CourseDetails, CourseEnrollmentButton } from '@/app/courses/[courseId]/contents/components/CourseAccess';
import { CourseContentsSidebar } from '@/app/courses/[courseId]/contents/CourseContentsSidebar';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ courseId: 'course-1' }) }));

const fetchMock = global.fetch as jest.Mock;
const initialProgress: CourseProgressState = {
  enrollment: { id: 'enrollment-1', enrolledAt: '2026-09-30T00:00:00Z', completedAt: null },
  completedContentIds: [], learningContentIds: ['root', 'child', 'grandchild', 'optional'],
  requiredContentIds: ['root', 'child', 'grandchild'], completedCount: 0, requiredCount: 3,
  percentage: 0, certificate: null,
};
const course: CourseDetails = {
  id: 'course-1', name: 'Kurs', description: 'Beschreibung', price: null, currency: null,
  maxStudents: null, participants: 0, canManage: false, hasAccess: false, enrollment: null,
};
function response(data: unknown, ok = true) { return { ok, json: async () => data } as Response; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => { fetchMock.mockReset(); localStorage.clear(); });

describe('server-backed progress', () => {
  test('ignores legacy localStorage; sends only explicit completion and locks duplicate requests', async () => {
    localStorage.setItem('visitedPages', JSON.stringify({ 'course-1': { child: true } }));
    fetchMock.mockResolvedValueOnce(response(initialProgress));
    const write = deferred<Response>();
    fetchMock.mockReturnValueOnce(write.promise);
    const { result } = renderHook(() => useCourseProgress('course-1', true));
    await waitFor(() => expect(result.current.progress).toEqual(initialProgress));
    expect(result.current.progress?.completedCount).toBe(0);
    act(() => { void result.current.setCompleted('child', true); void result.current.setCompleted('child', true); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/courses/course-1/contents/child/progress');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ completed: true });
    expect(result.current.progress?.completedContentIds).toEqual([]);
    const saved = { ...initialProgress, completedContentIds: ['child'], completedCount: 1, percentage: 33 };
    await act(async () => { write.resolve(response(saved)); });
    expect(result.current.progress).toEqual(saved);
    expect(result.current.savingContentId).toBeNull();
  });

  test('failed writes preserve confirmed state and can retry or undo', async () => {
    const saved = { ...initialProgress, completedContentIds: ['child'], completedCount: 1, percentage: 33 };
    fetchMock.mockResolvedValueOnce(response(saved)).mockResolvedValueOnce(response({ error: 'Temporary failure' }, false)).mockResolvedValueOnce(response(initialProgress));
    const { result } = renderHook(() => useCourseProgress('course-1', true));
    await waitFor(() => expect(result.current.progress).toEqual(saved));
    await act(async () => { await result.current.setCompleted('child', false); });
    expect(result.current.error).toMatch(/nicht gespeichert/);
    expect(result.current.progress).toEqual(saved);
    await act(async () => { await result.current.setCompleted('child', false); });
    expect(result.current.progress).toEqual(initialProgress);
    expect(result.current.error).toBeNull();
  });

  test('newer refresh wins over an older out-of-order response', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useCourseProgress('course-1', true));
    act(() => { void result.current.refresh(); });
    const saved = { ...initialProgress, completedContentIds: ['child'] };
    await act(async () => { second.resolve(response(saved)); });
    await act(async () => { first.resolve(response(initialProgress)); });
    expect(result.current.progress).toEqual(saved);
  });

  test('refresh during a write cannot replace its authoritative completion/certificate', async () => {
    fetchMock.mockResolvedValueOnce(response(initialProgress));
    const write = deferred<Response>();
    fetchMock.mockReturnValueOnce(write.promise);
    const { result } = renderHook(() => useCourseProgress('course-1', true));
    await waitFor(() => expect(result.current.progress).not.toBeNull());
    act(() => { void result.current.setCompleted('child', true); void result.current.refresh(); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const completed = { ...initialProgress, enrollment: { ...initialProgress.enrollment, completedAt: '2026-09-30T01:00:00Z' }, certificate: { id: 'cert', issuedAt: '2026-09-30T01:00:00Z' } };
    await act(async () => { write.resolve(response(completed)); });
    expect(result.current.progress).toEqual(completed);
    await act(async () => { await result.current.setCompleted('child', false); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('switching courses aborts old requests and never applies the old progress', async () => {
    const oldRead = deferred<Response>();
    fetchMock.mockReturnValueOnce(oldRead.promise).mockResolvedValueOnce(response({ ...initialProgress, requiredCount: 2 }));
    const { result, rerender } = renderHook(({ id }) => useCourseProgress(id, true), { initialProps: { id: 'old' } });
    const oldSignal = fetchMock.mock.calls[0][1].signal;
    rerender({ id: 'new' });
    await waitFor(() => expect(result.current.progress?.requiredCount).toBe(2));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => { oldRead.resolve(response(initialProgress)); });
    expect(result.current.progress?.requiredCount).toBe(2);
  });

  test('unenrolled and signed-out views do not request progress', () => {
    const { result } = renderHook(() => useCourseProgress('course-1', false));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.progress).toBeNull();
  });
});

describe('completion and certificates', () => {
  test('empty course remains incomplete and has no certificate action', () => {
    render(<CourseProgress progress={{ ...initialProgress, requiredCount: 0, requiredContentIds: [] }} isLoading={false} error={null} onRetry={jest.fn()} courseId="course-1" courseName="Kurs" />);
    expect(screen.getByText(/Noch keine Pflichtinhalte/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Zertifikat/ })).not.toBeInTheDocument();
  });

  test('historical completed course shows issued certificate despite a changed syllabus; failed download is visible', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'PDF unavailable' }, false));
    render(<CourseProgress progress={{ ...initialProgress, percentage: 33, enrollment: { ...initialProgress.enrollment, completedAt: '2026-09-29' }, certificate: { id: 'cert', issuedAt: '2026-09-29' } }} isLoading={false} error={null} onRetry={jest.fn()} courseId="course-1" courseName="Kurs" />);
    expect(screen.getByText('Kurs abgeschlossen')).toBeInTheDocument();
    expect(screen.getByText(/keine bestandene Prüfung/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zertifikat herunterladen' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Zertifikat konnte nicht heruntergeladen'));
    expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).toBeEnabled();
  });
});

describe('enrollment and access management', () => {
  test('free enrollment handles double-clicks without duplicate requests and refreshes confirmed access', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValue(pending.promise);
    const onEnrolled = jest.fn().mockResolvedValue(undefined);
    render(<CourseEnrollmentButton course={course} onEnrolled={onEnrolled} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kostenlos einschreiben' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wird eingeschrieben...' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(response({ enrollment: initialProgress.enrollment })); });
    expect(onEnrolled).toHaveBeenCalledTimes(1);
  });

  test('paid course never offers self enrollment/payment and explains owner approval', () => {
    render(<CourseEnrollmentButton course={{ ...course, price: 20, currency: 'EUR' }} onEnrolled={jest.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/muss Ihren Zugang freischalten/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('failed enrollment can retry and a full course does not send a request', async () => {
    fetchMock.mockResolvedValueOnce(response({ error: 'Course is full' }, false));
    const { rerender } = render(<CourseEnrollmentButton course={course} onEnrolled={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Kostenlos einschreiben' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Einschreibung fehlgeschlagen'));
    expect(screen.getByRole('button', { name: 'Kostenlos einschreiben' })).toBeEnabled();
    rerender(<CourseEnrollmentButton course={{ ...course, maxStudents: 2, participants: 2 }} onEnrolled={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Kurs ist ausgebucht' })).toBeDisabled();
  });

  test('access manager uses authoritative totals, pages the roster, and resets on close', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(response({
      enrollments: [{ id: url.includes('page=2') ? 'e2' : 'e1', user: { id: 'u1', name: url.includes('page=2') ? 'Zweite Person' : 'Erste Person', email: 'test@example.test' }, enrolledAt: '2026-09-30', completedAt: null }],
      maxStudents: 100, total: 51, hasMore: !url.includes('page=2'),
    })));
    render(<CourseAccessManager courseId="course-1" onAccessChanged={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Teilnehmer verwalten' }));
    await screen.findByText('Erste Person');
    expect(screen.getByText('Eingeschriebene Teilnehmer (51/100)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    await screen.findByText('Zweite Person');
    fireEvent.change(screen.getByLabelText('E-Mail des Benutzerkontos'), { target: { value: 'draft@example.test' } });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Teilnehmer verwalten' }));
    await screen.findByText('Erste Person');
    expect(screen.getByLabelText('E-Mail des Benutzerkontos')).toHaveValue('');
    expect(screen.getByText('Seite 1')).toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, options]) => options.method !== 'POST')).toBe(true);
  });
});

test('learner sidebar opens parent learning content, handles nested progress, and hides editing', async () => {
  const onSelect = jest.fn();
  const onMark = jest.fn();
  const noop = jest.fn();
  const child = { id: 'child', courseId: 'course-1', title: 'Child', type: 'TEXT' as const, content: 'child', order: 0, parentId: 'root', subContents: [{ id: 'grandchild', courseId: 'course-1', title: 'Grandchild', type: 'TEXT' as const, content: 'deep', order: 0, parentId: 'child' }] };
  render(<CourseContentsSidebar contents={[{ id: 'root', courseId: 'course-1', title: 'Root', type: 'TEXT', content: 'root', order: 0, parentId: null, subContents: [child] }]}
    selectedContentId={null} onContentSelect={onSelect} onEditClick={noop} onDeleteClick={noop} isInlineEditing={null} inlineEditTitle="" onInlineEditSubmit={noop} setIsInlineEditing={noop} setInlineEditTitle={noop} onMoveUp={noop} onMoveDown={noop} mainContentId={null} mainTopicIndex={0} courseId="course-1" courseName="Kurs" isLoading={false} canManage={false} progress={{ ...initialProgress, completedContentIds: ['grandchild'], completedCount: 1, percentage: 33 }} progressLoading={false} progressError={null} onProgressRetry={noop} savingContentId={null} onSubContentSubmit={noop} onVisitedToggle={onMark} />);
  expect(screen.getByLabelText('Fortschritt Root')).toHaveTextContent('1/3');
  fireEvent.click(screen.getByRole('button', { name: 'Root' }));
  expect(onSelect).toHaveBeenCalledWith('root');
  expect(onMark).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ausklappen: Root' }));
  expect(screen.getByRole('button', { name: 'Als offen markieren: Grandchild' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Als abgeschlossen markieren: Child' }));
  expect(onMark).toHaveBeenCalledWith('child');
  expect(screen.queryByRole('button', { name: /Neues Kapitel|Inhalt hinzufügen/ })).not.toBeInTheDocument();
});

test('legacy completed enrollment can issue its missing certificate; historical certificate uses owner download route', async () => {
  const createUrl = jest.fn(() => 'blob:certificate');
  const revokeUrl = jest.fn();
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createUrl });
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  fetchMock.mockResolvedValue({ ok: true, blob: async () => new Blob(['PDF'], { type: 'application/pdf' }) });
  const retry = jest.fn();
  const { rerender } = render(<CourseProgress progress={{ ...initialProgress, enrollment: { ...initialProgress.enrollment, completedAt: '2026-09-29' } }} isLoading={false} error={null} onRetry={retry} courseId="course-1" courseName="Kurs" />);
  fireEvent.click(screen.getByRole('button', { name: 'Zertifikat herunterladen' }));
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenLastCalledWith('/api/courses/course-1/certificate', { method: 'POST' });
  expect(document.querySelector('a[download]')).toBeNull();
  rerender(<CourseProgress progress={{ ...initialProgress, certificate: { id: 'legacy-cert', issuedAt: '2026-09-29' } }} isLoading={false} error={null} onRetry={retry} courseId="course-1" courseName="Kurs" />);
  fireEvent.click(screen.getByRole('button', { name: 'Zertifikat herunterladen' }));
  await waitFor(() => expect(click).toHaveBeenCalledTimes(2));
  expect(fetchMock).toHaveBeenLastCalledWith('/api/certificates/legacy-cert/download');
  expect(retry).toHaveBeenCalledTimes(1);
  click.mockRestore();
});
