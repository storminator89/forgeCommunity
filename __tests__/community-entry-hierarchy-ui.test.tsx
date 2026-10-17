import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import Community from '@/app/community/page'
import type { CommunityPost } from '@/lib/community-feed'

jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'ada', name: 'Ada', role: 'USER' } }, status: 'authenticated' }) }))
jest.mock('framer-motion', () => jest.requireActual('@/lib/motion'))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/community/PostCard', () => ({ PostCard: ({ post }: { post: CommunityPost }) => <article>{post.title}</article> }))
jest.mock('@/components/community/PostForm', () => ({ PostForm: ({ onSubmit }: { onSubmit: (title: string, content: string) => Promise<void> }) =>
  <button onClick={() => void onSubmit('Neue Frage', 'Ein Gedanke aus der Lerngruppe')}>Beitrag veröffentlichen</button> }))

const post: CommunityPost = {
  id: 'question', title: 'Wie sammelt ihr Feedback?', content: '<p>Welche Frage hilft euch weiter?</p>', published: true,
  authorId: 'bea', author: { id: 'bea', name: 'Bea', image: null }, createdAt: '2026-10-10T10:00:00Z',
  votes: 0, isLiked: false, comments: [], tags: [],
}
const response = (data: unknown, ok = true) => ({ ok, json: async () => data })
function fallback(url: string) {
  if (url === '/api/posts?feed=1') return response({ posts: [post], nextCursor: null })
  if (url === '/api/contributions/me') return response({ eligible: true, selectedByAuthors: 0, saturated: false })
  if (url === '/api/leaderboard') return response([])
  if (url === '/api/rewards/me') return response({ points: 0, completedCourses: 0, firstCourseCompleted: false })
  if (url === '/api/posts/me/stats') return response({ posts: 0, receivedLikes: 0, comments: 0 })
  throw new Error(`Unexpected fetch: ${url}`)
}

beforeEach(() => { window.history.replaceState({}, '', '/community'); jest.clearAllMocks() })

it('puts the task and composer before the compact filter and shows the inventory once', async () => {
  global.fetch = jest.fn().mockImplementation(async (url: string) => fallback(url))
  render(<Community />)
  await screen.findByText(post.title)
  const feed = screen.getByRole('region', { name: 'Aktuelle Beiträge' })
  const heading = within(feed).getByRole('heading', { name: 'Aktuelle Beiträge' })
  const composer = within(feed).getByRole('button', { name: 'Neuen Beitrag erstellen' })
  const filter = within(feed).getByRole('searchbox', { name: 'Thema suchen' })
  const count = within(feed).getByText('1 Beitrag geladen', { exact: true })
  const comesBefore = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(comesBefore(filter, heading)).toBe(true)
  expect(comesBefore(composer, filter)).toBe(true)
  expect(comesBefore(filter, count)).toBe(true)
  expect(screen.getAllByText('1 Beitrag geladen', { exact: true })).toHaveLength(1)
  expect(within(feed).getByRole('link', { name: 'Spaces entdecken' })).toHaveAttribute('href', '/community/spaces')
  expect(screen.queryByText('Austausch / Community')).not.toBeInTheDocument()
  expect(screen.queryByText('Themen entdecken')).not.toBeInTheDocument()
  expect(within(feed).getByRole('status')).toHaveTextContent('Ende der Liste.')
})

it('shows server-confirmed success in the local composer region below the app header', async () => {
  let finish!: (value: ReturnType<typeof response>) => void
  const pending = new Promise<ReturnType<typeof response>>(resolve => { finish = resolve })
  global.fetch = jest.fn().mockImplementation((url: string, options?: RequestInit) =>
    url === '/api/posts' && options?.method === 'POST' ? pending : Promise.resolve(fallback(url)))
  render(<Community />)
  await screen.findByText(post.title)
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Beitrag erstellen' }))
  fireEvent.click(screen.getByRole('button', { name: 'Beitrag veröffentlichen' }))
  expect(screen.queryByText('Beitrag erstellt!')).not.toBeInTheDocument()
  await act(async () => { finish(response({ ...post, id: 'new', title: 'Neue Frage', authorId: 'ada' })); await pending })
  const success = await screen.findByText('Beitrag erstellt!')
  expect(success).toHaveAttribute('role', 'status')
  expect(screen.getByRole('main')).toContainElement(success)
  expect(screen.getByRole('region', { name: 'Aktuelle Beiträge' })).toContainElement(success)
  expect(screen.getByRole('banner')).not.toContainElement(success)
  expect(success.className).not.toMatch(/\bfixed\b|\babsolute\b/)
  const composer = screen.getByRole('button', { name: 'Neuen Beitrag erstellen' })
  expect(success.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  await waitFor(() => expect(screen.getAllByText('2 Beiträge geladen', { exact: true })).toHaveLength(1))
})

it('keeps mutation errors actionable and local without dropping the draft form', async () => {
  global.fetch = jest.fn().mockImplementation(async (url: string, options?: RequestInit) =>
    url === '/api/posts' && options?.method === 'POST' ? response({ error: 'Unavailable' }, false) : fallback(url))
  render(<Community />)
  await screen.findByText(post.title)
  fireEvent.click(screen.getByRole('button', { name: 'Neuen Beitrag erstellen' }))
  fireEvent.click(screen.getByRole('button', { name: 'Beitrag veröffentlichen' }))
  const error = await within(screen.getByRole('main')).findByRole('alert')
  expect(error).toHaveTextContent('Fehler beim Erstellen/Aktualisieren des Beitrags.')
  expect(screen.getByRole('main')).toContainElement(error)
  expect(screen.getByRole('button', { name: 'Beitrag veröffentlichen' })).toBeVisible()
  expect(screen.queryByText('Beitrag erstellt!')).not.toBeInTheDocument()
})

it('declares shrinkable preferred widths and wraps only the long contribution refresh controls', async () => {
  global.fetch = jest.fn().mockImplementation(async (url: string) => fallback(url))
  render(<Community />)
  await screen.findByText(post.title)
  const feed = screen.getByRole('region', { name: 'Aktuelle Beiträge' })
  expect(feed).toHaveClass('min-w-0')
  expect(feed.parentElement).toHaveClass('fc-community-layout')
  expect(feed.parentElement?.className).not.toContain('grid-cols-')
  const search = within(feed).getByRole('searchbox', { name: 'Thema suchen' })
  expect(search).toHaveClass('min-w-0')
  expect(search).not.toHaveClass('min-w-32')
  expect(within(feed).getByRole('button', { name: 'Neuen Beitrag erstellen' })).toHaveClass('fc-composer')
  const contribution = screen.getByRole('heading', { name: 'Meine Diskussionsmeilensteine' }).closest('section')
  expect(contribution?.parentElement).toHaveClass('[&_button]:max-w-full', '[&_button]:whitespace-normal')
  const activity = screen.getByRole('heading', { name: 'Deine Aktivität' }).closest('section')
  expect(activity?.parentElement).toHaveAttribute('aria-label', 'Deine Community im Überblick')
})
