import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from '@/lib/sites-auth/react'
import Community from '@/app/community/page'
import { CommunityPost, CommunityComment } from '@/lib/community-feed'
import { CommentSection } from '@/components/community/CommentSection'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
// Match the production webpack alias and make mutation tests independent of animation timing.
jest.mock('framer-motion', () => jest.requireActual('@/lib/motion'))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/community/PostCard', () => ({ PostCard: ({ post, onLike, onDelete, onEdit, onAddComment, onLikeComment, onLoadComments, commentsLoading, commentsError }: {
  post: CommunityPost
  onLike: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (post: CommunityPost) => void
  onAddComment: (id: string, content: string) => void
  onLikeComment: (id: string, postId: string) => void
  onLoadComments: (id: string) => void
  commentsLoading: boolean
  commentsError: boolean
}) => <article aria-label={post.title}>
  <h3>{post.title}</h3><p>{post.votes} likes</p><p>{post.commentCount ?? post.comments.length} comments</p>
  <button onClick={() => onLike(post.id)}>Like {post.id}</button>
  <button onClick={() => onDelete(post.id)}>Delete {post.id}</button>
  <button onClick={() => onEdit(post)}>Edit {post.id}</button>
  <button onClick={() => onAddComment(post.id, 'New comment')}>Comment {post.id}</button>
  {post.comments.map(comment => <div key={comment.id}>{comment.content}<span>{comment.votes} comment likes</span><button onClick={() => onLikeComment(comment.id, post.id)}>Like comment {comment.id}</button></div>)}
  {commentsError && <p role="alert">Comment page failed</p>}
  {post.commentsNextCursor && <button disabled={commentsLoading} onClick={() => onLoadComments(post.id)}>More comments {post.id}</button>}
</article> }))
jest.mock('@/components/community/PostForm', () => ({ PostForm: ({ onSubmit, initialTitle, isEditing }: {
  onSubmit: (title: string, content: string) => void; initialTitle?: string; isEditing: boolean
}) => <button onClick={() => onSubmit(isEditing ? `${initialTitle} edited` : 'Created post', 'Content')}>Submit post</button> }))

const response = (data: unknown, ok = true) => ({ ok, json: async () => data })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function post(index: number, overrides: Partial<CommunityPost> = {}): CommunityPost {
  return { id: `post-${index}`, title: `Post ${index}`, content: 'Content', published: true, authorId: 'alice', author: { id: 'alice', name: 'Alice', image: null }, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), votes: 0, isLiked: false, comments: [], commentCount: 0, commentsNextCursor: null, ...overrides }
}
function comment(index: number): CommunityComment {
  return { id: `comment-${index}`, authorId: 'alice', author: { name: 'Alice', image: null }, content: `Comment ${index}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), votes: 0, isLiked: false }
}
function session(id: string, role = 'USER') {
  jest.mocked(useSession).mockReturnValue({ data: { user: { id, name: id, role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>)
}
function fallback(url: string) {
  if (url === '/api/contributions/me') return response({ eligible: true, selectedByAuthors: 0, saturated: false })
  if (url === '/api/leaderboard') return response([])
  if (url === '/api/rewards/me') return response({ points: 0, completedCourses: 0, firstCourseCompleted: false })
  if (url === '/api/posts/me/stats') return response({ posts: 81, receivedLikes: 102, comments: 203 })
  throw new Error(`Unexpected fetch: ${url}`)
}
function feedCalls() { return (global.fetch as jest.Mock).mock.calls.filter(([url]) => url.startsWith('/api/posts?')) }

beforeEach(() => { window.history.replaceState({}, '', '/community'); jest.clearAllMocks(); session('alice'); jest.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => jest.restoreAllMocks())

it('renders only the first 50 of 81 posts, shows global personal stats, and loads the rest only on keyboard request', async () => {
  const first = Array.from({ length: 50 }, (_, index) => post(81 - index))
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: first, nextCursor: 'after-32' })
    if (url === '/api/posts?feed=1&cursor=after-32') return response({ posts: Array.from({ length: 31 }, (_, index) => post(31 - index)), nextCursor: null })
    return fallback(url)
  })
  const user = userEvent.setup()
  render(<Community />)
  expect(await screen.findByRole('article', { name: 'Post 81' })).toBeInTheDocument()
  expect(screen.getAllByRole('article')).toHaveLength(50)
  expect(feedCalls()).toHaveLength(1)
  expect(screen.getByText('Likes').nextElementSibling).toHaveTextContent('102')
  expect(screen.getByText('Kommentare').nextElementSibling).toHaveTextContent('203')
  expect(screen.queryByText('Ende der Liste.')).not.toBeInTheDocument()
  const load = screen.getByRole('button', { name: 'Weitere Beiträge laden' })
  load.focus()
  await user.keyboard('{Enter}')
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(81))
  expect(screen.getByText('Ende der Liste.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Weitere Beiträge laden' })).not.toBeInTheDocument()
  expect(feedCalls()).toHaveLength(2)
  expect(screen.getByRole('status')).toHaveFocus()
})

it('keeps loaded rows on a later-page failure and retries the identical cursor without duplicates or reordering', async () => {
  let attempts = 0
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: [post(3), post(2)], nextCursor: 'same cursor/2' })
    if (url === '/api/posts?feed=1&cursor=same%20cursor%2F2') return attempts++ === 0 ? response({ error: 'Unavailable' }, false) : response({ posts: [post(2), post(1)], nextCursor: null })
    return fallback(url)
  })
  render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: 'Weitere Beiträge laden' }))
  expect(await screen.findByText(/Beiträge konnten nicht vollständig geladen werden/)).toHaveAttribute('role', 'alert')
  expect(screen.getAllByRole('article')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Beiträge erneut laden' }))
  await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3))
  expect(screen.getAllByRole('article').map(row => row.getAttribute('aria-label'))).toEqual(['Post 3', 'Post 2', 'Post 1'])
  expect(feedCalls().map(([url]) => url)).toEqual(['/api/posts?feed=1', '/api/posts?feed=1&cursor=same%20cursor%2F2', '/api/posts?feed=1&cursor=same%20cursor%2F2'])
})

it('preserves creation, editing, deleting, post/comment likes and added comments across overlapping pages', async () => {
  const p2 = post(2, { comments: [comment(1)], commentCount: 1 })
  global.fetch = jest.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/posts?feed=1') return response({ posts: [post(3), p2], nextCursor: 'after2' })
    if (url === '/api/posts?feed=1&cursor=after2') return response({ posts: [post(4, { title: 'Created post' }), post(3), p2, post(1)], nextCursor: null })
    if (url === '/api/posts' && options?.method === 'POST') return response(post(4, { title: 'Created post' }))
    if (url === '/api/posts/post-2' && options?.method === 'PUT') return response({ ...p2, title: 'Post 2 edited', comments: [] })
    if (url === '/api/posts/post-3' && options?.method === 'DELETE') return response({ message: 'Deleted' })
    if (url === '/api/posts/post-2/like') return response({ message: 'Like hinzugefügt' })
    if (url === '/api/posts/post-2/comments') return response(comment(5))
    if (url === '/api/posts/post-2/comments/comment-1/like') return response({ isLiked: true })
    return fallback(url)
  })
  render(<Community />)
  await screen.findByRole('article', { name: 'Post 2' })
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Beitrag erstellen' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Submit post' }))
  await screen.findByRole('article', { name: 'Created post' })
  fireEvent.click(screen.getByRole('button', { name: 'Edit post-2' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Submit post' }))
  await screen.findByRole('article', { name: 'Post 2 edited' })
  fireEvent.click(screen.getByRole('button', { name: 'Like post-2' }))
  await waitFor(() => expect(within(screen.getByRole('article', { name: 'Post 2 edited' })).getByText('1 likes')).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Comment post-2' }))
  await screen.findByText('Comment 5')
  fireEvent.click(screen.getByRole('button', { name: 'Like comment comment-1' }))
  await screen.findByText('1 comment likes')
  fireEvent.click(screen.getByRole('button', { name: 'Delete post-3' }))
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Post 3' })).not.toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Beiträge laden' }))
  await screen.findByRole('article', { name: 'Post 1' })
  expect(screen.getAllByRole('article').map(row => row.getAttribute('aria-label'))).toEqual(['Created post', 'Post 2 edited', 'Post 1'])
  const edited = within(screen.getByRole('article', { name: 'Post 2 edited' }))
  expect(edited.getByText('1 likes')).toBeInTheDocument()
  expect(edited.getByText('2 comments')).toBeInTheDocument()
  expect(edited.getByText('Comment 5')).toBeInTheDocument()
  expect(edited.getByText('1 comment likes')).toBeInTheDocument()
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url === '/api/posts/me/stats')).toHaveLength(5)
})

it('aborts a pending page on mutation, ignores its late response and preserves its cursor for the next request', async () => {
  const late = deferred<ReturnType<typeof response>>()
  let attempts = 0
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/posts?feed=1') return Promise.resolve(response({ posts: [post(2)], nextCursor: 'after2' }))
    if (url === '/api/posts?feed=1&cursor=after2') return attempts++ === 0 ? late.promise : Promise.resolve(response({ posts: [post(1)], nextCursor: null }))
    if (url === '/api/posts/post-2/like') return Promise.resolve(response({ message: 'Like hinzugefügt' }))
    return Promise.resolve(fallback(url))
  })
  render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: 'Weitere Beiträge laden' }))
  const signal = feedCalls()[1][1].signal as AbortSignal
  fireEvent.click(screen.getByRole('button', { name: 'Like post-2' }))
  await screen.findByText('1 likes')
  expect(signal.aborted).toBe(true)
  await act(async () => { late.resolve(response({ posts: [post(1)], nextCursor: null })); await late.promise })
  expect(screen.queryByRole('article', { name: 'Post 1' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Beiträge laden' }))
  await screen.findByRole('article', { name: 'Post 1' })
  expect(feedCalls()[2][0]).toBe('/api/posts?feed=1&cursor=after2')
})

it('clears private rows, activity and pending comment pages immediately on an account or role switch', async () => {
  const lateComments = deferred<ReturnType<typeof response>>()
  const lateStats = deferred<ReturnType<typeof response>>()
  let viewer = 'alice'
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/posts?feed=1') return Promise.resolve(viewer === 'alice' ? response({ posts: [post(2, { title: 'Alice draft', published: false, commentsNextCursor: 'older' })], nextCursor: null }) : response({ error: 'Unavailable' }, false))
    if (url === '/api/posts/post-2/comments?feed=1&cursor=older') return lateComments.promise
    if (url === '/api/posts/me/stats' && viewer === 'alice') return lateStats.promise
    return Promise.resolve(fallback(url))
  })
  const view = render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: 'More comments post-2' }))
  const commentSignal = (global.fetch as jest.Mock).mock.calls.find(([url]) => url.includes('/comments?'))[1].signal as AbortSignal
  viewer = 'bob'; session('bob'); view.rerender(<Community />)
  expect(screen.queryByText('Alice draft')).not.toBeInTheDocument()
  expect(commentSignal.aborted).toBe(true)
  await screen.findByText('Beiträge konnten nicht geladen werden')
  await act(async () => { lateComments.resolve(response({ comments: [comment(99)], nextCursor: null })); lateStats.resolve(response({ posts: 999, comments: 999, receivedLikes: 999 })); await lateComments.promise; await lateStats.promise })
  expect(screen.queryByText('Comment 99')).not.toBeInTheDocument()
  expect(screen.queryByText('999')).not.toBeInTheDocument()
  session('bob', 'ADMIN'); view.rerender(<Community />)
  await screen.findByText('Beiträge konnten nicht geladen werden')
  expect(feedCalls()).toHaveLength(3)
})

it('retains all 3 preview comments on page failure and makes 68 older comments reachable through explicit retry', async () => {
  let attempts = 0
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: [post(1, { comments: Array.from({ length: 3 }, (_, index) => comment(71 - index)), commentCount: 71, commentsNextCursor: 'after69' })], nextCursor: null })
    if (url === '/api/posts/post-1/comments?feed=1&cursor=after69') return attempts++ === 0 ? response({ error: 'Unavailable' }, false) : response({ comments: Array.from({ length: 50 }, (_, index) => comment(68 - index)), nextCursor: 'after19' })
    if (url === '/api/posts/post-1/comments?feed=1&cursor=after19') return response({ comments: Array.from({ length: 18 }, (_, index) => comment(18 - index)), nextCursor: null })
    return fallback(url)
  })
  render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: 'More comments post-1' }))
  await screen.findByText('Comment page failed')
  expect(screen.getByText('Comment 71')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'More comments post-1' }))
  await screen.findByText('Comment 19')
  fireEvent.click(screen.getByRole('button', { name: 'More comments post-1' }))
  await screen.findByText('Comment 1')
  expect(screen.queryByRole('button', { name: 'More comments post-1' })).not.toBeInTheDocument()
  expect(screen.getByText('71 comments')).toBeInTheDocument()
})

it('provides native, labelled keyboard controls and truthful partial comment counts', async () => {
  const load = jest.fn()
  const view = render(<CommentSection postId="post-1" comments={[comment(1)]} commentCount={71} hasMore onLoadMore={load} />)
  expect(screen.getByRole('textbox', { name: 'Kommentar schreiben' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Kommentar senden' })).toBeDisabled()
  const button = screen.getByRole('button', { name: 'Weitere Kommentare laden' })
  button.focus()
  await userEvent.setup().keyboard('{Enter}')
  expect(load).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('1 Kommentar geladen, 71 insgesamt.')
  view.rerender(<CommentSection postId="post-1" comments={[comment(1)]} commentCount={1} hasMore={false} onLoadMore={load} />)
  expect(screen.getByRole('status')).toHaveFocus()
})

it('shows retry instead of invented zero activity when stats fail', async () => {
  let attempts = 0
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: [], nextCursor: null })
    if (url === '/api/posts/me/stats' && attempts++ === 0) return response({ error: 'Unavailable' }, false)
    return fallback(url)
  })
  render(<Community />)
  await screen.findByText('Aktivität konnte nicht geladen werden.')
  expect(screen.queryByText('Likes')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Aktivität erneut laden' }))
  await screen.findByText('Likes')
  expect(screen.getByText('Likes').nextElementSibling).toHaveTextContent('102')
})


it('resolves a linked older post in one bounded read and de-duplicates it when pagination reaches it', async () => {
  window.history.replaceState({}, '', '/community#post-post-1')
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: [post(3), post(2)], nextCursor: 'after2' })
    if (url === '/api/posts/post-1') return response(post(1))
    if (url === '/api/posts?feed=1&cursor=after2') return response({ posts: [post(1)], nextCursor: null })
    return fallback(url)
  })
  render(<Community />)
  await screen.findByRole('article', { name: 'Post 1' })
  expect(feedCalls()).toHaveLength(1)
  expect(screen.getAllByRole('article').map(row => row.getAttribute('aria-label'))).toEqual(['Post 3', 'Post 2', 'Post 1'])
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Beiträge laden' }))
  await screen.findByText('Ende der Liste.')
  expect(screen.getAllByRole('article')).toHaveLength(3)
})

it('preserves the exact linked older comment without walking every comment page and retries an unavailable target', async () => {
  window.history.replaceState({}, '', '/community#comment-comment-1')
  let attempts = 0
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: [post(2, { comments: [], commentCount: 99, commentsDeferred: true })], nextCursor: null })
    if (url === '/api/posts/linked-comment/comment-1') return attempts++ === 0 ? response({ error: 'Unavailable' }, false) : response(post(2, { comments: [comment(99), comment(1)], commentCount: 99, commentsNextCursor: 'older' }))
    if (url === '/api/posts/post-2/comments?feed=1&cursor=older') return response({ comments: [comment(98)], nextCursor: null })
    return fallback(url)
  })
  render(<Community />)
  await screen.findByText('Verlinkter Inhalt ist nicht verfügbar')
  fireEvent.click(screen.getByRole('button', { name: 'Verlinkten Inhalt erneut laden' }))
  await screen.findByText('Comment 1')
  expect(screen.getByText('Comment 99')).toBeInTheDocument()
  expect(screen.getByText('99 comments')).toBeInTheDocument()
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url.includes('/comments?'))).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'More comments post-2' }))
  await screen.findByText('Comment 98')
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url.includes('/comments?')).map(([url]) => url)).toEqual(['/api/posts/post-2/comments?feed=1&cursor=older'])
})

it('ignores a previous account’s pending mutation result and clears a same-account admin draft on demotion', async () => {
  const lateLike = deferred<ReturnType<typeof response>>()
  let viewer = 'alice'
  session('alice', 'ADMIN')
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/posts?feed=1') return Promise.resolve(response({ posts: [post(2, { title: viewer === 'alice' ? 'Staff draft' : 'Bob post', published: viewer !== 'alice', authorId: viewer })], nextCursor: null }))
    if (url === '/api/posts/post-2/like') return lateLike.promise
    return Promise.resolve(fallback(url))
  })
  const view = render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: 'Like post-2' }))
  const signal = (global.fetch as jest.Mock).mock.calls.find(([url]) => url.endsWith('/like'))[1].signal as AbortSignal
  viewer = 'bob'; session('bob'); view.rerender(<Community />)
  await screen.findByRole('article', { name: 'Bob post' })
  expect(signal.aborted).toBe(true)
  await act(async () => { lateLike.resolve(response({ message: 'Like hinzugefügt' })); await lateLike.promise })
  expect(within(screen.getByRole('article', { name: 'Bob post' })).getByText('0 likes')).toBeInTheDocument()
  viewer = 'alice'; session('alice', 'ADMIN'); view.rerender(<Community />)
  await screen.findByText('Staff draft')
  viewer = 'demoted'; session('alice', 'USER'); view.rerender(<Community />)
  expect(screen.queryByText('Staff draft')).not.toBeInTheDocument()
  await screen.findByRole('article', { name: 'Bob post' })
})
