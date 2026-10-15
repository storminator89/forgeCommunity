import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LearnerQuizRenderer } from '@/app/courses/[courseId]/contents/LearnerQuizRenderer'

const redacted = JSON.stringify({ shuffleQuestions: false, passingScore: 70, questions: [
  { id: 'a', type: 'SINGLE_CHOICE', question: 'Welche Antwort?', options: ['Falsch', 'Richtig'] },
  { id: 'b', type: 'FILL_BLANKS', question: 'Lückentext?', text: 'Antwort: [blank]', blankCount: 1 },
] })

const allTypes = JSON.stringify({ shuffleQuestions: false, passingScore: 70, questions: [
  { id: 'single', type: 'SINGLE_CHOICE', question: 'Einfach?', options: ['Eins', 'Zwei'] },
  { id: 'multi', type: 'MULTIPLE_CHOICE', question: 'Mehrfach?', options: ['M eins', 'M zwei'] },
  { id: 'truth', type: 'TRUE_FALSE', question: 'Wahrheit?', options: ['Wahr', 'Falsch'] },
  { id: 'text', type: 'TEXT_INPUT', question: 'Freitext?' },
  { id: 'matching', type: 'MATCHING', question: 'Zuordnung?', pairs: [{ left: 'Begriff' }] },
  { id: 'blanks', type: 'FILL_BLANKS', question: 'Lücke?', text: '[blank]', blankCount: 1 },
] })

const props = {
  courseId: 'course', contentId: 'quiz', updatedAt: '2026-10-01T12:00:00.000Z',
  publicationId: 'pub-1', contentVersionToken: 'opaque-quiz', content: redacted,
}

beforeEach(() => jest.clearAllMocks())

test('submits redacted learner answers for server grading and reports only the server result', async () => {
  const onPassed = jest.fn()
  const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ score: 100, passed: true }) })
  global.fetch = request
  render(<LearnerQuizRenderer courseId="course" contentId="quiz" updatedAt="2026-10-01T12:00:00.000Z" publicationId="pub-1" contentVersionToken="opaque-quiz" content={redacted} onPassed={onPassed} />)
  expect(screen.queryByText(/Richtige Antwort/)).not.toBeInTheDocument()
  const submit = screen.getByRole('button', { name: 'Antworten abgeben' })
  expect(submit).toBeDisabled()
  fireEvent.click(screen.getByRole('radio', { name: 'Richtig' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Antwort' } })
  expect(submit).toBeEnabled()
  fireEvent.click(submit)
  expect(await screen.findByText(/100.0% erreicht. Bestanden!/)).toBeInTheDocument()
  expect(onPassed).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledTimes(1)
  const sent = JSON.parse(request.mock.calls[0][1].body)
  expect(sent).toMatchObject({ publicationId: 'pub-1', contentVersionToken: 'opaque-quiz', answers: { a: [1], b: ['Antwort'] } })
  expect(sent).not.toHaveProperty('contentUpdatedAt')
  expect(sent).not.toHaveProperty('confidenceByQuestion')
  expect(sent.submissionId).toMatch(/^[a-zA-Z0-9_-]{8,100}$/)
  expect(JSON.stringify(sent)).not.toMatch(/correctAnswer|Richtige Antwort/)
})

test('offers optional confidence for all six question types without exposing answers or gating submission', async () => {
  const request = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ score: 50, passed: false }) })
  global.fetch = request
  render(<LearnerQuizRenderer {...props} content={allTypes} onPassed={jest.fn()} />)
  const confidenceGroups = screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })
  expect(confidenceGroups).toHaveLength(6)
  for (const group of confidenceGroups) {
    expect(within(group).getAllByRole('radio')).toHaveLength(5)
    expect(within(group).getByRole('radio', { name: 'Keine Angabe' })).not.toBeChecked()
  }
  const firstSure = within(confidenceGroups[0]).getByRole('radio', { name: 'Sicher' })
  firstSure.focus()
  expect(firstSure).toHaveFocus()
  await userEvent.keyboard(' ')
  expect(firstSure).toBeChecked()
  fireEvent.click(within(confidenceGroups[1]).getByRole('radio', { name: 'Eher sicher' }))
  fireEvent.click(within(confidenceGroups[2]).getByRole('radio', { name: 'Unsicher' }))
  fireEvent.click(within(confidenceGroups[3]).getByRole('radio', { name: 'Geraten' }))
  fireEvent.click(within(confidenceGroups[4]).getByRole('radio', { name: 'Sicher' }))
  fireEvent.click(within(confidenceGroups[4]).getByRole('radio', { name: 'Keine Angabe' }))
  expect(screen.getByRole('button', { name: 'Antworten abgeben' })).toBeDisabled()

  fireEvent.click(screen.getByRole('radio', { name: 'Zwei' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'M eins' }))
  fireEvent.click(screen.getByRole('radio', { name: 'Wahr' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Antwort zu Frage 4' }), { target: { value: 'Freie Antwort' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Begriff' }), { target: { value: 'Zuordnung' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 6, Lücke 1' }), { target: { value: 'Lückenantwort' } })
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  await screen.findByText(/50.0% erreicht/)
  const sent = JSON.parse(request.mock.calls[0][1].body)
  expect(sent.answers).toEqual({ single: [1], multi: [0], truth: [0], text: 'Freie Antwort', matching: ['Zuordnung'], blanks: ['Lückenantwort'] })
  expect(sent.confidenceByQuestion).toEqual({ single: 'SURE', multi: 'SOMEWHAT_SURE', truth: 'UNSURE', text: 'GUESSED' })
  expect(JSON.stringify(sent)).not.toMatch(/correctAnswer|Richtige Antwort/)
  expect(within(confidenceGroups[0]).getByRole('radio', { name: 'Sicher' })).toBeDisabled()
  expect(within(confidenceGroups[0]).getByRole('radio', { name: 'Sicher' })).toBeChecked()

  fireEvent.click(screen.getByRole('button', { name: 'Quiz wiederholen' }))
  expect(within(screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })[0]).getByRole('radio', { name: 'Sicher' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Antworten abgeben' })).toBeDisabled()
})

test('retries an uncertain network outcome with the same submission ID', async () => {
  const request = jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ score: 0, passed: false }) })
  global.fetch = request
  render(<LearnerQuizRenderer courseId="course" contentId="quiz" updatedAt="2026-10-01T12:00:00.000Z" publicationId="pub-1" contentVersionToken="opaque-quiz" content={redacted} onPassed={jest.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Falsch' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Versuch' } })
  fireEvent.click(within(screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })[0]).getByRole('radio', { name: 'Geraten' }))
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
  fireEvent.click(screen.getByRole('button', { name: 'Abgabe erneut prüfen' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(JSON.parse(request.mock.calls[0][1].body).submissionId).toBe(JSON.parse(request.mock.calls[1][1].body).submissionId)
  expect(request.mock.calls[0][1].body).toBe(request.mock.calls[1][1].body)
})

test('a lost response freezes the submitted payload until the same attempt is resolved', async () => {
  const request = jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ score: 0, passed: false }) })
  global.fetch = request
  render(<LearnerQuizRenderer {...props} onPassed={jest.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Falsch' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Versuch' } })
  const firstConfidence = screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })[0]
  fireEvent.click(within(firstConfidence).getByRole('radio', { name: 'Geraten' }))
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  await screen.findByRole('alert')
  expect(screen.getByText('Deine Antworten sind bis zur Klärung gesperrt. Die erneute Prüfung verwendet dieselbe Abgabe.')).toBeInTheDocument()
  expect(within(firstConfidence).getByRole('radio', { name: 'Keine Angabe' })).toBeDisabled()
  expect(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' })).toBeDisabled()
  fireEvent.click(within(firstConfidence).getByRole('radio', { name: 'Keine Angabe' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Verändert' } })
  expect(within(firstConfidence).getByRole('radio', { name: 'Geraten' })).toBeChecked()
  expect(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' })).toHaveValue('Versuch')
  fireEvent.click(screen.getByRole('button', { name: 'Abgabe erneut prüfen' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  const first = JSON.parse(request.mock.calls[0][1].body)
  const second = JSON.parse(request.mock.calls[1][1].body)
  expect(first.submissionId).toBe(second.submissionId)
  expect(first.confidenceByQuestion).toEqual({ a: 'GUESSED' })
  expect(second).toEqual(first)
})

test('a stale publication keeps learner answers while requesting a reload', async () => {
  const request = jest.fn().mockResolvedValue({ ok: false, status: 412 })
  global.fetch = request
  render(<LearnerQuizRenderer courseId="course" contentId="quiz" publicationId="pub-1" contentVersionToken="opaque-quiz" content={redacted} onPassed={jest.fn()} updatedAt="2026-10-01T12:00:00.000Z" />)
  fireEvent.click(screen.getByRole('radio', { name: 'Richtig' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Meine Antwort' } })
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Deine Antworten sind hier noch sichtbar')
  expect(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' })).toHaveValue('Meine Antwort')
  expect(screen.getByRole('button', { name: 'Antworten abgeben' })).toBeDisabled()
})

test.each([
  ['publication', { publicationId: 'pub-2' }],
  ['content version', { contentVersionToken: 'opaque-quiz-2' }],
])('a changed %s resets unsubmitted answers and confidence', (_change, update) => {
  const { rerender } = render(<LearnerQuizRenderer {...props} onPassed={jest.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Richtig' }))
  fireEvent.click(within(screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })[0]).getByRole('radio', { name: 'Sicher' }))
  rerender(<LearnerQuizRenderer {...props} {...update} onPassed={jest.fn()} />)
  expect(screen.getByRole('radio', { name: 'Richtig' })).not.toBeChecked()
  expect(within(screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })[0]).getByRole('radio', { name: 'Sicher' })).not.toBeChecked()
  expect(screen.getByRole('button', { name: 'Antworten abgeben' })).toBeDisabled()
})

test('a new publication clears the old attempt and ignores an old grade result', async () => {
  let resolveOld: (value: unknown) => void = () => {}
  const request = jest.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ score: 0, passed: false }) })
  global.fetch = request
  const onPassed = jest.fn()
  const { rerender } = render(<LearnerQuizRenderer {...props} onPassed={onPassed} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Richtig' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Alt' } })
  fireEvent.click(within(screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })[0]).getByRole('radio', { name: 'Sicher' }))
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  expect(screen.getByRole('button', { name: 'Wird geprüft …' })).toBeDisabled()
  expect(within(screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })[0]).getByRole('radio', { name: 'Sicher' })).toBeDisabled()

  rerender(<LearnerQuizRenderer {...props} publicationId="pub-2" contentVersionToken="opaque-quiz-2" onPassed={onPassed} />)
  expect(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' })).toHaveValue('')
  expect(within(screen.getAllByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })[0]).getByRole('radio', { name: 'Sicher' })).not.toBeChecked()
  await act(async () => { resolveOld({ ok: true, json: async () => ({ score: 100, passed: true }) }) })
  expect(onPassed).not.toHaveBeenCalled()
  expect(screen.queryByText(/100.0% erreicht/)).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('radio', { name: 'Falsch' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Neu' } })
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  await screen.findByText(/0.0% erreicht/)
  const first = JSON.parse(request.mock.calls[0][1].body)
  const second = JSON.parse(request.mock.calls[1][1].body)
  expect(second.submissionId).not.toBe(first.submissionId)
  expect(second.publicationId).toBe('pub-2')
  expect(second.contentVersionToken).toBe('opaque-quiz-2')
  expect(second).not.toHaveProperty('confidenceByQuestion')
})
