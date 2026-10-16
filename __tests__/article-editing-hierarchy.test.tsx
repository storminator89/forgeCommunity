import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import PublishedEditor from '@/app/knowledgebase/[id]/edit/page'
import DraftEditor from '@/app/knowledgebase/edit/[id]/page'

const mockPush = jest.fn()
const mockRouter = { push: mockPush }
const mockToast = { error: jest.fn(), success: jest.fn() }
let mockSession: { user: { id: string } } | null = { user: { id: 'author' } }
let mockStatus = 'authenticated'

jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Text bearbeiten" value={content} onChange={event => onChange(event.target.value)} /> }))
jest.mock('next/navigation', () => ({ useParams: () => ({ id: 'article-1' }), useRouter: () => mockRouter }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: mockSession, status: mockStatus }) }))
jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToast.error(...args), success: (...args: unknown[]) => mockToast.success(...args) } }))

const article = {
  id: 'article-1', title: 'Gemeinsam verständliche Projektentscheidungen festhalten', content: '<p>Bestehender Artikeltext mit einer konkreten Anleitung.</p>',
  category: 'Zusammenarbeit', featuredImage: null as string | null,
  author: { id: 'author', name: 'Synthetic Author', email: 'author@example.test' }, createdAt: '2026-10-01T12:00:00.000Z',
  tags: [{ id: 'tag-1', name: 'Werkstatt' }],
}
const metadata = { categories: ['Zusammenarbeit', 'Technik'], tags: ['Werkstatt', 'Projekt', 'Planung', 'Praxis', 'Feedback', 'Lernen'] }
const paramsValue = { id: 'article-1' }
const params = Object.assign(Promise.resolve(paramsValue), { status: 'fulfilled', value: paramsValue })
const editors = [
  { name: 'published', render: () => <PublishedEditor />, save: 'Speichern', requiredId: 'edit-article-required-fields' },
  { name: 'draft', render: () => <DraftEditor params={params} />, save: 'Als Entwurf speichern', requiredId: 'draft-editor-required-fields' },
]
let loadedArticle = { ...article }
let errorSpy: jest.SpyInstance

beforeEach(() => {
  loadedArticle = { ...article }
  mockSession = { user: { id: 'author' } }
  mockStatus = 'authenticated'
  mockPush.mockReset()
  mockToast.error.mockReset()
  mockToast.success.mockReset()
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    if (String(input) === '/api/articles/categories-and-tags') return { ok: true, json: async () => metadata } as Response
    if (!options?.method) return { ok: true, json: async () => loadedArticle } as Response
    return { ok: false, json: async () => ({ error: 'Speichern fehlgeschlagen' }) } as Response
  })
})
afterEach(() => errorSpy.mockRestore())

function expectBefore(first: Element, second: Element) {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
}
function latestSaveBody() {
  const call = jest.mocked(global.fetch).mock.calls.find(([, options]) => options?.method === 'PUT')
  return call?.[1]?.body as FormData
}

describe.each(editors)('$name editor hierarchy', editor => {
  it('puts native title/category controls and existing text before optional image and tags', async () => {
    render(editor.render())
    const title = await screen.findByDisplayValue(article.title)
    const required = screen.getByRole('group', { name: 'Pflichtangaben' })
    expect(required).toHaveAttribute('aria-describedby', editor.requiredId)
    expect(document.getElementById(editor.requiredId)).toHaveTextContent('Pflichtangaben: Titel, Inhalt und Kategorie.')
    expect(within(required).getByLabelText(/Titel/)).toBe(title)
    expect(title).toBeRequired()
    expect(title).toHaveAttribute('maxlength', '100')
    const category = within(required).getByLabelText('Kategorie')
    const content = screen.getByRole('textbox', { name: 'Text bearbeiten' })
    expect(category).toHaveValue(article.category)
    expect(content).toHaveValue(article.content)
    expectBefore(title, category)
    expectBefore(category, content)
    const optional = screen.getByRole('complementary', { name: 'Optionale Artikelangaben' })
    expectBefore(content, optional)
    expect(within(optional).getByLabelText('Beitragsbild (optional)')).toHaveAttribute('type', 'file')
    expect(within(optional).getByLabelText('Tags (max. 5)')).toBeInTheDocument()
    expect(within(optional).getByRole('button', { name: 'Tag Werkstatt entfernen' })).toBeInTheDocument()
    expect(within(optional).getByText('Optional, 1/5 ausgewählt')).toBeInTheDocument()
    expect(screen.queryByText('Noch kein Bild ausgewählt')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: editor.save })).toBeEnabled()
  })

  it('preserves a named existing-image removal and sends the deletion intent', async () => {
    loadedArticle = { ...article, featuredImage: '/uploads/synthetic-article.png' }
    render(editor.render())
    expect(await screen.findByAltText('Beitragsbildvorschau')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Beitragsbild entfernen' }))
    expect(screen.queryByAltText('Beitragsbildvorschau')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: editor.save }))
    await waitFor(() => expect(latestSaveBody()?.get('deleteImage')).toBe('true'))
    expect(latestSaveBody().get('title')).toBe(article.title)
    expect(latestSaveBody().get('content')).toBe(article.content)
    expect(latestSaveBody().get('category')).toBe(article.category)
    expect(latestSaveBody().get('tags')).toBe('Werkstatt')
  })

  it('keeps upload preview and file data on the original submission path', async () => {
    render(editor.render())
    await screen.findByDisplayValue(article.title)
    const file = new File(['synthetic-image'], 'synthetic.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Beitragsbild (optional)'), { target: { files: [file] } })
    expect(await screen.findByAltText('Beitragsbildvorschau')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: editor.save }))
    await waitFor(() => expect(latestSaveBody()?.get('featuredImage')).toBe(file))
    expect(latestSaveBody().get('deleteImage')).toBe('false')
  })

  it('retains validation when a required category is cleared', async () => {
    render(editor.render())
    await screen.findByDisplayValue(article.title)
    fireEvent.change(screen.getByLabelText('Kategorie'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: editor.save }))
    expect(jest.mocked(global.fetch).mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(0)
    if (editor.name === 'published') expect(screen.getByRole('main')).toHaveTextContent('Titel, Inhalt und Kategorie sind erforderlich.')
    else expect(mockToast.error).toHaveBeenCalledWith('Bitte füllen Sie alle erforderlichen Felder aus.')
  })

  it('keeps the loading screen free of editable content', () => {
    mockStatus = 'loading'
    render(editor.render())
    expect(within(screen.getByRole('main')).getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does not render article content for another account', async () => {
    mockSession = { user: { id: 'other' } }
    render(editor.render())
    expect(await screen.findByText(editor.name === 'published' ? 'Artikel konnte nicht geladen werden' : 'Entwurf konnte nicht geladen werden')).toBeInTheDocument()
    expect(screen.queryByDisplayValue(article.title)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Text bearbeiten' })).not.toBeInTheDocument()
  })
})

it('keeps published save pending, retains the original form link, then shows the server error', async () => {
  let finish!: (response: Response) => void
  const read = jest.mocked(global.fetch).getMockImplementation()!
  jest.mocked(global.fetch).mockImplementation((input, options) => options?.method === 'PUT' ? new Promise(resolve => { finish = resolve }) : read(input, options))
  render(<PublishedEditor />)
  const title = await screen.findByDisplayValue(article.title)
  const save = screen.getByRole('button', { name: 'Speichern' })
  expect(save).toHaveAttribute('form', title.closest('form')!.id)
  fireEvent.click(save)
  expect(screen.getByRole('button', { name: 'Speichern…' })).toBeDisabled()
  expect(mockPush).not.toHaveBeenCalled()
  await act(async () => finish({ ok: false, json: async () => ({ error: 'Speichern fehlgeschlagen' }) } as Response))
  expect(within(screen.getByRole('main')).getByRole('alert')).toHaveTextContent('Speichern fehlgeschlagen')
  expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled()
})

it.each([true, false])('keeps draft/publish distinct and disables both while pending (asDraft=%s)', async asDraft => {
  let finish!: (response: Response) => void
  const read = jest.mocked(global.fetch).getMockImplementation()!
  jest.mocked(global.fetch).mockImplementation((input, options) => options?.method === 'PUT' ? new Promise(resolve => { finish = resolve }) : read(input, options))
  render(<DraftEditor params={params} />)
  await screen.findByDisplayValue(article.title)
  fireEvent.click(screen.getByRole('button', { name: asDraft ? 'Als Entwurf speichern' : 'Veröffentlichen' }))
  expect(screen.getByRole('button', { name: asDraft ? 'Speichere Entwurf…' : 'Veröffentliche…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: asDraft ? 'Veröffentlichen' : 'Als Entwurf speichern' })).toBeDisabled()
  expect(latestSaveBody().get('isPublished')).toBe(String(!asDraft))
  expect(latestSaveBody().get('deleteImage')).toBe('false')
  expect(mockPush).not.toHaveBeenCalled()
  await act(async () => finish({ ok: true, json: async () => ({ id: article.id }) } as Response))
  expect(mockPush).toHaveBeenCalledWith(asDraft ? '/knowledgebase/drafts' : `/knowledgebase/${article.id}`)
})
