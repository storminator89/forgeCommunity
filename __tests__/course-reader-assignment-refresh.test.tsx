import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LearnerAssignmentRenderer } from '@/app/courses/[courseId]/contents/LearnerAssignmentRenderer'

const props = { courseId: 'course', contentId: 'assignment', publicationId: 'pub', contentVersionToken: 'token',
  content: JSON.stringify({ prompt: 'Eine kurze Reflexion schreiben.', passingScore: 70 }) }
const pending = { maySubmit: true, passingScore: 70, submissions: [{ id: 'submission', response: 'Bisherige Antwort', attemptNumber: 1,
  submittedAt: '2026-10-16T10:00:00.000Z', currentRevision: true, decisions: [] }] }
const passed = { ...pending, submissions: [{ ...pending.submissions[0], decisions: [{ id: 'grade', action: 'GRADED', score: 85,
  feedback: 'Gut begründet.', passed: true, createdAt: '2026-10-16T11:00:00.000Z', sequence: 1 }] }] }
const response = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response

it('rereads assignment status on the explicit reader refresh without discarding an unsent answer', async () => {
  let finishRefresh!: (value: Response) => void
  const request = jest.fn().mockResolvedValueOnce(response(pending)).mockImplementationOnce(() => new Promise<Response>(resolve => { finishRefresh = resolve }))
  global.fetch = request
  const view = render(<LearnerAssignmentRenderer {...props} refreshKey={0} />)
  expect(await screen.findByText('Bewertung ausstehend')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Neue Antwort' }), { target: { value: 'Meine noch ungesendete Ergänzung' } })
  const answer = screen.getByRole('textbox', { name: 'Neue Antwort' })
  answer.focus()
  view.rerender(<LearnerAssignmentRenderer {...props} refreshKey={1} />)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(answer).toHaveFocus()
  await act(async () => { finishRefresh(response(passed)) })
  expect(await screen.findByText('Bestanden · 85 von 100 Punkten')).toBeInTheDocument()
  expect(answer).toHaveFocus()
  expect(screen.getByRole('textbox', { name: 'Neue Antwort' })).toHaveValue('Meine noch ungesendete Ergänzung')
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls.every(call => !call[1]?.method)).toBe(true)
})

it('ignores an older status response after a newer reader refresh', async () => {
  let finishOld!: (value: Response) => void
  const request = jest.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve })).mockResolvedValueOnce(response(passed))
  global.fetch = request
  const view = render(<LearnerAssignmentRenderer {...props} refreshKey={0} />)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  view.rerender(<LearnerAssignmentRenderer {...props} refreshKey={1} />)
  expect(await screen.findByText('Bestanden · 85 von 100 Punkten')).toBeInTheDocument()
  await act(async () => { finishOld(response(pending)) })
  expect(screen.getByText('Bestanden · 85 von 100 Punkten')).toBeInTheDocument()
  expect(screen.queryByText('Bewertung ausstehend')).not.toBeInTheDocument()
})
