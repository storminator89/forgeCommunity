import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Community from '@/app/community/page'
import { PostTopicPicker } from '@/components/community/PostTopicPicker'
import type { CommunityPost } from '@/lib/community-feed'

jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'alice', name: 'Alice', role: 'USER' } }, status: 'authenticated' }) }))
jest.mock('framer-motion', () => jest.requireActual('@/lib/motion'))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/community/PostCard', () => ({ PostCard: ({ post }: { post: CommunityPost }) => <article>{post.title}</article> }))
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) =>
  <textarea aria-label="Inhalt" value={content} onChange={event => onChange(event.target.value)} /> }))

const response = (data: unknown, ok = true) => ({ ok, json: async () => data })
const post = (id: string, title: string, name: string): CommunityPost => ({
  id, title, content: 'Content', published: true, authorId: 'alice', author: { id: 'alice', name: 'Alice', image: null },
  createdAt: '2026-01-01T00:00:00.000Z', votes: 0, isLiked: false, comments: [], tags: [{ id: name, name }],
})
function fallback(url: string) {
  if (url === '/api/contributions/me') return response({ eligible: true, selectedByAuthors: 0, saturated: false })
  if (url === '/api/leaderboard') return response([])
  if (url === '/api/rewards/me') return response({ points: 0, completedCourses: 0, firstCourseCompleted: false })
  if (url === '/api/posts/me/stats') return response({ posts: 1, receivedLikes: 0, comments: 0 })
  throw new Error(`Unexpected fetch: ${url}`)
}

beforeEach(() => { window.history.replaceState({}, '', '/community'); jest.clearAllMocks() })

it('searches public topics, updates the URL and feed, and restores the previous filter on browser back', async () => {
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1') return response({ posts: [post('a', 'All-post', 'Design')], nextCursor: null })
    if (url === '/api/posts?feed=1&tag=Design') return response({ posts: [post('d', 'Design-post', 'Design')], nextCursor: null })
    if (url.startsWith('/api/posts/topics?')) return response({ topics: [{ id: 'design', name: 'Design' }] })
    return fallback(url)
  })
  const user = userEvent.setup()
  render(<Community />)
  expect(await screen.findByText('All-post')).toBeInTheDocument()
  await user.click(screen.getByRole('searchbox', { name: 'Thema suchen' }))
  const topicLink = await screen.findByRole('link', { name: 'Design' })
  topicLink.focus()
  await user.keyboard('{Enter}')
  expect(window.location.search).toBe('?tag=Design')
  expect(await screen.findByText('Design-post')).toBeInTheDocument()
  expect(screen.queryByText('All-post')).not.toBeInTheDocument()
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 40)) })
  await waitFor(() => expect(window.location.search).toBe(''))
  expect(await screen.findByText('All-post')).toBeInTheDocument()
  expect(screen.queryByText('Design-post')).not.toBeInTheDocument()
  await act(async () => { window.history.forward(); await new Promise(resolve => setTimeout(resolve, 40)) })
  await waitFor(() => expect(window.location.search).toBe('?tag=Design'))
  expect(await screen.findByText('Design-post')).toBeInTheDocument()
})

it('aborts a filtered page when switching topics and starts the next feed at its own first page', async () => {
  window.history.replaceState({}, '', '/community?tag=Design')
  let resolveLate!: (value: ReturnType<typeof response>) => void
  const late = new Promise<ReturnType<typeof response>>(resolve => { resolveLate = resolve })
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url === '/api/posts?feed=1&tag=Design') return Promise.resolve(response({ posts: [post('d1', 'Design-one', 'Design')], nextCursor: 'design-cursor' }))
    if (url === '/api/posts?feed=1&tag=Design&cursor=design-cursor') return late
    if (url === '/api/posts?feed=1') return Promise.resolve(response({ posts: [post('a1', 'All-one', 'Other')], nextCursor: null }))
    return Promise.resolve(fallback(url))
  })
  render(<Community />)
  expect(await screen.findByText('Design-one')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Weitere Beiträge laden' }))
  await waitFor(() => expect((global.fetch as jest.Mock).mock.calls.some(([url]) => url === '/api/posts?feed=1&tag=Design&cursor=design-cursor')).toBe(true))
  const pageCall = (global.fetch as jest.Mock).mock.calls.find(([url]) => url === '/api/posts?feed=1&tag=Design&cursor=design-cursor')
  fireEvent.click(screen.getByRole('button', { name: 'Alle Beiträge zeigen' }))
  expect(pageCall[1].signal.aborted).toBe(true)
  expect(await screen.findByText('All-one')).toBeInTheDocument()
  await act(async () => { resolveLate(response({ posts: [post('d2', 'Design-late', 'Design')], nextCursor: null })); await late })
  expect(screen.queryByText('Design-late')).not.toBeInTheDocument()
  expect(screen.queryByText('Design-one')).not.toBeInTheDocument()
})

it('keeps topic-specific empty and error states actionable', async () => {
  window.history.replaceState({}, '', '/community?tag=Design')
  let tries = 0
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1&tag=Design') return ++tries === 1 ? response({ error: 'down' }, false) : response({ posts: [], nextCursor: null })
    if (url === '/api/posts?feed=1') return response({ posts: [], nextCursor: null })
    return fallback(url)
  })
  render(<Community />)
  expect(await screen.findByText('Beiträge konnten nicht geladen werden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByText('Für „Design“ gibt es noch keine sichtbaren Beiträge.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Anderes Thema suchen' }))
  expect(screen.getByRole('searchbox', { name: 'Thema suchen' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Alle Beiträge zeigen' }))
  expect(window.location.search).toBe('')
  expect(await screen.findByRole('heading', { name: 'Keine Beiträge gefunden' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Beitrag schreiben' })).toBeVisible()
  expect(screen.queryByText('Für „Design“ gibt es noch keine sichtbaren Beiträge.')).not.toBeInTheDocument()
  expect(screen.queryByText('Sei der Erste, der etwas teilt!')).not.toBeInTheDocument()
})

it('adds existing and new topics by keyboard, prevents duplicates, and removes selections', async () => {
  global.fetch = jest.fn().mockImplementation(async (url: string) => url.startsWith('/api/posts/topics?')
    ? response({ topics: [{ id: '1', name: 'Design' }] }) : fallback(url))
  function Harness() {
    const [topics, setTopics] = require('react').useState([] as string[])
    return <PostTopicPicker value={topics} onChange={setTopics} disabled={false} />
  }
  const user = userEvent.setup()
  render(<Harness />)
  const input = screen.getByRole('textbox', { name: 'Themen (optional, bis zu 3)' })
  await user.click(input)
  await user.click(await screen.findByRole('button', { name: 'Design' }))
  expect(screen.getByRole('button', { name: 'Thema Design entfernen' })).toBeInTheDocument()
  await user.type(input, 'Design{Enter}')
  expect(screen.getByRole('alert')).toHaveTextContent('bereits ausgewählt')
  await user.clear(input)
  await user.type(input, 'Next.js{Enter}')
  expect(screen.getByRole('button', { name: 'Thema Next.js entfernen' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Thema Design entfernen' }))
  expect(screen.queryByRole('button', { name: 'Thema Design entfernen' })).not.toBeInTheDocument()
})

it('submits selected topics with a new discussion and displays the tagged result', async () => {
  global.fetch = jest.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/posts?feed=1') return response({ posts: [], nextCursor: null })
    if (url.startsWith('/api/posts/topics?')) return response({ topics: [] })
    if (url === '/api/posts' && options?.method === 'POST') return response(post('new', 'A new question', 'Design'))
    return fallback(url)
  })
  const user = userEvent.setup()
  render(<Community />)
  await screen.findByText('Keine Beiträge gefunden')
  await user.click(screen.getByRole('button', { name: 'Neuen Beitrag erstellen' }))
  await user.type(screen.getByRole('textbox', { name: 'Titel' }), 'A new question')
  await user.type(screen.getByRole('textbox', { name: 'Inhalt' }), 'Useful content')
  await user.type(screen.getByRole('textbox', { name: 'Themen (optional, bis zu 3)' }), 'Design{Enter}')
  await user.click(screen.getByRole('button', { name: 'Beitrag veröffentlichen' }))
  expect(await screen.findByText('A new question')).toBeInTheDocument()
  const creation = (global.fetch as jest.Mock).mock.calls.find(([url, options]) => url === '/api/posts' && options?.method === 'POST')
  expect(JSON.parse(creation[1].body)).toMatchObject({ title: 'A new question', tags: ['Design'] })
})

it('keeps an unfinished composer intact instead of changing feed topics', async () => {
  window.history.replaceState({}, '', '/community?tag=Design')
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/posts?feed=1&tag=Design') return response({ posts: [post('d', 'Design-post', 'Design')], nextCursor: null })
    if (url.startsWith('/api/posts/topics?')) return response({ topics: [{ id: 'design', name: 'Design' }] })
    return fallback(url)
  })
  const user = userEvent.setup()
  render(<Community />)
  expect(await screen.findByText('Design-post')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Neuen Beitrag erstellen' }))
  await user.type(screen.getByRole('textbox', { name: 'Titel' }), 'Unfinished draft')
  expect(screen.getByRole('searchbox', { name: 'Thema suchen' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Alle Beiträge zeigen' })).toBeDisabled()
  expect(screen.getByText('Schließe zuerst deinen Beitragsentwurf, bevor du das Thema wechselst.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Alle Beiträge zeigen' }))
  expect(window.location.search).toBe('?tag=Design')
  expect(screen.getByRole('textbox', { name: 'Titel' })).toHaveValue('Unfinished draft')
})
