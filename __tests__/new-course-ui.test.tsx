import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import NewCoursePage from '@/app/courses/new/page'

const mockRouter = { push: jest.fn() }
jest.mock('next/navigation', () => ({ useRouter: () => mockRouter }))
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => <aside>Navigation</aside> }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => <button>Konto</button> }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Design wechseln</button> }))
jest.mock('@/components/ui/calendar', () => ({ Calendar: ({ onSelect }: { onSelect: (date: Date) => void }) => <button type="button" onClick={() => onSelect(new Date(2026, 9, 5))}>Testdatum wählen</button> }))

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useSession).mockReturnValue({ data: { user: { id: 'user-1' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn() } as ReturnType<typeof useSession>)
})

function completeRequiredFields() {
  fireEvent.change(screen.getByLabelText('Kurstitel'), { target: { value: 'Sicherheit' } })
  fireEvent.change(screen.getByLabelText('Kurskategorie'), { target: { value: 'Security' } })
  fireEvent.change(screen.getByLabelText('Preis'), { target: { value: '0' } })
  fireEvent.change(screen.getByLabelText('Maximale Teilnehmerzahl'), { target: { value: '20' } })
}

it('opens and clears the date picker without submitting a completed course form', () => {
  render(<NewCoursePage />)
  completeRequiredFields()
  const dateButton = screen.getByLabelText('Startdatum (optional)')
  expect(dateButton).toHaveAttribute('type', 'button')
  fireEvent.click(dateButton)
  fireEvent.click(screen.getByRole('button', { name: 'Testdatum wählen' }))
  expect(fetch).not.toHaveBeenCalled()
  fireEvent.click(dateButton)
  fireEvent.click(screen.getByRole('button', { name: 'Startdatum entfernen' }))
  expect(dateButton).toHaveTextContent('Datum auswählen')
  expect(fetch).not.toHaveBeenCalled()
})

it('prevents repeat submits and exposes failed creation inline', async () => {
  let resolveRequest!: (response: Response) => void
  jest.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { resolveRequest = resolve }))
  render(<NewCoursePage />)
  completeRequiredFields()
  const submitButton = screen.getByRole('button', { name: 'Kurs erstellen' })
  fireEvent.click(submitButton)
  expect(screen.getByRole('button', { name: 'Kurs wird erstellt…' })).toBeDisabled()
  fireEvent.submit(submitButton.closest('form')!)
  expect(fetch).toHaveBeenCalledTimes(1)
  resolveRequest({ ok: false, json: async () => ({ error: 'Keine Berechtigung' }) } as Response)
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Keine Berechtigung'))
  expect(screen.getByRole('button', { name: 'Kurs erstellen' })).toBeEnabled()
  expect(mockRouter.push).not.toHaveBeenCalled()
})
