import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GradingClient } from '@/app/courses/[courseId]/grading/GradingClient'

const mockRouter = { push: jest.fn(), replace: jest.fn() }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/page-state', () => ({
  PageState: ({ title, description }: { title: string; description?: string }) => <div role="alert"><p>{title}</p><p>{description}</p></div>,
  RetryButton: () => null,
}))

const row = { id: 'submission-1', contentId: 'assignment-1', title: 'Private Aufgabe', learner: { id: 'learner-1', name: 'Lernende Person' },
  response: 'Private learner response', submittedAt: '2026-10-15T12:00:00.000Z', attemptNumber: 1, isLatest: true, passingScore: 70, decisions: [] }
const reply = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data }) as Response

it.each(['grade', 'reload'])('clears private learner responses after %s authorization is revoked', async point => {
  let reads = 0
  global.fetch = jest.fn(async (_input: RequestInfo | URL, options?: RequestInit) => {
    if (options?.method === 'POST') return point === 'grade' ? reply({ error: 'Forbidden' }, 403) : reply({ decision: { id: 'decision-1' } })
    reads++
    return point === 'reload' && reads > 1 ? reply({ error: 'Forbidden' }, 403) : reply({ submissions: [row], nextCursor: null })
  })
  render(<GradingClient courseId="course-1" sessionStatus="authenticated" />)
  expect(await screen.findByText('Private learner response')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Punkte (0–100)'), { target: { value: '80' } })
  fireEvent.click(screen.getByRole('button', { name: 'Bewertung speichern' }))
  await waitFor(() => expect(screen.queryByText('Private learner response')).not.toBeInTheDocument())
  expect(screen.getByRole('alert')).toHaveTextContent('keinen Zugriff mehr')
})
