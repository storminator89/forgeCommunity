import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from 'next-auth/react'
import Community from '@/app/community/page'
import type { CommunityPost } from '@/lib/community-feed'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/community/PostCard', () => ({ PostCard: ({ post, onSelectSolution, onDelete, onEdit, onAddComment, onLike, isLoading, solutionError }: {
  post: CommunityPost
  onSelectSolution: (id: string, comment: string | null) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onEdit: (post: CommunityPost) => void
  onAddComment: (id: string, content: string) => Promise<void>
  onLike: (id: string) => Promise<void>
  isLoading: boolean
  solutionError?: string
}) => <article>{post.title}
  <button disabled={isLoading} onClick={() => void onSelectSolution(post.id, 'reply')}>Select solution</button>
  <button disabled={isLoading} onClick={() => void onSelectSolution(post.id, null)}>Clear solution</button>
  <button disabled={isLoading} onClick={() => void onDelete(post.id)}>Delete post</button>
  <button disabled={isLoading} onClick={() => onEdit(post)}>Edit post</button>
  <button disabled={isLoading} onClick={() => void onAddComment(post.id, 'New answer')}>Add comment</button>
  <button disabled={isLoading} onClick={() => void onLike(post.id)}>Like</button>
  {solutionError && <p role="alert">{solutionError}</p>}
</article> }))
jest.mock('@/components/community/PostForm', () => ({ PostForm: ({ onSubmit, isLoading }: { onSubmit: (title: string, content: string) => Promise<void>; isLoading: boolean }) =>
  <button disabled={isLoading} onClick={() => void onSubmit('Edited title', 'Edited content')}>Save post</button> }))

const post: CommunityPost = {
  id: 'post-1', title: 'Discussion', content: 'Question', published: true, authorId: 'me', author: { id: 'me', name: 'Me', image: null },
  createdAt: '2026-01-01', votes: 0, isLiked: false, comments: [], solutionRevision: null, acceptedSolution: null,
}
const contributionReads = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/contributions/me')
let rejectMutation = false
let count = 0
beforeEach(() => {
  jest.clearAllMocks(); rejectMutation = false; count = 0
  jest.spyOn(window, 'confirm').mockReturnValue(true)
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'me', name: 'Me', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>)
  global.fetch = jest.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    let data: unknown
    if (url === '/api/contributions/me') data = { eligible: true, selectedByAuthors: count, saturated: count === 5 }
    else if (url === '/api/posts?feed=1') data = { posts: [post], nextCursor: null }
    else if (url === '/api/posts/me/stats') data = { posts: 1, comments: 0, receivedLikes: 0 }
    else if (url === '/api/rewards/me') data = { points: 0, completedCourses: 0, firstCourseCompleted: false }
    else if (url === '/api/leaderboard') data = []
    else if (url === '/api/posts/post-1/solution') {
      if (rejectMutation) return { ok: false, json: async () => ({ error: 'Synthetic selection failure' }) }
      const clear = JSON.parse(options?.body as string).commentId === null
      count = clear ? 0 : 1
      data = { changed: true, post: { ...post, solutionRevision: clear ? null : 'revision' } }
    }
    else if (url === '/api/posts/post-1/comments') data = { id: 'new-comment', postId: post.id, authorId: 'me', content: 'New answer', createdAt: '2026-01-02', votes: 0, isLiked: false, author: { name: 'Me', image: null } }
    else if (url === '/api/posts/post-1/like') data = { message: 'Like hinzugefügt' }
    else if (url === '/api/posts/post-1') data = options?.method === 'DELETE' ? {} : { ...post, title: 'Edited title' }
    else if (url === '/api/posts') data = { ...post, id: 'new-post', title: 'Edited title' }
    else throw new Error(`Unexpected fetch: ${url}`)
    return { ok: true, json: async () => data }
  })
})
afterEach(() => jest.restoreAllMocks())

test('successful select and clear refresh live milestones; repeated reads do not add public points', async () => {
  const user = userEvent.setup(); render(<Community />)
  await screen.findByText('Noch keine aktuelle Auswahl durch andere Diskussionsautoren.')
  await user.click(await screen.findByRole('button', { name: 'Select solution' }))
  expect(await screen.findByText('Aktuell von 1 Diskussionsautor ausgewählt')).toBeInTheDocument()
  expect(contributionReads()).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Clear solution' }))
  expect(await screen.findByText('Noch keine aktuelle Auswahl durch andere Diskussionsautoren.')).toBeInTheDocument()
  expect(contributionReads()).toHaveLength(3)
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/rewards/me')).toHaveLength(1)
})

test('failed selection and ordinary likes do not trigger contribution reads', async () => {
  const user = userEvent.setup(); render(<Community />)
  await screen.findByText('Noch keine aktuelle Auswahl durch andere Diskussionsautoren.')
  rejectMutation = true
  await user.click(await screen.findByRole('button', { name: 'Select solution' }))
  expect(await screen.findByText('Synthetic selection failure')).toBeInTheDocument()
  expect(contributionReads()).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Like' }))
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/posts/post-1/like', expect.objectContaining({ method: 'POST' })))
  expect(contributionReads()).toHaveLength(1)
})

test.each(['Add comment', 'Delete post', 'Edit post', 'Neuen Beitrag erstellen'])('%s success refreshes private contribution state', async action => {
  const user = userEvent.setup(); render(<Community />)
  await screen.findByText('Noch keine aktuelle Auswahl durch andere Diskussionsautoren.')
  await user.click(await screen.findByRole('button', { name: action }))
  if (action === 'Edit post' || action === 'Neuen Beitrag erstellen') await user.click(screen.getByRole('button', { name: 'Save post' }))
  await waitFor(() => expect(contributionReads()).toHaveLength(2))
  expect(await screen.findByText('Noch keine aktuelle Auswahl durch andere Diskussionsautoren.')).toBeInTheDocument()
})
