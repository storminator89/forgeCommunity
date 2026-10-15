import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CourseContentsEditor } from '@/app/courses/[courseId]/contents/CourseContentsEditor'
import type { CourseContent } from '@/app/courses/[courseId]/contents/types'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'author' } } }) }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: () => null }))

const quiz = { questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Was stimmt?', options: ['Ja', 'Nein'], correctAnswers: [0] }], passingScore: 70 }
let saved: CourseContent
const response = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response

beforeAll(() => { global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } })
beforeEach(() => {
  history.replaceState({}, '', '/courses/course/contents?content=quiz')
  saved = { id: 'quiz', courseId: 'course', title: 'Wissenstest', type: 'QUIZ', content: JSON.stringify(quiz), parentId: null, order: 1, updatedAt: '2026-10-15T08:00:00.000Z' }
  global.fetch = jest.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input)
    if (options?.method === 'PUT') { saved = { ...saved, ...JSON.parse(String(options.body)), title: 'Kanonischer Quiztitel' }; return response(saved) }
    if (url.endsWith('/progress')) return response({ completedContentIds: [], complete: false, canTrack: true, hasCertificate: false, completedAt: null })
    if (url.endsWith('/contents')) return response([saved])
    return response({ id: 'course', name: 'Quizkurs', canEdit: true })
  })
})

it.each(['QUIZ', 'TEXT'] as const)('treats the real quiz editor initial normalized %s draft as the saved baseline', async type => {
  saved.type = type
  render(<CourseContentsEditor courseId="course" />)
  await screen.findByRole('form', { name: 'Inhalt bearbeiten' })
  await waitFor(() => expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument())
  expect(screen.getByText('Gespeicherter Inhalt')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Lernen' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Lernen' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('form', { name: 'Inhalt bearbeiten' })).not.toBeInTheDocument()
  if (type === 'QUIZ') expect(screen.getByRole('button', { name: 'Antworten abgeben' })).toBeInTheDocument()
  expect(jest.mocked(fetch).mock.calls.filter(([, options]) => options?.method)).toEqual([])
})

it('keeps a canonical saved quiz clean after remounting its real editor and preserves saved-live feedback', async () => {
  render(<CourseContentsEditor courseId="course" />)
  await screen.findByRole('form', { name: 'Inhalt bearbeiten' })
  fireEvent.change(screen.getByLabelText('Titel'), { target: { value: 'Lokaler Quiztitel' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Inhalt bearbeiten' }))
  await waitFor(() => expect(screen.getByLabelText('Titel')).toHaveValue('Kanonischer Quiztitel'))
  await waitFor(() => expect(screen.queryByText('Ungespeicherte Änderungen')).not.toBeInTheDocument())
  expect(screen.getByText('Inhalt gespeichert. Gespeicherte Änderungen sind sofort für Teilnehmende sichtbar.')).toBeVisible()
  expect(screen.getByText('Gespeicherter Inhalt')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Lernen' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(jest.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1)
})

// Temporarily invalid numeric values must still be recognized as unsaved.
it('keeps an incomplete real quiz numeric draft guarded after logical normalization', async () => {
  render(<CourseContentsEditor courseId="course" />)
  await screen.findByRole('form', { name: 'Inhalt bearbeiten' })
  fireEvent.change(screen.getByLabelText('Bestehensgrenze (%)'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Lernen' }))
  expect(screen.getByRole('alertdialog')).toHaveTextContent('Ungespeicherte Änderungen')
  fireEvent.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }))
  expect(screen.getByLabelText('Bestehensgrenze (%)')).toHaveValue(null)
  expect(jest.mocked(fetch).mock.calls.filter(([, options]) => options?.method)).toEqual([])
})
