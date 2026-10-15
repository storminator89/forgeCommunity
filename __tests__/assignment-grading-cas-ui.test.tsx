import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GradingClient } from '@/app/courses/[courseId]/grading/GradingClient'

const mockRouter = { push: jest.fn(), replace: jest.fn() }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/page-state', () => ({
  PageState: ({ title }: { title: string }) => <div>{title}</div>,
  RetryButton: () => null,
}))

const row = { id: 'submission-cas-1', contentId: 'assignment-cas-1', title: 'Assignment',
  learner: { id: 'learner-cas-1', name: 'Learner' }, response: 'Private response',
  submittedAt: '2026-10-15T12:00:00.000Z', attemptNumber: 1, isLatest: true, passingScore: 70 }
const currentDecision = { id: 'remote-decision-1', action: 'GRADED', score: 90, feedback: 'Another grader feedback',
  passed: true, createdAt: '2026-10-15T12:01:00.000Z', sequence: 1 }
const reply = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response

test('stale grade response reloads and resets the form before a correction', async () => {
  let reads = 0
  const posts: Array<Record<string, unknown>> = []
  global.fetch = jest.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts.push(JSON.parse(options.body as string) as Record<string, unknown>)
      return posts.length === 1 ? reply({ error: 'Changed' }, 409) : reply({ decision: { id: 'correction-decision-2' } })
    }
    reads++
    return reply({ submissions: [{ ...row, decisions: reads === 1 ? [] : [currentDecision] }], nextCursor: null })
  })

  render(<GradingClient courseId="course-cas-1" sessionStatus="authenticated" />)
  const score = await screen.findByLabelText('Punkte (0–100)') as HTMLInputElement
  fireEvent.change(score, { target: { value: '20' } })
  fireEvent.change(screen.getByLabelText('Rückmeldung (optional)'), { target: { value: 'Stale feedback' } })
  fireEvent.click(screen.getByRole('button', { name: 'Bewertung speichern' }))
  await waitFor(() => expect(posts).toHaveLength(1))
  expect(posts[0].expectedDecisionId).toBeNull()
  await waitFor(() => expect((screen.getByLabelText('Punkte (0–100)') as HTMLInputElement).value).toBe('90'))
  expect((screen.getByLabelText('Rückmeldung (optional)') as HTMLTextAreaElement).value).toBe('Another grader feedback')
  expect(screen.queryByText(/Die Abgabe oder Bewertung wurde zwischenzeitlich geändert/)).not.toBeNull()

  fireEvent.change(screen.getByLabelText('Punkte (0–100)'), { target: { value: '95' } })
  fireEvent.click(screen.getByRole('button', { name: 'Korrektur speichern' }))
  await waitFor(() => expect(posts).toHaveLength(2))
  expect(posts[1].expectedDecisionId).toBe(currentDecision.id)
})
