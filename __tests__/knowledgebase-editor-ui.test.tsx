import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import NewArticle from '@/app/knowledgebase/new-article/page'
import PublishedEditor from '@/app/knowledgebase/[id]/edit/page'
import DraftEditor from '@/app/knowledgebase/edit/[id]/page'

const mockPush = jest.fn()
let mockSession: { user: { id: string } } | null = { user: { id: 'author' } }

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Inhalt" value={content} onChange={event => onChange(event.target.value)} /> }))
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'article-1' }), useRouter: () => ({ push: mockPush }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession, status: mockSession ? 'authenticated' : 'unauthenticated' }) }))

const article = { id: 'article-1', title: 'Bestehender Artikel', content: '<p>Inhalt</p>', category: 'Praxis', featuredImage: null, author: { id: 'author', name: 'Ada', email: 'ada@example.test' }, createdAt: '2026-05-01T10:00:00.000Z', tags: [] }
const metadata = { categories: ['Praxis'], tags: ['Werkstatt'] }

beforeEach(() => {
  mockSession = { user: { id: 'author' } }
  mockPush.mockClear()
  global.fetch = jest.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input)
    if (url === '/api/articles/categories-and-tags') return { ok: true, json: async () => metadata } as Response
    if (url === '/api/articles/article-1' && !options?.method) return { ok: true, json: async () => article } as Response
    return { ok: false, json: async () => ({ error: 'Testfehler' }) } as Response
  })
})

it('keeps a new draft submission distinct from publishing and preserves selected metadata', async () => {
  render(<NewArticle />)
  const title = await screen.findByLabelText(/Titel/)
  fireEvent.change(title, { target: { value: 'Neue Anleitung' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Inhalt' }), { target: { value: 'Schritt für Schritt' } })
  fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: 'Praxis' } })
  fireEvent.click(screen.getByRole('button', { name: 'Als Entwurf speichern' }))

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/articles', expect.objectContaining({ method: 'POST' })))
  const call = jest.mocked(global.fetch).mock.calls.find(([url]) => url === '/api/articles')
  const body = call?.[1]?.body as FormData
  expect(body.get('title')).toBe('Neue Anleitung')
  expect(body.get('content')).toBe('Schritt für Schritt')
  expect(body.get('category')).toBe('Praxis')
  expect(body.get('isPublished')).toBe('false')
})

it('keeps published edit controls inside a form and sends image intent', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  render(<PublishedEditor />)
  const title = await screen.findByDisplayValue('Bestehender Artikel')
  expect(title.closest('form')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/articles/article-1', expect.objectContaining({ method: 'PUT' })))
  const call = jest.mocked(global.fetch).mock.calls.find(([url, options]) => url === '/api/articles/article-1' && options?.method === 'PUT')
  expect((call?.[1]?.body as FormData).get('deleteImage')).toBe('false')
  errorSpy.mockRestore()
})

it('offers a retry when a draft editor cannot load', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.mocked(global.fetch).mockImplementationOnce(async () => ({ ok: false, statusText: 'Unavailable' } as Response))
  const paramsValue = { id: 'article-1' }
  const params = Object.assign(Promise.resolve(paramsValue), { status: 'fulfilled', value: paramsValue })
  render(<DraftEditor params={params} />)
  expect(await screen.findByText('Entwurf konnte nicht geladen werden')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByDisplayValue('Bestehender Artikel')).toBeInTheDocument()
  errorSpy.mockRestore()
})

it('clears an unsaved new article when the account changes or signs out', async () => {
  const view = render(<NewArticle />)
  fireEvent.change(await screen.findByLabelText(/Titel/), { target: { value: 'Alice private notes' } })
  mockSession = { user: { id: 'bob' } }
  view.rerender(<NewArticle />)
  expect(screen.queryByDisplayValue('Alice private notes')).not.toBeInTheDocument()
  expect(await screen.findByLabelText(/Titel/)).toHaveValue('')
  mockSession = null
  view.rerender(<NewArticle />)
  expect(screen.queryByDisplayValue('Alice private notes')).not.toBeInTheDocument()
  expect(screen.getByText('Anmeldung erforderlich')).toBeInTheDocument()
})

it('does not offer a published-article editor to a different account', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const view = render(<PublishedEditor />)
  fireEvent.change(await screen.findByDisplayValue('Bestehender Artikel'), { target: { value: 'Alice unpublished changes' } })
  mockSession = { user: { id: 'bob' } }
  view.rerender(<PublishedEditor />)
  expect(screen.queryByDisplayValue('Alice unpublished changes')).not.toBeInTheDocument()
  expect(await screen.findByText('Artikel konnte nicht geladen werden')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
  errorSpy.mockRestore()
})

it('ignores a late private draft response after the editor changes accounts', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  const paramsValue = { id: 'article-1' }
  const params = Object.assign(Promise.resolve(paramsValue), { status: 'fulfilled', value: paramsValue })
  let resolveAlice!: (response: Response) => void
  jest.mocked(global.fetch).mockImplementation((input: RequestInfo | URL) => {
    if (String(input) === '/api/articles/categories-and-tags') return Promise.resolve({ ok: true, json: async () => metadata } as Response)
    if (mockSession?.user.id === 'author') return new Promise<Response>(resolve => { resolveAlice = resolve })
    return Promise.resolve({ ok: false, statusText: 'Not found' } as Response)
  })

  const view = render(<DraftEditor params={params} />)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/articles/article-1', expect.anything()))
  mockSession = { user: { id: 'bob' } }
  view.rerender(<DraftEditor params={params} />)
  expect(await screen.findByText('Entwurf konnte nicht geladen werden')).toBeInTheDocument()
  await act(async () => resolveAlice({ ok: true, json: async () => article } as Response))
  expect(screen.queryByDisplayValue('Bestehender Artikel')).not.toBeInTheDocument()
  errorSpy.mockRestore()
})
