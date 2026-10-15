import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from 'next-auth/react'
import Community from '@/app/community/page'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/community/PostCard', () => ({ PostCard: ({ post, onLike }: { post: { id: string; title: string }; onLike: (id: string) => void }) => <article>{post.title}<button onClick={() => onLike(post.id)}>Like</button></article> }))
jest.mock('@/components/community/PostForm', () => ({ PostForm: () => null }))

function post(id: string, title: string, authorId: string) {
  return { id, title, content: 'Test', authorId, author: { id: authorId, name: authorId, image: null }, createdAt: '2026-01-01', votes: 0, isLiked: false, comments: [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'me', name: 'Me', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return { ok: true, json: async () => ({ posts: [{ id: 'post-1', title: 'Hallo', content: 'Test', authorId: 'me', author: { id: 'me', name: 'Me', image: null }, createdAt: '2026-01-01', votes: 0, isLiked: false, comments: [] }], nextCursor: null }) }
    if (url === '/api/posts/me/stats') return { ok: true, json: async () => ({ posts: 1, comments: 0, receivedLikes: 0 }) }
    if (url === '/api/contributions/me') return { ok: true, json: async () => ({ eligible: true, selectedByAuthors: 0, saturated: false }) }
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
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/posts/post-1/like', expect.objectContaining({ method: 'POST' })))
  expect(screen.queryByText(/\+1 Punkte/)).not.toBeInTheDocument()
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/rewards/me')).toHaveLength(1)
})

it('removes Alice’s unpublished post before Bob’s failed load or logout', async () => {
  let viewer = 'alice'
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice', name: 'Alice', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') {
      return viewer === 'alice'
        ? { ok: true, json: async () => ({ posts: [post('alice-draft', 'Alice private draft', 'alice')], nextCursor: null }) }
        : { ok: false, json: async () => ({ message: 'Unavailable' }) }
    }
    if (url === '/api/posts/me/stats') return { ok: true, json: async () => ({ posts: 1, comments: 0, receivedLikes: 0 }) }
    if (url === '/api/contributions/me') return { ok: true, json: async () => ({ eligible: true, selectedByAuthors: 0, saturated: false }) }
    if (url === '/api/rewards/me') return { ok: true, json: async () => ({ points: 0, completedCourses: 0, firstCourseCompleted: false }) }
    if (url === '/api/leaderboard') return { ok: true, json: async () => [] }
    throw new Error(`Unexpected fetch: ${url}`)
  })

  const view = render(<Community />)
  expect(await screen.findByText('Alice private draft')).toBeInTheDocument()

  viewer = 'bob'
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'bob', name: 'Bob', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  view.rerender(<Community />)
  expect(screen.queryByText('Alice private draft')).not.toBeInTheDocument()
  expect(await screen.findByText('Beiträge konnten nicht geladen werden')).toBeInTheDocument()

  jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() } as ReturnType<typeof useSession>)
  view.rerender(<Community />)
  expect(screen.queryByText('Alice private draft')).not.toBeInTheDocument()
})

it('ignores Alice’s late post response after Bob signs in', async () => {
  const alicePosts = deferred<{ ok: boolean; json: () => Promise<{ posts: ReturnType<typeof post>[]; nextCursor: null }> }>()
  let viewer = 'alice'
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'alice', name: 'Alice', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/posts?feed=1') {
      return viewer === 'alice'
        ? alicePosts.promise
        : Promise.resolve({ ok: true, json: async () => ({ posts: [post('bob-post', 'Bob post', 'bob')], nextCursor: null }) })
    }
    if (url === '/api/posts/me/stats') return Promise.resolve({ ok: true, json: async () => ({ posts: 1, comments: 0, receivedLikes: 0 }) })
    if (url === '/api/contributions/me') return { ok: true, json: async () => ({ eligible: true, selectedByAuthors: 0, saturated: false }) }
    if (url === '/api/rewards/me') return Promise.resolve({ ok: true, json: async () => ({ points: 0, completedCourses: 0, firstCourseCompleted: false }) })
    if (url === '/api/leaderboard') return Promise.resolve({ ok: true, json: async () => [] })
    throw new Error(`Unexpected fetch: ${url}`)
  })

  const view = render(<Community />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/posts?feed=1', expect.anything()))

  viewer = 'bob'
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'bob', name: 'Bob', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  view.rerender(<Community />)
  expect(await screen.findByText('Bob post')).toBeInTheDocument()

  await act(async () => {
    alicePosts.resolve({ ok: true, json: async () => ({ posts: [post('alice-draft', 'Alice private draft', 'alice')], nextCursor: null }) })
    await alicePosts.promise
  })
  expect(screen.getByText('Bob post')).toBeInTheDocument()
  expect(screen.queryByText('Alice private draft')).not.toBeInTheDocument()
})
