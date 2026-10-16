import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { toast } from 'sonner'
import DraftEditor from '@/app/knowledgebase/edit/[id]/page'

const mockPush = jest.fn()
const mockRouter = { push: mockPush }
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Text bearbeiten" value={content} onChange={event => onChange(event.target.value)} /> }))
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'author' } }, status: 'authenticated' }) }))
jest.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light' }) }))

const paramsValue = { id: 'synthetic-draft' }
const params = Object.assign(Promise.resolve(paramsValue), { status: 'fulfilled', value: paramsValue })
const article = {
  id: paramsValue.id, title: 'Synthetischer Entwurf', content: '<p>Bestehender synthetischer Artikeltext</p>', category: 'Werkstatt',
  featuredImage: null, tags: [], author: { id: 'author' },
}
const putCalls = () => jest.mocked(global.fetch).mock.calls.filter(([, options]) => options?.method === 'PUT')

beforeEach(() => {
  mockPush.mockReset()
  global.fetch = jest.fn(async (input, options) => {
    if (options?.method === 'PUT') return { ok: false, json: async () => ({ error: 'Synthetic failure' }) } as Response
    return { ok: true, json: async () => String(input).endsWith('categories-and-tags') ? { categories: ['Werkstatt'], tags: [] } : article } as Response
  })
})
afterEach(() => { act(() => { toast.dismiss() }) })

it.each(['Als Entwurf speichern', 'Veröffentlichen'])('shows the required-field error through exactly one real local host for %s without mutation', async name => {
  render(<DraftEditor params={params} />)
  fireEvent.change(await screen.findByDisplayValue(article.title), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name }))
  const main = screen.getByRole('main')
  expect(await within(main).findByText('Bitte füllen Sie alle erforderlichen Felder aus.')).toBeInTheDocument()
  expect(main.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1)
  expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1)
  expect(putCalls()).toHaveLength(0)
  expect(mockPush).not.toHaveBeenCalled()
  expect(screen.getByRole('textbox', { name: 'Text bearbeiten' })).toHaveValue(article.content)
  expect(screen.getByLabelText('Kategorie')).toHaveValue(article.category)
})

it.each(['Als Entwurf speichern', 'Veröffentlichen'])('shows a server failure for %s with values retained and no automatic retry', async name => {
  const view = render(<DraftEditor params={params} />)
  const title = await screen.findByDisplayValue(article.title)
  fireEvent.change(title, { target: { value: 'Synthetisch weiterbearbeitet' } })
  fireEvent.click(screen.getByRole('button', { name }))
  expect(await within(screen.getByRole('main')).findByText('Fehler beim Speichern des Artikels')).toBeInTheDocument()
  expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1)
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled())
  expect(title).toHaveValue('Synthetisch weiterbearbeitet')
  expect(screen.getByRole('textbox', { name: 'Text bearbeiten' })).toHaveValue(article.content)
  expect(screen.getByLabelText('Kategorie')).toHaveValue(article.category)
  expect((putCalls()[0]?.[1]?.body as FormData).get('isPublished')).toBe(String(name === 'Veröffentlichen'))
  view.rerender(<DraftEditor params={params} />)
  await act(async () => { await Promise.resolve() })
  expect(putCalls()).toHaveLength(1)
  expect(mockPush).not.toHaveBeenCalled()
})
