import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from 'next-auth/react'
import Community from '@/app/community/page'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/community/PostCard', () => ({ PostCard: ({ post, onLike }: { post: { id: string }; onLike: (id: string) => void }) => <button onClick={() => onLike(post.id)}>Like</button> }))
jest.mock('@/components/community/PostForm', () => ({ PostForm: () => null }))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'me', name: 'Me', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?page=1') return { ok: true, json: async () => [{ id: 'post-1', title: 'Hallo', content: 'Test', authorId: 'me', author: { id: 'me', name: 'Me', image: null }, createdAt: '2026-01-01', votes: 0, isLiked: false, comments: [] }] }
    if (url === '/api/rewards/me') return { ok: true, json: async () => ({ points: 50, completedCourses: 1, firstCourseCompleted: true }) }
    if (url === '/api/leaderboard') return { ok: true, json: async () => [] }
    if (url === '/api/posts/post-1/like') return { ok: true, json: async () => ({ message: 'Like hinzugefügt' }) }
    throw new Error(`Unexpected fetch: ${url}`)
  })
})

it('keeps private rewards visible off the public leaderboard without promising like points', async () => {
  const user = userEvent.setup()
  render(<Community />)
  expect(await screen.findByText('Meine Punkte')).toBeInTheDocument()
  expect(screen.getByText('Meine Punkte').nextElementSibling).toHaveTextContent('50')
  expect(screen.getByText('Noch keine öffentlichen Einträge.')).toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Like' }))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/posts/post-1/like', { method: 'POST' }))
  expect(screen.queryByText(/\+1 Punkte/)).not.toBeInTheDocument()
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/rewards/me')).toHaveLength(1)
})
