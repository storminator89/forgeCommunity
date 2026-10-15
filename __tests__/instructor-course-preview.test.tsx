import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { InstructorCoursePreview } from '@/app/courses/[courseId]/contents/InstructorCoursePreview'
import type { CourseContent, QuizContent } from '@/app/courses/[courseId]/contents/types'

jest.mock('@/components/Editor', () => ({ Editor: () => <p>Editor darf in der Vorschau nicht erscheinen</p> }))
jest.mock('@/app/courses/[courseId]/contents/QuizEditor', () => ({ QuizEditor: () => <p>Quiz-Editor darf in der Vorschau nicht erscheinen</p> }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'owner', role: 'ADMIN' } } }) }))

const lesson = (id: string, extra: Partial<CourseContent> = {}): CourseContent => ({ id, courseId: 'course', title: id, type: 'TEXT', content: '<p>Lerninhalt</p>', order: 1, parentId: null, ...extra })
const quiz: QuizContent = { questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Welche Antwort?', options: ['Richtig', 'Andere'], correctAnswers: [0] }], passingScore: 70 }

beforeEach(() => { jest.mocked(fetch).mockClear() })

it('shows and sanitizes the unsaved lesson without changing saved content', () => {
  const saved = [lesson('chapter', { content: '', subContents: [lesson('text', { title: 'Gespeicherter Titel', parentId: 'chapter' })] })]
  const original = JSON.stringify(saved)
  render(<InstructorCoursePreview open onOpenChange={jest.fn()} courseTitle="Mein Kurs" contents={saved} selectedContentId="text" draft={lesson('text', { title: 'Lokaler Titel', content: '<p>Nur im Entwurf</p><img src="javascript:alert(1)"><script>alert(1)</script>' })} />)
  expect(screen.getByRole('heading', { name: 'Lokaler Titel' })).toBeInTheDocument()
  expect(screen.getByText(/Ungespeicherter Entwurf/)).toBeInTheDocument()
  expect(screen.getByText('Nur im Entwurf')).toBeInTheDocument()
  expect(screen.queryByText('Lerninhalt')).not.toBeInTheDocument()
  expect(document.querySelector('script')).toBeNull()
  expect(document.querySelector('img')).not.toHaveAttribute('src')
  expect(JSON.stringify(saved)).toBe(original)
  expect(fetch).not.toHaveBeenCalled()
})

it('navigates nested content and safely ignores an invalid initial selection', () => {
  render(<InstructorCoursePreview open onOpenChange={jest.fn()} courseTitle="Kurs" selectedContentId="missing" contents={[lesson('chapter', { content: '', subContents: [lesson('child', { parentId: 'chapter', subContents: [lesson('deep', { parentId: 'child' })] })] })]} />)
  const nav = screen.getByRole('navigation', { name: 'Inhaltsverzeichnis der Vorschau' })
  expect(screen.getByRole('heading', { name: 'chapter' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zurück' })).toBeDisabled()
  fireEvent.click(within(nav).getByRole('button', { name: /Ebene 3: deep/ }))
  expect(screen.getByRole('heading', { name: 'deep' })).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
  expect(within(nav).getByRole('button', { name: /Ebene 3: deep/ })).toHaveAttribute('aria-current', 'page')
})

it('uses local quiz rehearsal even for an enrolled administrator and writes no learning records', () => {
  // An enrolled owner/admin can have real learner progress in the shell. Preview
  // intentionally has no progress/session props or mutation callbacks to inherit it.
  render(<InstructorCoursePreview open onOpenChange={jest.fn()} courseTitle="Kurs" contents={[lesson('quiz', { type: 'QUIZ', content: quiz, updatedAt: '2026-10-15T08:00:00.000Z' })]} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Richtig' }))
  expect(screen.getByRole('status')).toHaveTextContent('1 von 1 Vorschaufragen beantwortet')
  expect(screen.queryByRole('button', { name: 'Antwort prüfen' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Lösungen anzeigen' }))
  expect(screen.getByText('Lösung')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Antworten zurücksetzen' }))
  expect(screen.getByRole('radio', { name: 'Richtig' })).not.toBeChecked()
  expect(screen.queryByRole('button', { name: /abgeschlossen|zertifikat|anmelden/i })).not.toBeInTheDocument()
  const writes = jest.mocked(fetch).mock.calls.filter(([, options]) => options?.method && !['GET', 'HEAD'].includes(options.method))
  expect(writes).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

it('rehearses a legacy TEXT quiz locally without changing its stored type', () => {
  const legacy = lesson('legacy-quiz', { content: JSON.stringify(quiz) })
  render(<InstructorCoursePreview open onOpenChange={jest.fn()} courseTitle="Kurs" contents={[legacy]} />)
  expect(screen.getByRole('region', { name: 'Interaktive Quizvorschau' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Richtig' })).toBeInTheDocument()
  expect(legacy.type).toBe('TEXT')
  expect(fetch).not.toHaveBeenCalled()
})

it('retains existing H5P sandbox and safe video/audio renderers', () => {
  render(<InstructorCoursePreview open onOpenChange={jest.fn()} courseTitle="Kurs" contents={[lesson('h5p', { type: 'H5P', content: 'package_1' }), lesson('video', { type: 'VIDEO', content: '/uploads/lesson.mp4' }), lesson('audio', { type: 'AUDIO', content: '/uploads/lesson.mp3' })]} />)
  const content = within(screen.getByRole('region', { name: 'Inhalt der Vorschau' }))
  expect(content.getByTitle('h5p')).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-downloads')
  expect(content.getByTitle('h5p')).toHaveAttribute('src', '/h5p/embed/package_1')
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
  expect(screen.getByLabelText('video')).toHaveAttribute('src', '/uploads/lesson.mp4')
  fireEvent.click(screen.getByRole('button', { name: 'Weiter' }))
  expect(document.querySelector('audio')).toHaveAttribute('src', '/uploads/lesson.mp3')
  expect(fetch).not.toHaveBeenCalled()
})

it('restores focus, preserves external draft state and resets quiz answers across repeated dismissal', async () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    return <><input aria-label="Editorentwurf" defaultValue="Mein Entwurf" /><button onClick={() => setOpen(true)}>Vorschau öffnen</button><InstructorCoursePreview open={open} onOpenChange={setOpen} courseTitle="Kurs" contents={[lesson('quiz', { type: 'QUIZ', content: quiz })]} /></>
  }
  render(<Harness />)
  const trigger = screen.getByRole('button', { name: 'Vorschau öffnen' })
  trigger.focus()
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('radio', { name: 'Richtig' }))
  fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))
  await waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.getByLabelText('Editorentwurf')).toHaveValue('Mein Entwurf')
  fireEvent.click(trigger)
  expect(screen.getByRole('radio', { name: 'Richtig' })).not.toBeChecked()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', code: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(trigger).toHaveFocus()
  expect(fetch).not.toHaveBeenCalled()
})

it('renders useful empty and malformed-quiz states without creating data', () => {
  const view = render(<InstructorCoursePreview open onOpenChange={jest.fn()} courseTitle="Kurs" contents={[]} />)
  expect(screen.getByRole('heading', { name: 'Noch keine Inhalte für die Vorschau' })).toBeInTheDocument()
  view.rerender(<InstructorCoursePreview open onOpenChange={jest.fn()} courseTitle="Kurs" contents={[lesson('broken', { type: 'QUIZ', content: '{bad' })]} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Die Quizdaten können nicht angezeigt werden')
  expect(fetch).not.toHaveBeenCalled()
})
