import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ContentRenderer } from '@/app/courses/[courseId]/contents/ContentRenderer'
import { LearnerQuizRenderer } from '@/app/courses/[courseId]/contents/LearnerQuizRenderer'
import { LearnerAssignmentRenderer } from '@/app/courses/[courseId]/contents/LearnerAssignmentRenderer'
import type { CourseContent } from '@/app/courses/[courseId]/contents/types'

jest.mock('@/components/Editor', () => ({ Editor: () => null }))
const quiz = JSON.stringify({ shuffleQuestions: false, passingScore: 70, questions: [{ id: 'q', type: 'TEXT_INPUT', question: 'Private Frage?' }] })
const assignment = JSON.stringify({ prompt: 'Private Reflexion.', passingScore: 70 })
const quizProps = { courseId: 'course', contentId: 'quiz', publicationId: 'pub', contentVersionToken: 'token', updatedAt: undefined, content: quiz }
const assignmentProps = { courseId: 'course', contentId: 'assignment', publicationId: 'pub', contentVersionToken: 'token', content: assignment }
const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response
const status = { maySubmit: true, passingScore: 70, submissions: [] }
function submitQuiz() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Antwort zu Frage 1' }), { target: { value: 'Private Antwort' } })
  fireEvent.click(screen.getByRole('button', { name: 'Antworten abgeben' }))
}
async function submitAssignment() {
  const input = await screen.findByRole('textbox', { name: 'Deine Antwort' })
  fireEvent.change(input, { target: { value: 'Meine Reflexion' } })
  fireEvent.click(screen.getByRole('button', { name: 'Antwort abgeben' }))
}

it.each([401, 403, 404, 409, 412, 423])('reports active quiz issue %s without emitting a pass', async code => {
  global.fetch = jest.fn().mockResolvedValue(response({}, code))
  const issue = jest.fn(), passed = jest.fn()
  render(<LearnerQuizRenderer {...quizProps} onPassed={passed} onReaderIssue={issue} />)
  submitQuiz()
  await screen.findByRole('alert')
  expect(issue).toHaveBeenCalledWith(code)
  expect(passed).not.toHaveBeenCalled()
})

it('does not report a late quiz denial from an unmounted publication', async () => {
  let finish!: (value: Response) => void
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  const issue = jest.fn()
  const view = render(<LearnerQuizRenderer {...quizProps} onPassed={jest.fn()} onReaderIssue={issue} />)
  submitQuiz()
  view.rerender(<LearnerQuizRenderer {...quizProps} publicationId="new" onPassed={jest.fn()} onReaderIssue={issue} />)
  await act(async () => { finish(response({}, 403)) })
  expect(issue).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Antwort zu Frage 1' })).toHaveValue('')
})

it.each([401, 403, 404, 409, 412, 423])('reports active assignment GET issue %s', async code => {
  global.fetch = jest.fn().mockResolvedValue(response({}, code))
  const issue = jest.fn()
  render(<LearnerAssignmentRenderer {...assignmentProps} onReaderIssue={issue} />)
  await screen.findByRole('alert')
  expect(issue).toHaveBeenCalledWith(code)
})

it.each([403, 412])('reports active assignment POST issue %s without reporting a successful change', async code => {
  global.fetch = jest.fn().mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response({}, code))
  const issue = jest.fn(), changed = jest.fn()
  render(<LearnerAssignmentRenderer {...assignmentProps} onReaderIssue={issue} onChanged={changed} />)
  await submitAssignment()
  await screen.findByRole('alert')
  expect(issue).toHaveBeenCalledWith(code)
  expect(changed).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Deine Antwort' })).toHaveValue('Meine Reflexion')
})

it('ignores an older assignment GET denial after a newer same-lesson refresh', async () => {
  let finish!: (value: Response) => void
  const request = jest.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve })).mockResolvedValueOnce(response(status))
  global.fetch = request
  const issue = jest.fn()
  const view = render(<LearnerAssignmentRenderer {...assignmentProps} refreshKey={0} onReaderIssue={issue} />)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  view.rerender(<LearnerAssignmentRenderer {...assignmentProps} refreshKey={1} onReaderIssue={issue} />)
  await screen.findByRole('textbox', { name: 'Deine Antwort' })
  await act(async () => { finish(response({}, 403)) })
  expect(issue).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Deine Antwort' })).toBeInTheDocument()
})

it('ignores a delayed assignment POST denial after a publication remount', async () => {
  let finish!: (value: Response) => void
  global.fetch = jest.fn().mockResolvedValueOnce(response(status)).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve })).mockResolvedValueOnce(response(status))
  const issue = jest.fn()
  const view = render(<LearnerAssignmentRenderer {...assignmentProps} onReaderIssue={issue} />)
  await submitAssignment()
  view.rerender(<LearnerAssignmentRenderer {...assignmentProps} publicationId="new" onReaderIssue={issue} />)
  await screen.findByRole('textbox', { name: 'Deine Antwort' })
  await act(async () => { finish(response({}, 403)) })
  expect(issue).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Deine Antwort' })).toHaveValue('')
})

it('ignores a delayed post-submit assignment status denial after a publication remount', async () => {
  let finish!: (value: Response) => void
  const request = jest.fn().mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response({}, 201))
    .mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve })).mockResolvedValueOnce(response(status))
  global.fetch = request
  const issue = jest.fn(), changed = jest.fn()
  const view = render(<LearnerAssignmentRenderer {...assignmentProps} onReaderIssue={issue} onChanged={changed} />)
  await submitAssignment()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3))
  view.rerender(<LearnerAssignmentRenderer {...assignmentProps} publicationId="new" onReaderIssue={issue} onChanged={changed} />)
  await screen.findByRole('textbox', { name: 'Deine Antwort' })
  await act(async () => { finish(response({}, 403)) })
  expect(issue).not.toHaveBeenCalled()
  expect(changed).not.toHaveBeenCalled()
})

it.each(['QUIZ', 'ASSIGNMENT'] as const)('passes the optional Reader callback through ContentRenderer for %s', async type => {
  const issue = jest.fn()
  const content: CourseContent = { id: 'content', courseId: 'course', title: 'Private Lektion', type, content: type === 'QUIZ' ? quiz : assignment,
    publicationId: 'pub', contentVersionToken: 'token', order: 1, parentId: null }
  global.fetch = jest.fn().mockResolvedValue(response({}, 403))
  render(<ContentRenderer content={content} learnerQuiz onReaderIssue={issue} />)
  if (type === 'QUIZ') submitQuiz()
  await screen.findByRole('alert')
  expect(issue).toHaveBeenCalledWith(403)
})
