import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LearnerQuizRenderer } from '@/app/courses/[courseId]/contents/LearnerQuizRenderer'

const redacted = JSON.stringify({ shuffleQuestions: false, passingScore: 70, questions: [
  { id: 'a', type: 'SINGLE_CHOICE', question: 'Welche Antwort?', options: ['Falsch', 'Richtig'] },
  { id: 'b', type: 'FILL_BLANKS', question: 'Lückentext?', text: 'Antwort: [blank]', blankCount: 1 },
] })

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
  expect(sent.submissionId).toMatch(/^[a-zA-Z0-9_-]{8,100}$/)
  expect(JSON.stringify(sent)).not.toMatch(/correctAnswer|Richtige Antwort/)
})

test('retries an uncertain network outcome with the same submission ID', async () => {
  const request = jest.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ score: 0, passed: false }) })
  global.fetch = request
  render(<LearnerQuizRenderer courseId="course" contentId="quiz" updatedAt="2026-10-01T12:00:00.000Z" publicationId="pub-1" contentVersionToken="opaque-quiz" content={redacted} onPassed={jest.fn()} />)
  fireEvent.click(screen.getByRole('radio', { name: 'Falsch' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Versuch' } })
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline')
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(JSON.parse(request.mock.calls[0][1].body).submissionId).toBe(JSON.parse(request.mock.calls[1][1].body).submissionId)
})

test('a stale publication keeps learner answers while requesting a reload', async () => {
  const request = jest.fn().mockResolvedValue({ ok: false, status: 412 })
  global.fetch = request
  render(<LearnerQuizRenderer courseId="course" contentId="quiz" publicationId="pub-1" contentVersionToken="opaque-quiz" content={redacted} onPassed={jest.fn()} updatedAt="2026-10-01T12:00:00.000Z" />)
  fireEvent.click(screen.getByRole('radio', { name: 'Richtig' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' }), { target: { value: 'Meine Antwort' } })
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Deine Antworten bleiben hier erhalten')
  expect(screen.getByRole('textbox', { name: 'Frage 2, Lücke 1' })).toHaveValue('Meine Antwort')
})
