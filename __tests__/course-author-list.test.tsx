import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from '@/lib/sites-auth/react'
import AuthorCoursesPage from '@/app/courses/authoring/page'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => <aside>Navigation</aside> }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => <button>Konto</button> }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Design wechseln</button> }))

const session = (id: string) => ({ data: { user: { id }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() }) as ReturnType<typeof useSession>
const response = (courses: unknown) => ({ ok: true, status: 200, json: async () => ({ courses }) }) as Response

beforeEach(() => {
  jest.mocked(useSession).mockReturnValue(session('author-a'))
})

it('lets an author rediscover unpublished drafts and unpublished live changes after leaving the editor', async () => {
  global.fetch = jest.fn().mockResolvedValue(response([
    { id: 'private-1', title: 'Privatkurs', revision: 3, activePublication: null, hasUnpublishedChanges: true },
    { id: 'live-2', title: 'Veröffentlichter Kurs', revision: 5, activePublication: { id: 'pub-1', sequence: 2, digest: 'live' }, hasUnpublishedChanges: true },
    { id: 'live-3', title: 'Aktueller Kurs', revision: 1, activePublication: { id: 'pub-2', sequence: 1, digest: 'current' }, hasUnpublishedChanges: false },
  ]))
  render(<AuthorCoursesPage />)
  expect(await screen.findByText('Privatkurs')).toBeInTheDocument()
  expect(screen.getByText('Privater Entwurf')).toBeInTheDocument()
  expect(screen.getByText('Unveröffentlichte Änderungen')).toBeInTheDocument()
  expect(screen.getByText('Veröffentlicht · aktuell')).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: /Im Autorenarbeitsplatz öffnen/ }).map(link => link.getAttribute('href'))).toEqual([
    '/courses/private-1/contents', '/courses/live-2/contents', '/courses/live-3/contents',
  ])
  expect(fetch).toHaveBeenCalledWith('/api/courses/authoring', expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }))
  expect(screen.queryByText('Quizantwort')).not.toBeInTheDocument()
})

it('shows an honest empty state and can retry a list outage', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'Serverfehler' }) }).mockResolvedValueOnce(response([]))
  render(<AuthorCoursesPage />)
  expect(await screen.findByText('Kursentwürfe konnten nicht geladen werden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByText('Noch keine Kursentwürfe')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Kursentwurf anlegen' })).toHaveAttribute('href', '/courses/new')
})

it('drops the prior account’s private list immediately on account switch and ignores its late response', async () => {
  let finishFirst!: (result: Response) => void
  global.fetch = jest.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finishFirst = resolve })).mockResolvedValueOnce(response([
    { id: 'b-only', title: 'Kurs von B', revision: 1, activePublication: null, hasUnpublishedChanges: true },
  ]))
  const view = render(<AuthorCoursesPage />)
  jest.mocked(useSession).mockReturnValue(session('author-b'))
  view.rerender(<AuthorCoursesPage />)
  expect(await screen.findByText('Kurs von B')).toBeInTheDocument()
  finishFirst(response([{ id: 'a-secret', title: 'Privater Kurs von A', revision: 1, activePublication: null, hasUnpublishedChanges: true }]))
  await waitFor(() => expect(screen.queryByText('Privater Kurs von A')).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: /Im Autorenarbeitsplatz öffnen/ })).toHaveAttribute('href', '/courses/b-only/contents')
})
