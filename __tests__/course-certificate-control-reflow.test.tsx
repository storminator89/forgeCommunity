import { act, fireEvent, render, screen } from '@testing-library/react'
import { CourseContentsSidebar } from '@/app/courses/[courseId]/contents/CourseContentsSidebar'
import type { CourseContent, CourseProgressSnapshot } from '@/app/courses/[courseId]/contents/types'

const chapter: CourseContent = {
  id: 'chapter', courseId: 'course', title: 'Kapitel', type: 'TEXT', content: '', order: 0, parentId: null,
}
const progress: CourseProgressSnapshot = {
  completedContentIds: [], complete: false, canTrack: true, hasCertificate: false, completedAt: null,
}

function renderSidebar(snapshot: CourseProgressSnapshot, isProgressMutating = false) {
  return render(<CourseContentsSidebar
    contents={[chapter]} selectedContentId={null} onContentSelect={jest.fn()}
    onEditClick={jest.fn()} onDeleteClick={jest.fn()} isInlineEditing={null} inlineEditTitle=""
    onInlineEditSubmit={jest.fn()} setIsInlineEditing={jest.fn()} setInlineEditTitle={jest.fn()}
    onMoveUp={jest.fn()} onMoveDown={jest.fn()} mainContentId={null} mainTopicIndex={0}
    courseId="course" courseName="Testkurs" isLoading={false} canManage={false}
    progress={snapshot} isProgressMutating={isProgressMutating} onSubContentSubmit={jest.fn()}
  />)
}

function expectReflowableCertificate(label = 'Zertifikat herunterladen') {
  const button = screen.getByRole('button', { name: label })
  expect(button).toHaveClass('h-auto', 'min-h-11', 'w-full', 'min-w-0', 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]')
  expect(button).not.toHaveClass('h-11')
  expect(button).not.toHaveClass('whitespace-nowrap')
  expect(screen.getByText(label, { selector: 'span' })).toHaveClass('min-w-0', '[overflow-wrap:anywhere]')
  expect(button.querySelector('svg')).toHaveClass('shrink-0')
  return button
}

beforeEach(() => {
  jest.mocked(global.fetch).mockReset()
})

it('wraps the disabled certificate label while retaining its progress hint and blocking requests', () => {
  renderSidebar(progress)
  const button = expectReflowableCertificate()
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute('aria-describedby', 'certificate-progress-hint')
  expect(button).toHaveAccessibleDescription('Schließe alle Inhalte ab und bestehe alle Quizfragen, um dein Zertifikat herunterzuladen.')
  fireEvent.click(button)
  expect(global.fetch).not.toHaveBeenCalled()
})

it.each([
  ['completed course', { ...progress, complete: true }],
  ['existing certificate', { ...progress, canTrack: false, hasCertificate: true, canIssueCertificate: false }],
] as const)('wraps the enabled certificate label for a %s', (_state, snapshot) => {
  renderSidebar(snapshot)
  expect(expectReflowableCertificate()).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Zertifikat herunterladen' })).not.toHaveAttribute('aria-describedby')
  expect(global.fetch).not.toHaveBeenCalled()
})

it('retains reflow while progress updates temporarily disable an otherwise available certificate', () => {
  renderSidebar({ ...progress, complete: true }, true)
  expect(expectReflowableCertificate()).toBeDisabled()
})

it('keeps the busy certificate label reflowable and prevents another request until generation finishes', async () => {
  let finishRequest!: (response: Response) => void
  jest.mocked(global.fetch).mockReturnValueOnce(new Promise<Response>(resolve => { finishRequest = resolve }))
  renderSidebar({ ...progress, complete: true })
  fireEvent.click(expectReflowableCertificate())
  const busy = expectReflowableCertificate('Wird erstellt …')
  expect(busy).toBeDisabled()
  expect(global.fetch).toHaveBeenCalledWith('/api/courses/course/certificate', { method: 'POST' })
  fireEvent.click(busy)
  expect(global.fetch).toHaveBeenCalledTimes(1)

  await act(async () => { finishRequest({ ok: false, status: 403 } as Response) })
  expect(expectReflowableCertificate()).toBeEnabled()
})
