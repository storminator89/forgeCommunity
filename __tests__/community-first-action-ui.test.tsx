import { act, render, screen } from '@testing-library/react'
import { useSession } from '@/lib/sites-auth/react'
import Community from '@/app/community/page'
import { registerNewMemberFirstAction } from '@/lib/new-member-first-action'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/community/StatsCard', () => ({ StatsCard: () => null }))
jest.mock('@/components/community/LeaderboardCard', () => ({ LeaderboardCard: () => null }))
jest.mock('@/components/community/ContributionMilestonesCard', () => ({ ContributionMilestonesCard: () => null }))
jest.mock('@/hooks/usePrivateContributions', () => ({ usePrivateContributions: () => ({ summary: null, loading: false, error: false, refresh: jest.fn() }) }))

function viewer(id: string | null, role = 'USER', status = id ? 'authenticated' : 'unauthenticated') {
  jest.mocked(useSession).mockReturnValue({
    data: id ? { user: { id, role }, expires: '2099-01-01' } : null,
    status, update: jest.fn(),
  } as ReturnType<typeof useSession>)
}

beforeEach(() => {
  window.localStorage.clear()
  viewer('registered-user')
  global.fetch = jest.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => url.startsWith('/api/posts?') ? { posts: [], nextCursor: null } : url === '/api/posts/me/stats' ? { posts: 0, comments: 0, receivedLikes: 0 } : [] }))
})

it('shows the receipt only to the matched regular signed-in member while leaving the feed/composer usable', async () => {
  registerNewMemberFirstAction('registered-user')
  const view = render(<Community />)
  expect(screen.getByRole('heading', { name: 'Dein Einstieg' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Neuen Beitrag erstellen' })).toBeVisible()
  expect(await screen.findByRole('heading', { name: 'Aktuelle Beiträge' })).toHaveAttribute('tabindex', '-1')
  expect(screen.getByRole('heading', { name: 'Aktuelle Beiträge' })).toHaveClass('focus-visible:ring-2', 'focus-visible:ring-ring')
  viewer('other-user')
  view.rerender(<Community />)
  expect(screen.queryByRole('region', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
  viewer('registered-user', 'USER', 'loading')
  view.rerender(<Community />)
  expect(screen.queryByRole('region', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
  viewer('registered-user')
  view.rerender(<Community />)
  expect(screen.getByRole('heading', { name: 'Dein Einstieg' })).toBeVisible()
  viewer(null)
  view.rerender(<Community />)
  expect(screen.queryByRole('region', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
  await act(async () => {})
})

it.each(['ADMIN', 'MODERATOR', 'INSTRUCTOR'])('does not promote a first-member path to a %s account', async role => {
  registerNewMemberFirstAction('registered-user')
  viewer('registered-user', role)
  render(<Community />)
  expect(screen.queryByRole('region', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
  await act(async () => {})
})
