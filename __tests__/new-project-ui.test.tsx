import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import NewProjectPage from '@/app/projects/new/page'

const mockRouter = { push: jest.fn(), replace: jest.fn() }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => <aside>Navigation</aside> }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => <button>Konto</button> }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Design wechseln</button> }))
jest.mock('@/components/Editor', () => ({ Editor: ({ content, onChange }: { content: string; onChange: (value: string) => void }) => <textarea aria-label="Beschreibungstext" value={content} onChange={event => onChange(event.target.value)} /> }))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn() } }))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'user-1' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>)
})

it('does not count editor markup as project description text', () => {
  render(<NewProjectPage />)
  fireEvent.change(screen.getByLabelText('Titel *'), { target: { value: 'Mein Projekt' } })
  fireEvent.change(screen.getByLabelText('Beschreibungstext'), { target: { value: '<p>&nbsp;</p>'.repeat(30) } })
  fireEvent.click(screen.getByRole('button', { name: 'Projekt einreichen' }))
  expect(screen.getByText('Bitte beschreiben Sie Ihr Projekt mit mindestens 50 Zeichen.')).toBeInTheDocument()
  expect(fetch).not.toHaveBeenCalled()
})

it('normalizes tags and prevents duplicate whitespace variants', () => {
  render(<NewProjectPage />)
  fireEvent.change(screen.getByLabelText(/Tags/), { target: { value: ' React ' } })
  fireEvent.keyDown(screen.getByLabelText(/Tags/), { key: 'Enter' })
  expect(screen.getByText('Mit Enter hinzufügen. 1/20 Tags.')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText(/Tags/), { target: { value: 'React' } })
  fireEvent.click(screen.getByRole('button', { name: 'Tag hinzufügen' }))
  expect(screen.getByText('Mit Enter hinzufügen. 1/20 Tags.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Tag React entfernen' }))
  expect(screen.getByText('Mit Enter hinzufügen. 0/20 Tags.')).toBeInTheDocument()
})

it('rejects malformed image addresses without rendering an unsafe preview', () => {
  render(<NewProjectPage />)
  fireEvent.change(screen.getByLabelText(/Vorschaubild/), { target: { value: 'javascript:alert(1)' } })
  fireEvent.click(screen.getByRole('button', { name: 'Projekt einreichen' }))
  expect(screen.getByText('Bitte geben Sie eine gültige HTTP- oder HTTPS-Bildadresse ein.')).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: 'Vorschau des Projektbilds' })).not.toBeInTheDocument()
})

it('returns an unauthenticated author to this form after sign-in', async () => {
  jest.mocked(useSession).mockReturnValue({ data: null, status: 'unauthenticated', update: jest.fn() } as ReturnType<typeof useSession>)
  render(<NewProjectPage />)
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/login?callbackUrl=%2Fprojects%2Fnew'))
  expect(screen.getByRole('status')).toHaveTextContent('Weiterleitung zur Anmeldung')
})
