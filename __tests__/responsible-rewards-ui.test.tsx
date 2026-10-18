import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from 'next-auth/react'
import { StatsCard } from '@/components/community/StatsCard'
import { PersonalProgressCard } from '@/components/community/PersonalProgressCard'
import { LeaderboardCard } from '@/components/community/LeaderboardCard'
import CourseClient from '@/app/courses/CourseClient'

const mockRouter = { push: jest.fn() }
const mockToast = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/hooks/useSparkVisibility', () => ({ useSparkVisibility: () => ({ visible: false }) }))
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

it('shows private progress independently of public leaderboard placement', () => {
  render(<>
    <PersonalProgressCard summary={{ points: 50, completedCourses: 1, firstCourseCompleted: true }} loading={false} error={false} isSignedIn role="USER" onRefresh={jest.fn()} />
    <LeaderboardCard users={[]} isLoading={false} />
  </>)
  expect(screen.getByText('Aktive Kurspunkte:')).toHaveTextContent('50')
  expect(screen.getByRole('list', { name: 'Lernmeilensteine' })).toHaveTextContent('1 Kurs: erreicht')
  expect(screen.getByRole('progressbar', { name: '1 von 3 Kursen bis zum nächsten Meilenstein' })).toHaveAttribute('value', '1')
  expect(screen.getByText('Noch keine öffentlichen Einträge.')).toBeInTheDocument()
  expect(screen.getByText('Dein persönlicher Fortschritt bleibt auch ohne Teilnahme an der öffentlichen Rangliste sichtbar.')).toBeInTheDocument()
})

it('keeps activity and progress explanations in closed keyboard-accessible native disclosures', async () => {
  const user = userEvent.setup()
  render(<>
    <StatsCard stats={{ posts: 1, receivedLikes: 2, comments: 3 }} isSignedIn />
    <PersonalProgressCard summary={{ points: 50, completedCourses: 1, firstCourseCompleted: true }} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />
  </>)
  const activity = screen.getByText('Aktivitätszahlen ansehen')
  const points = screen.getByText('Aktive Kurspunkte:').closest('summary')!
  const activityHelp = screen.getByText('Alle deine Beiträge. Likes auf deine Beiträge, einschließlich eigener Likes. Kommentare in veröffentlichten und deinen eigenen Beiträgen.')
  const visibilityHelp = screen.getByText('Dein persönlicher Fortschritt bleibt auch ohne Teilnahme an der öffentlichen Rangliste sichtbar.')
  for (const [summary, explanation] of [[activity, activityHelp], [points, visibilityHelp]]) {
    expect(summary.tagName).toBe('SUMMARY')
    expect(summary.parentElement?.tagName).toBe('DETAILS')
    expect(summary.parentElement).not.toHaveAttribute('open')
    expect(summary).toHaveClass('min-h-11', 'focus-visible:ring-2', 'focus-visible:ring-ring')
    expect(explanation).not.toBeVisible()
    await user.click(summary)
    expect(explanation).toBeVisible()
    await user.click(summary)
    expect(explanation).not.toBeVisible()
  }
  expect(screen.getByText('Aktive Kurspunkte:')).toBeVisible()
  expect(screen.getByRole('progressbar', { name: '1 von 3 Kursen bis zum nächsten Meilenstein' })).toBeVisible()
})

it('lets activity labels and values wrap while private progress uses its own surface', () => {
  render(<>
    <StatsCard stats={{ posts: 1234567890123456, receivedLikes: 2345678901234567, comments: 3456789012345678 }} isSignedIn />
    <PersonalProgressCard summary={{ points: 987654321012345, completedCourses: 3, firstCourseCompleted: true }} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />
  </>)
  for (const [label, value] of [['Beiträge', '1234567890123456'], ['Likes', '2345678901234567'], ['Kommentare', '3456789012345678']]) {
    const term = screen.getByText(label)
    const cell = term.parentElement!
    expect(term.tagName).toBe('DT')
    expect(term.nextElementSibling?.tagName).toBe('DD')
    expect(term.nextElementSibling?.textContent).toBe(value)
    expect(cell).toHaveClass('min-w-0', '[overflow-wrap:anywhere]')
    expect(cell).not.toHaveClass('overflow-hidden', 'truncate')
  }
  expect(screen.getByText('Aktive Kurspunkte:')).toHaveTextContent('987654321012345')
  const progress = screen.getByRole('progressbar', { name: '3 von 5 Kursen bis zum nächsten Meilenstein' })
  expect(progress).toHaveAttribute('value', '3')
  expect(progress).toHaveAttribute('max', '5')
})

it('shows reachable private learning milestones without streak pressure or public ranking', () => {
  const view = render(<PersonalProgressCard summary={{ points: 0, completedCourses: 0, firstCourseCompleted: false }} loading={false} error={false} isSignedIn role="USER" onRefresh={jest.fn()} />)
  expect(screen.getByRole('progressbar', { name: '0 von 1 Kurs bis zum nächsten Meilenstein' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Mein Lernweg' })).toHaveAttribute('href', '/courses/journey')
  view.rerender(<PersonalProgressCard summary={{ points: 0, completedCourses: 3, firstCourseCompleted: true }} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />)
  expect(screen.getByRole('progressbar', { name: '3 von 5 Kursen bis zum nächsten Meilenstein' })).toBeInTheDocument()
  view.rerender(<PersonalProgressCard summary={{ points: 0, completedCourses: 5, firstCourseCompleted: true }} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />)
  expect(screen.getByText('Alle Lernmeilensteine erreicht')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

it('explains a quiz-revision adjustment without erasing the historical milestone', () => {
  render(<PersonalProgressCard summary={{ points: 0, completedCourses: 1, firstCourseCompleted: true,
    history: [{ type: 'REVOKED', reason: 'QUIZ_REVISED', pointsDelta: -50, at: '2026-10-14T10:00:00.000Z', courseTitle: 'Sicherheitskurs' }],
  }} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />)
  expect(screen.getByText('Punkteverlauf')).toBeInTheDocument()
  expect(screen.getByText('Sicherheitskurs')).toBeInTheDocument()
  expect(screen.getByText(/Das Kursquiz wurde überarbeitet/)).toBeInTheDocument()
  expect(screen.getByText('-50 Punkte')).toBeInTheDocument()
  expect(screen.getByText('1 Kurs abgeschlossen')).toBeInTheDocument()
  expect(screen.getByText(/Meilensteine zählen unterschiedliche Kurse/)).toHaveTextContent('bleiben bei späteren Änderungen bestehen')
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
