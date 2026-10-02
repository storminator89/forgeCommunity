import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuizEditor } from '@/app/courses/[courseId]/contents/QuizEditor'
import { QuizRenderer } from '@/app/courses/[courseId]/contents/QuizRenderer'
import { ContentRenderer } from '@/app/courses/[courseId]/contents/ContentRenderer'
import { CourseContent, QuizContent, getQuizValidationError, parseQuizContent } from '@/app/courses/[courseId]/contents/types'

jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Rich Text" value={content} onChange={event => onChange(event.target.value)} /> }))

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn()
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = jest.fn()
  HTMLElement.prototype.releasePointerCapture = jest.fn()
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})
beforeEach(() => jest.clearAllMocks())

const choice = (): QuizContent => ({
  shuffleQuestions: false,
  passingScore: 0,
  questions: [{ id: 'q1', type: 'SINGLE_CHOICE', question: 'Welche Option?', options: ['A', 'B', 'C'], correctAnswers: [2] }],
})

it('reads legacy string quizzes and preserves metadata, threshold zero and legacy answers', () => {
  const parsed = parseQuizContent(JSON.stringify({ shuffleQuestions: true, passingScore: 0, custom: 'keep', questions: [{ question: 'Alt?', options: ['Ja', 'Nein'], correctAnswer: 1 }] }))
  expect(parsed).toMatchObject({ shuffleQuestions: true, passingScore: 0, custom: 'keep', questions: [{ type: 'SINGLE_CHOICE', correctAnswer: 1, correctAnswers: [1] }] })
  expect(getQuizValidationError(parsed!)).toBeNull()
  expect(parseQuizContent('{broken')).toBeNull()
  expect(parseQuizContent({ questions: [{ question: 'Unknown', type: 'UNSUPPORTED' }] })).toBeNull()
})

it('initializes shuffle and passing score from persisted JSON strings', () => {
  const quiz = { ...choice(), shuffleQuestions: true, passingScore: 85 }
  render(<QuizEditor initialContent={JSON.stringify(quiz)} onSave={jest.fn()} />)
  expect(screen.getByRole('switch', { name: 'Fragen mischen' })).toBeChecked()
  expect(screen.getByLabelText('Bestehensgrenze (%)')).toHaveValue(85)
})

it('keeps a temporarily blank numeric draft editable after remount', () => {
  render(<QuizEditor initialContent={{ ...choice(), passingScore: NaN }} onSave={jest.fn()} />)
  expect(screen.getByLabelText('Bestehensgrenze (%)')).toHaveValue(null)
  expect(screen.getByLabelText('Frage 1, Option 3')).toHaveValue('C')
  fireEvent.change(screen.getByLabelText('Bestehensgrenze (%)'), { target: { value: '80' } })
  expect(screen.getByLabelText('Bestehensgrenze (%)')).toHaveValue(80)
})

it('can add a question on LAN HTTP where randomUUID is unavailable', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
  Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined })
  try {
    render(<QuizEditor initialContent={choice()} onSave={jest.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Neue Frage' }))
    expect(screen.getAllByLabelText('Frage')).toHaveLength(2)
  } finally {
    if (descriptor) Object.defineProperty(globalThis.crypto, 'randomUUID', descriptor)
    else Reflect.deleteProperty(globalThis.crypto, 'randomUUID')
  }
})

it('does not overwrite malformed persisted quiz content with an empty draft', () => {
  const onSave = jest.fn(), onChange = jest.fn()
  render(<QuizEditor initialContent="{broken" onSave={onSave} onChange={onChange} />)
  expect(screen.getByText(/Der vorhandene Inhalt bleibt erhalten/)).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
  expect(onChange).not.toHaveBeenCalled()
})

it('publishes live quiz drafts without mutating the original and reindexes correct answers after deletion', async () => {
  const initial = choice(), onChange = jest.fn(), onSave = jest.fn()
  render(<QuizEditor initialContent={initial} onChange={onChange} onSave={onSave} />)
  expect(screen.getByLabelText('Bestehensgrenze (%)')).toHaveValue(0)
  fireEvent.change(screen.getByLabelText('Frage 1, Option 3'), { target: { value: 'Geändert' } })
  fireEvent.click(screen.getByRole('button', { name: 'Frage 1, Option 1 entfernen' }))
  expect(initial.questions[0]).toMatchObject({ options: ['A', 'B', 'C'], correctAnswers: [2] })
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ passingScore: 0, questions: [expect.objectContaining({ options: ['B', 'Geändert'], correctAnswers: [1] })] }))
  fireEvent.click(screen.getByRole('button', { name: 'Quiz speichern' }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ passingScore: 0, questions: [expect.objectContaining({ correctAnswers: [1] })] })))
})

it('does not save or submit an enclosing form when opening the preview', async () => {
  const onSave = jest.fn(), onSubmit = jest.fn(event => event.preventDefault())
  render(<form onSubmit={onSubmit}><QuizEditor initialContent={choice()} onSave={onSave} /></form>)
  await userEvent.click(screen.getByRole('tab', { name: 'Vorschau' }))
  expect(screen.getByText('Quiz Vorschau')).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
  expect(onSubmit).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Quiz speichern' }))
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onSubmit).not.toHaveBeenCalled()
})

it('preserves each question-type draft when switching away and back', async () => {
  render(<QuizEditor initialContent={choice()} onSave={jest.fn()} />)
  await userEvent.click(screen.getByRole('combobox', { name: 'Fragetyp für Frage 1' }))
  await userEvent.click(screen.getByRole('option', { name: 'Freitext' }))
  fireEvent.change(screen.getByLabelText('Richtige Antwort für Frage 1'), { target: { value: 'Meine Antwort' } })
  await userEvent.click(screen.getByRole('combobox', { name: 'Fragetyp für Frage 1' }))
  await userEvent.click(screen.getByRole('option', { name: 'Einfachauswahl' }))
  expect(screen.getByLabelText('Frage 1, Option 3')).toHaveValue('C')
  expect(screen.getByRole('button', { name: 'Frage 1, Option 3 als richtig markieren' })).toHaveAttribute('aria-pressed', 'true')
  await userEvent.click(screen.getByRole('combobox', { name: 'Fragetyp für Frage 1' }))
  await userEvent.click(screen.getByRole('option', { name: 'Freitext' }))
  expect(screen.getByLabelText('Richtige Antwort für Frage 1')).toHaveValue('Meine Antwort')
})

it('reorders questions only on a drop inside the editor, not on a cancelled drag', () => {
  const quiz = choice(), onChange = jest.fn()
  quiz.questions.push({ ...quiz.questions[0], id: 'q2', question: 'Zweite Frage' })
  render(<QuizEditor initialContent={quiz} onSave={jest.fn()} onChange={onChange} />)
  const header = screen.getByText('Frage 1').closest('[draggable]')!
  const target = screen.getByText('Frage 2').closest('.relative')!
  const dataTransfer = { effectAllowed: '' }
  fireEvent.dragStart(header, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.dragEnd(header, { dataTransfer })
  expect(onChange.mock.calls.at(-1)[0].questions.map((question: { id: string }) => question.id)).toEqual(['q1', 'q2'])
  fireEvent.dragStart(header, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  expect(onChange.mock.calls.at(-1)[0].questions.map((question: { id: string }) => question.id)).toEqual(['q2', 'q1'])
})

it('rejects missing correct answers and an empty passing threshold before saving', () => {
  const onSave = jest.fn(), quiz = choice()
  quiz.questions[0] = { id: 'q1', type: 'SINGLE_CHOICE', question: 'Frage', options: ['A', 'B'], correctAnswers: [] }
  render(<QuizEditor initialContent={quiz} onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: 'Quiz speichern' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Markiere gültige richtige Antworten')
  fireEvent.change(screen.getByLabelText('Bestehensgrenze (%)'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: 'Quiz speichern' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Die Bestehensgrenze muss zwischen 0 und 100 liegen')
  expect(onSave).not.toHaveBeenCalled()
})

it('keeps the draft after a failed save and blocks duplicate requests', async () => {
  let reject!: (error: Error) => void
  const onSave = jest.fn(() => new Promise<void>((_, rejectRequest) => { reject = rejectRequest }))
  render(<QuizEditor initialContent={choice()} onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: 'Quiz speichern' }))
  expect(screen.getByRole('button', { name: 'Quiz wird gespeichert…' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Quiz wird gespeichert…' }))
  expect(onSave).toHaveBeenCalledTimes(1)
  reject(new Error('Server nicht erreichbar'))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Server nicht erreichbar'))
  expect(screen.getByLabelText('Frage 1, Option 3')).toHaveValue('C')
  expect(screen.getByRole('button', { name: 'Quiz speichern' })).toBeEnabled()
})

it('uses exclusive answers for true/false questions', () => {
  render(<QuizRenderer content={{ questions: [{ id: 'tf', type: 'TRUE_FALSE', question: 'Stimmt das?', options: ['Wahr', 'Falsch'], correctAnswers: [1] }] }} />)
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('radio', { name: 'Wahr' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Falsch' }))
  expect(screen.getByRole('radio', { name: 'Wahr' })).not.toBeChecked()
  expect(screen.getByRole('radio', { name: 'Falsch' })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }))
  expect(screen.getByText('✓ Richtig!')).toBeInTheDocument()
})

it('requires every blank, evaluates all blanks and keeps threshold zero', () => {
  render(<QuizRenderer content={{ passingScore: 0, questions: [{ id: 'fill', type: 'FILL_BLANKS', question: 'Ergänze', text: '[eins] und [zwei]', answers: ['Eins', 'Zwei'] }] }} />)
  fireEvent.change(screen.getByLabelText('Lücke 1'), { target: { value: ' eins ' } })
  expect(screen.getByRole('button', { name: 'Antwort prüfen' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Lücke 2'), { target: { value: 'falsch' } })
  fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }))
  expect(screen.getByText('✗ Falsch')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Quiz beenden' }))
  expect(screen.getByText('Du hast 0.0% erreicht - Bestanden!')).toBeInTheDocument()
})

it('disables checking after deselecting the last multiple-choice answer', () => {
  render(<QuizRenderer content={{ questions: [{ id: 'multi', type: 'MULTIPLE_CHOICE', question: 'Wähle', options: ['A', 'B'], correctAnswers: [0] }] }} />)
  const option = screen.getByRole('checkbox', { name: 'A' })
  fireEvent.click(option)
  expect(screen.getByRole('button', { name: 'Antwort prüfen' })).toBeEnabled()
  fireEvent.click(option)
  expect(screen.getByRole('button', { name: 'Antwort prüfen' })).toBeDisabled()
})

it('resets a running quiz when its persisted content changes', () => {
  const { rerender } = render(<QuizRenderer content={choice()} />)
  fireEvent.click(screen.getByRole('radio', { name: 'C' }))
  fireEvent.click(screen.getByRole('button', { name: 'Antwort prüfen' }))
  const updated = choice()
  updated.questions[0] = { ...updated.questions[0], question: 'Neue Frage?' }
  rerender(<QuizRenderer content={JSON.stringify(updated)} />)
  expect(screen.getByText('Neue Frage?')).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'C' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Antwort prüfen' })).toBeDisabled()
})

const courseContent = (type: CourseContent['type'], content: string): CourseContent => ({ id: 'lesson', courseId: 'course', title: 'Lektion', type, content, order: 0, parentId: null })

it.each(['TEXT', 'QUIZ'] as const)('renders and edits a persisted %s string quiz', type => {
  const lesson = courseContent(type, JSON.stringify(choice()))
  const { rerender } = render(<ContentRenderer content={lesson} />)
  expect(screen.getByText('Welche Option?')).toBeInTheDocument()
  rerender(<ContentRenderer content={lesson} isEditing onSave={jest.fn()} />)
  expect(screen.getByLabelText('Frage')).toHaveValue('Welche Option?')
  expect(screen.getByRole('button', { name: 'Quiz speichern' })).toBeInTheDocument()
})

it('extracts only a safe H5P iframe source and rejects executable URLs', () => {
  const { rerender } = render(<ContentRenderer content={courseContent('H5P', '<iframe src="https://example.com/embed/123" onload="alert(1)"></iframe>')} />)
  expect(screen.getByTitle('Lektion')).toHaveAttribute('src', 'https://example.com/embed/123')
  expect(screen.getByTitle('Lektion')).not.toHaveAttribute('onload')
  rerender(<ContentRenderer content={courseContent('H5P', '<iframe src="javascript:alert(1)"></iframe>')} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Die H5P-Quelle ist ungültig')
  expect(screen.queryByTitle('Lektion')).not.toBeInTheDocument()
})

it('uses playable provider embeds and native controls for uploaded media', () => {
  const { rerender, container } = render(<ContentRenderer content={courseContent('VIDEO', 'https://vimeo.com/123456')} />)
  expect(screen.getByTitle('Lektion')).toHaveAttribute('src', 'https://player.vimeo.com/video/123456')
  rerender(<ContentRenderer content={courseContent('AUDIO', 'https://open.spotify.com/track/ABC123')} />)
  expect(screen.getByTitle('Lektion')).toHaveAttribute('src', 'https://open.spotify.com/embed/track/ABC123')
  expect(container.querySelector('audio')).toBeNull()
  rerender(<ContentRenderer content={courseContent('AUDIO', '/uploads/lesson.mp3')} />)
  expect(container.querySelector('audio')).toHaveAttribute('src', '/uploads/lesson.mp3')
  expect(container.querySelector('audio')).toHaveAttribute('controls')
  rerender(<ContentRenderer content={courseContent('VIDEO', '/uploads/lesson.mp4')} />)
  expect(container.querySelector('video')).toHaveAttribute('src', '/uploads/lesson.mp4')
  expect(container.querySelector('video')).toHaveAttribute('controls')
})
