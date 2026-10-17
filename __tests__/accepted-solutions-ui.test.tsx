import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from '@/lib/sites-auth/react'
import Community from '@/app/community/page'
import { PostCard } from '@/components/community/PostCard'
import { CommunityComment, CommunityPost } from '@/lib/community-feed'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('framer-motion', () => jest.requireActual('@/lib/motion'))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/community/PostForm', () => ({ PostForm: () => null }))
jest.mock('@/components/community/ReportControl', () => ({ ReportControl: () => null }))

const reply = (id: string, authorId = 'reply-author', solutionEligible = true): CommunityComment => ({
  id, authorId, author: { name: authorId, image: null }, content: `Reply ${id}`, createdAt: '2026-01-01T12:00:00.000Z', votes: 0, isLiked: false, solutionEligible,
})
const firstReply = reply('a')
const secondReply = reply('b', 'other')
const post = (overrides: Partial<CommunityPost> = {}): CommunityPost => ({
  id: 'post', title: 'How can I solve this?', content: '<p>A useful question</p>', authorId: 'owner', published: true,
  author: { id: 'owner', name: 'Owner', image: null }, createdAt: '2026-01-01T12:00:00.000Z', votes: 0, isLiked: false,
  comments: [firstReply, secondReply, reply('self', 'owner'), reply('test', 'test-author', false)], commentCount: 4,
  commentsNextCursor: null, acceptedSolution: null, acceptedSolutionCount: 0, solutionRevision: null, ...overrides,
})
const selected = (comment = firstReply, revision = 'revision-a') => post({ acceptedSolution: { revision, comment }, acceptedSolutionCount: 1, solutionRevision: revision })
const response = (data: unknown, ok = true) => ({ ok, json: async () => data })
const session = (id = 'owner') => jest.mocked(useSession).mockReturnValue({ data: { user: { id, name: id, role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>)
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fallback(url: string) {
  if (url === '/api/contributions/me') return response({ eligible: true, selectedByAuthors: 0, saturated: false })
  if (url === '/api/leaderboard') return response([])
  if (url === '/api/rewards/me') return response({ points: 0, completedCourses: 0, firstCourseCompleted: false })
  if (url === '/api/posts/me/stats') return response({ posts: 1, receivedLikes: 0, comments: 0 })
  throw new Error(`Unexpected fetch ${url}`)
}
const solutionCalls = () => (global.fetch as jest.Mock).mock.calls.filter(([url]) => url.endsWith('/solution'))
beforeEach(() => { jest.clearAllMocks(); window.history.replaceState({}, '', '/community'); session() })

it('loads only the opened discussion preview, preserves keyboard access, and retries without skipping older replies', async () => {
  let previewAttempts = 0
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: [post({ comments: [], commentCount: 4, commentsDeferred: true })], nextCursor: null })
    if (url === '/api/posts/post/comments?feed=1&preview=1') return ++previewAttempts === 1
      ? response({ error: 'Unavailable' }, false)
      : response({ comments: [reply('d'), reply('c'), reply('b')], nextCursor: 'after-b' })
    if (url === '/api/posts/post/comments?feed=1&cursor=after-b') return response({ comments: [reply('a')], nextCursor: null })
    return fallback(url)
  })
  const user = userEvent.setup()
  render(<Community />)
  const expand = await screen.findByRole('button', { name: '4 Kommentare anzeigen' })
  expect(screen.queryByText('Reply d')).not.toBeInTheDocument()
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url.includes('/comments?'))).toHaveLength(0)
  expand.focus()
  await user.keyboard('{Enter}')
  expect(expand).toHaveAttribute('aria-expanded', 'true')
  expect(await screen.findByText('Weitere Kommentare konnten nicht geladen werden.')).toHaveAttribute('role', 'alert')
  await user.click(screen.getByRole('button', { name: 'Kommentare erneut laden' }))
  expect(await screen.findByText('Reply d')).toBeInTheDocument()
  expect(screen.getByText('3 Kommentare geladen, 4 insgesamt.')).toHaveAttribute('role', 'status')
  await user.click(screen.getByRole('button', { name: 'Weitere Kommentare laden' }))
  expect(await screen.findByText('Reply a')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Weitere Kommentare laden' })).not.toBeInTheDocument()
  expect(screen.getByText('4 Kommentare geladen, 4 insgesamt. Ende der Kommentare.')).toHaveAttribute('role', 'status')
  expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => url.includes('/comments?')).map(([url]) => url)).toEqual([
    '/api/posts/post/comments?feed=1&preview=1',
    '/api/posts/post/comments?feed=1&preview=1',
    '/api/posts/post/comments?feed=1&cursor=after-b',
  ])
})

it('owner can select eligible replies with accessible keyboard controls; self/test replies have no control', async () => {
  const choose = jest.fn().mockResolvedValue(undefined)
  render(<PostCard post={post()} currentUserId="owner" onLike={jest.fn()} onSelectSolution={choose} />)
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: '4 Kommentare anzeigen' }))
  const buttons = screen.getAllByRole('button', { name: 'Diese Antwort als Lösung auswählen' })
  expect(buttons).toHaveLength(2)
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'false')
  buttons[0].focus(); await user.keyboard('{Enter}')
  expect(choose).toHaveBeenCalledWith('post', 'a')
})

it.each([undefined, 'other'])('viewer %s sees the selected reply but cannot change the author decision', async viewer => {
  render(<PostCard post={selected()} currentUserId={viewer} onLike={jest.fn()} onSelectSolution={jest.fn()} />)
  const panel = screen.getByRole('region', { name: 'Ausgewählte Lösung' })
  expect(within(panel).getByText('Reply a')).toBeInTheDocument()
  expect(within(panel).getByText(/Diese Auswahl vergibt keine Punkte/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '4 Kommentare anzeigen' }))
  expect(screen.queryByRole('button', { name: 'Diese Antwort als Lösung auswählen' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Lösungsauswahl entfernen' })).not.toBeInTheDocument()
})

it('a selected older reply is visible without expanding a three-comment preview or adding a duplicate DOM ID', () => {
  const old = reply('old')
  const preview = [reply('new1'), reply('new2'), reply('new3')]
  render(<PostCard post={{ ...selected(old), comments: preview, commentCount: 70, commentsNextCursor: 'after-preview' }} currentUserId="other" onLike={jest.fn()} />)
  expect(screen.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveTextContent('Reply old')
  expect(document.querySelectorAll('#comment-old')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '70 Kommentare anzeigen' }))
  expect(document.querySelectorAll('[id^="comment-"]')).toHaveLength(3)
  expect(screen.getAllByText('Reply old')).toHaveLength(1)
})

it('draft UI suppresses any retained solution; author can remove its private selection without selecting a new one', async () => {
  const choose = jest.fn().mockResolvedValue(undefined)
  render(<PostCard post={selected(firstReply)} currentUserId="owner" onLike={jest.fn()} onSelectSolution={choose} />)
  // Rerender from published to draft can occur after a server visibility update.
  const view = render(<PostCard post={{ ...selected(), id: 'draft', published: false }} currentUserId="owner" onLike={jest.fn()} onSelectSolution={choose} />)
  expect(view.container.querySelector('section[aria-label="Ausgewählte Lösung"]')).toBeNull()
  const remove = within(view.container).getByRole('button', { name: 'Lösungsauswahl entfernen' })
  fireEvent.click(remove); expect(choose).toHaveBeenCalledWith('draft', null)
  fireEvent.click(within(view.container).getByRole('button', { name: '4 Kommentare anzeigen' }))
  expect(within(view.container).queryByRole('button', { name: 'Diese Antwort als Lösung auswählen' })).not.toBeInTheDocument()
})

it('selection waits for server state, blocks repeated clicks, changes and reverses without altering counts or points', async () => {
  const pending = deferred<ReturnType<typeof response>>()
  let changes = 0
  global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) => {
    if (url === '/api/posts?feed=1') return Promise.resolve(response({ posts: [post()], nextCursor: null }))
    if (url.endsWith('/solution')) {
      const body = JSON.parse(options!.body as string)
      changes++
      if (changes === 1) { expect(body).toEqual({ commentId: 'a', expectedRevision: null }); return pending.promise }
      if (changes === 2) { expect(body).toEqual({ commentId: 'b', expectedRevision: 'revision-a' }); return Promise.resolve(response({ post: selected(secondReply, 'revision-b') })) }
      expect(body).toEqual({ commentId: null, expectedRevision: 'revision-b' }); return Promise.resolve(response({ post: post() }))
    }
    return Promise.resolve(fallback(url))
  })
  render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: '4 Kommentare anzeigen' }))
  const button = screen.getAllByRole('button', { name: 'Diese Antwort als Lösung auswählen' })[0]
  fireEvent.click(button); fireEvent.click(button)
  expect(solutionCalls()).toHaveLength(1)
  expect(button).toBeDisabled()
  expect(screen.getByText('Lösungsauswahl wird gespeichert…')).toHaveAttribute('role', 'status')
  expect(screen.queryByRole('region', { name: 'Ausgewählte Lösung' })).not.toBeInTheDocument()
  await act(async () => { pending.resolve(response({ post: selected() })); await pending.promise })
  expect(await screen.findByRole('region', { name: 'Ausgewählte Lösung' })).toHaveTextContent('Antwort von reply-author')
  expect(screen.getAllByText('Reply a')).toHaveLength(1)
  expect(screen.getByRole('button', { name: '4 Kommentare ausblenden' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Diese Antwort als Lösung auswählen' }))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveTextContent('Antwort von other'))
  fireEvent.click(screen.getByRole('button', { name: 'Lösungsauswahl entfernen' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Ausgewählte Lösung' })).not.toBeInTheDocument())
  expect(solutionCalls()).toHaveLength(3)
  expect(screen.getByText('Meine Punkte').nextElementSibling).toHaveTextContent('0')
})

it('409 refreshes the current decision, exposes an accessible error, and retry uses the refreshed revision', async () => {
  let attempts = 0
  global.fetch = jest.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/posts?feed=1') return response({ posts: [post()], nextCursor: null })
    if (url.endsWith('/solution')) {
      if (++attempts === 1) return response({ error: 'Die Lösung wurde inzwischen geändert. Bitte erneut auswählen.', post: selected(secondReply, 'conflict-revision') }, false)
      expect(JSON.parse(options!.body as string)).toEqual({ commentId: 'a', expectedRevision: 'conflict-revision' })
      return response({ post: selected() })
    }
    return fallback(url)
  })
  render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: '4 Kommentare anzeigen' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Diese Antwort als Lösung auswählen' })[0])
  expect(await screen.findByRole('alert')).toHaveTextContent('Die Lösung wurde inzwischen geändert')
  expect(screen.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveTextContent('Antwort von other')
  fireEvent.click(screen.getByRole('button', { name: 'Diese Antwort als Lösung auswählen' }))
  await waitFor(() => expect(screen.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveTextContent('Antwort von reply-author'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('network failure preserves the selection and permits a retry', async () => {
  let attempts = 0
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: [selected()], nextCursor: null })
    if (url.endsWith('/solution')) {
      if (++attempts === 1) throw new Error('Verbindung unterbrochen')
      return response({ post: post() })
    }
    return fallback(url)
  })
  render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: 'Lösungsauswahl entfernen' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Verbindung unterbrochen')
  expect(screen.getByRole('region', { name: 'Ausgewählte Lösung' })).toHaveTextContent('Antwort von reply-author')
  fireEvent.click(screen.getByRole('button', { name: 'Lösungsauswahl entfernen' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Ausgewählte Lösung' })).not.toBeInTheDocument())
})

it('account changes abort a pending decision and ignore its late private response', async () => {
  const pending = deferred<ReturnType<typeof response>>()
  let viewer = 'owner'
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/posts?feed=1') return Promise.resolve(response({ posts: viewer === 'owner' ? [post()] : [], nextCursor: null }))
    if (url.endsWith('/solution')) return pending.promise
    return Promise.resolve(fallback(url))
  })
  const view = render(<Community />)
  fireEvent.click(await screen.findByRole('button', { name: '4 Kommentare anzeigen' }))
  fireEvent.click(screen.getAllByRole('button', { name: 'Diese Antwort als Lösung auswählen' })[0])
  const signal = solutionCalls()[0][1].signal as AbortSignal
  viewer = 'other'; session('other'); view.rerender(<Community />)
  expect(signal.aborted).toBe(true)
  await act(async () => { pending.resolve(response({ post: selected() })); await pending.promise })
  expect(screen.queryByRole('region', { name: 'Ausgewählte Lösung' })).not.toBeInTheDocument()
})


it('uses the singular comment noun in visible text and accessible control names', () => {
  render(<PostCard post={post({ comments: [firstReply], commentCount: 1 })} onLike={jest.fn()} />)
  const show = screen.getByRole('button', { name: '1 Kommentar anzeigen' })
  expect(within(show).getByText('Kommentar')).toBeInTheDocument()
  fireEvent.click(show)
  expect(screen.getByRole('button', { name: '1 Kommentar ausblenden' })).toBeInTheDocument()
})
