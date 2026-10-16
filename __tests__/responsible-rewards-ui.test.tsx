import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from 'next-auth/react'
import { StatsCard } from '@/components/community/StatsCard'
import { LeaderboardCard } from '@/components/community/LeaderboardCard'
import CourseClient from '@/app/courses/CourseClient'

const mockRouter = { push: jest.fn() }
const mockToast = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }))

const course = {
  id: 'course-1', title: 'Sicherheitskurs', instructor: 'Lehrkraft', duration: 'Flexibel',
  startDate: null, endDate: null, category: 'Technik', participants: 0, maxStudents: null,
  price: null, currency: null, isEnrolled: false, completed: false, canDelete: false,
  imageUrl: null, canApproveRewards: true, rewardEligible: false,
}

function sessionAs(role: string) {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'u1', role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
}

beforeEach(() => {
  jest.clearAllMocks()
  sessionAs('ADMIN')
  global.fetch = jest.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/courses') return { ok: true, json: async () => [course] }
    if (url === '/api/admin/courses/course-1/reward-eligibility' && options?.method === 'PATCH') {
      return { ok: true, json: async () => ({ rewardEligible: JSON.parse(options.body as string).eligible }) }
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
})

it('shows private rewards and milestone independently of leaderboard placement', () => {
  render(<>
    <StatsCard stats={{ posts: 1, receivedLikes: 2, comments: 3 }} rewards={{ points: 50, completedCourses: 1, firstCourseCompleted: true }} rewardsLoading={false} rewardsError={false} isSignedIn />
    <LeaderboardCard users={[]} isLoading={false} />
  </>)
  expect(screen.getByText('Meine Punkte').nextElementSibling).toHaveTextContent('50')
  expect(screen.getByText('Meilenstein: Erster abgeschlossener Kurs').nextElementSibling).toHaveTextContent('Erreicht')
  expect(screen.getByText('3 unterschiedliche Kurse abschließen')).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Lernmeilenstein: 1 von 3 Kursen abgeschlossen' })).toHaveAttribute('value', '1')
  expect(screen.getByText('Noch keine öffentlichen Einträge.')).toBeInTheDocument()
  expect(screen.getByText(/Was zählt: Ein von Admins freigegebener Kurs/)).toBeInTheDocument()
})

it('lets metric labels and values wrap within their existing grid cells at enlarged text sizes', () => {
  render(<StatsCard stats={{ posts: 1234567890123456, receivedLikes: 2345678901234567, comments: 3456789012345678 }}
    rewards={{ points: 987654321012345, completedCourses: 3, firstCourseCompleted: true }}
    rewardsLoading={false} rewardsError={false} isSignedIn />)

  // DOM/class coverage is a reflow guard. The actual 320px/200% layout remains
  // checked by the strict Spark entry browser scenario and its geometry gate.
  for (const [label, value] of [
    ['Beiträge', '1234567890123456'], ['Likes', '2345678901234567'], ['Kommentare', '3456789012345678'],
    ['Meine Punkte', '987654321012345'], ['Mindestens einmal abgeschlossene Kurse', '3'],
    ['Meilenstein: Erster abgeschlossener Kurs', 'Erreicht'],
  ]) {
    const term = screen.getByText(label)
    const cell = term.parentElement!
    expect(term.tagName).toBe('DT')
    expect(term.nextElementSibling?.tagName).toBe('DD')
    expect(term.nextElementSibling?.textContent).toBe(value)
    expect(cell).toHaveClass('min-w-0', '[overflow-wrap:anywhere]')
    expect(cell).not.toHaveClass('overflow-hidden', 'truncate')
    expect(cell.parentElement).toHaveClass('grid-cols-2', 'gap-x-6')
  }
  const progress = screen.getByRole('progressbar', { name: 'Lernmeilenstein: 3 von 5 Kursen abgeschlossen' })
  expect(progress).toHaveAttribute('value', '3')
  expect(progress).toHaveAttribute('max', '5')
})

it('shows reachable private learning milestones without streak pressure or public ranking', () => {
  const view = render(<StatsCard stats={{ posts: 0, receivedLikes: 0, comments: 0 }} rewards={{ points: 0, completedCourses: 0, firstCourseCompleted: false }} rewardsLoading={false} rewardsError={false} isSignedIn />)
  expect(screen.getByRole('progressbar', { name: 'Lernmeilenstein: 0 von 1 Kurs abgeschlossen' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Kurse entdecken' })).toHaveAttribute('href', '/courses')
  view.rerender(<StatsCard stats={{ posts: 0, receivedLikes: 0, comments: 0 }} rewards={{ points: 0, completedCourses: 3, firstCourseCompleted: true }} rewardsLoading={false} rewardsError={false} isSignedIn />)
  expect(screen.getByRole('progressbar', { name: 'Lernmeilenstein: 3 von 5 Kursen abgeschlossen' })).toBeInTheDocument()
  view.rerender(<StatsCard stats={{ posts: 0, receivedLikes: 0, comments: 0 }} rewards={{ points: 0, completedCourses: 5, firstCourseCompleted: true }} rewardsLoading={false} rewardsError={false} isSignedIn />)
  expect(screen.getByText('Alle derzeitigen Lernmeilensteine erreicht.')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
});

it('explains a quiz-revision adjustment without erasing the historical milestone', () => {
  render(<StatsCard stats={{ posts: 0, receivedLikes: 0, comments: 0 }} rewards={{
    points: 0, completedCourses: 1, firstCourseCompleted: true,
    history: [{ type: 'REVOKED', reason: 'QUIZ_REVISED', pointsDelta: -50, at: '2026-10-14T10:00:00.000Z', courseTitle: 'Sicherheitskurs' }],
  }} rewardsLoading={false} rewardsError={false} isSignedIn />)
  expect(screen.getByText('Punkteverlauf')).toBeInTheDocument()
  expect(screen.getByText('Sicherheitskurs')).toBeInTheDocument()
  expect(screen.getByText(/Das Kursquiz wurde überarbeitet/)).toBeInTheDocument()
  expect(screen.getByText('-50 Punkte')).toBeInTheDocument()
  expect(screen.getByText('Meilenstein: Erster abgeschlossener Kurs').nextElementSibling).toHaveTextContent('Erreicht')
  expect(screen.getByText(/ausgestellte Zertifikate bleiben bestehen/)).toBeInTheDocument()
})

it('only exposes course reward approval to an admin and confirms revocation', async () => {
  const user = userEvent.setup()
  const view = render(<CourseClient />)
  await user.click(await screen.findByRole('button', { name: 'Für Belohnungen freigeben' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Freigabe widerrufen' })).toBeInTheDocument())
  expect(global.fetch).toHaveBeenCalledWith('/api/admin/courses/course-1/reward-eligibility', expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ eligible: true }),
  }))
  await user.click(screen.getByRole('button', { name: 'Freigabe widerrufen' }))
  expect(global.fetch).toHaveBeenCalledTimes(2)
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Freigabe widerrufen' }))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/courses/course-1/reward-eligibility', expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ eligible: false }),
  })))
  view.unmount()
  sessionAs('USER')
  render(<CourseClient />)
  await screen.findByText('Sicherheitskurs')
  expect(screen.queryByRole('button', { name: 'Für Belohnungen freigeben' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Freigabe widerrufen' })).not.toBeInTheDocument()
})
