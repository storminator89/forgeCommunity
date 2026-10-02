import { TextEncoder } from 'node:util'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { getProviders, signIn } from 'next-auth/react'
import LoginPage from '@/app/login/page'
import RegisterPage from '@/app/register/page'
import LogoutPage from '@/app/logout/page'
import { signOut } from 'next-auth/react'

const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }
let mockCallback: string | null = null
jest.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => ({ get: () => mockCallback }),
}))
jest.mock('next-auth/react', () => ({ getProviders: jest.fn(), signIn: jest.fn(), signOut: jest.fn() }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Design wechseln</button> }))

beforeEach(() => {
  jest.clearAllMocks()
  mockCallback = null
  jest.mocked(getProviders).mockResolvedValue(null)
  Object.assign(globalThis, { TextEncoder })
})

it('offers Google login only when the server has that provider configured', async () => {
  render(<LoginPage />)
  await waitFor(() => expect(getProviders).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'Mit Google anmelden' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Passwort vergessen?' })).not.toBeInTheDocument()
})

it('falls back to the community for unsafe callback URLs', async () => {
  mockCallback = '/\\evil.example'
  jest.mocked(getProviders).mockResolvedValue({ google: { id: 'google', name: 'Google', type: 'oauth', signinUrl: '', callbackUrl: '' } } as Awaited<ReturnType<typeof getProviders>>)
  jest.mocked(signIn).mockResolvedValue(undefined)
  render(<LoginPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Mit Google anmelden' }))
  await waitFor(() => expect(signIn).toHaveBeenCalledWith('google', { callbackUrl: '/community' }))
})

it('shows the login server error in an alert and permits retry', async () => {
  jest.mocked(signIn).mockResolvedValue({ error: 'CredentialsSignin', status: 401, ok: false, url: null })
  render(<LoginPage />)
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), { target: { value: 'member@example.com' } })
  fireEvent.change(screen.getByLabelText('Passwort'), { target: { value: 'old' } })
  fireEvent.click(screen.getByRole('button', { name: 'Anmelden' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Anmeldung fehlgeschlagen')
  expect(signIn).toHaveBeenCalledWith('credentials', { redirect: false, email: 'member@example.com', password: 'old' })
  expect(screen.getByRole('button', { name: 'Anmelden' })).toBeEnabled()
})

it('explains the password requirements and blocks mismatching registration passwords', async () => {
  render(<RegisterPage />)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Member' } })
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), { target: { value: 'member@example.com' } })
  fireEvent.change(screen.getByLabelText('Passwort', { exact: true }), { target: { value: 'ValidPassword12!' } })
  fireEvent.change(screen.getByLabelText('Passwort bestätigen'), { target: { value: 'DifferentPassword12!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Die Passwörter stimmen nicht überein.')
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.getByText(/Mindestens 12 Zeichen/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Nutzungsbedingungen' })).not.toBeInTheDocument()
})

it('preserves successful registration when automatic sign-in fails', async () => {
  jest.mocked(fetch).mockResolvedValue({ ok: true } as Response)
  jest.mocked(signIn).mockResolvedValue({ error: 'CredentialsSignin', status: 401, ok: false, url: null })
  render(<RegisterPage />)
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Member' } })
  fireEvent.change(screen.getByLabelText('E-Mail-Adresse'), { target: { value: 'member@example.com' } })
  fireEvent.change(screen.getByLabelText('Passwort', { exact: true }), { target: { value: 'ValidPassword12!' } })
  fireEvent.change(screen.getByLabelText('Passwort bestätigen'), { target: { value: 'ValidPassword12!' } })
  fireEvent.click(screen.getByRole('button', { name: 'Konto erstellen' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Dein Konto wurde erstellt.')
  expect(screen.getByRole('link', { name: 'Zur Anmeldung' })).toHaveAttribute('href', '/login')
  expect(screen.queryByRole('button', { name: 'Konto erstellen' })).not.toBeInTheDocument()
})

it('offers a recovery action after failed logout', async () => {
  jest.mocked(signOut).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ url: '/' })
  render(<LogoutPage />)
  fireEvent.click(await screen.findByRole('button', { name: 'Abmeldung erneut versuchen' }))
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'))
})

// Progressive HTML submission must not put credentials into the URL before hydration.
it('uses POST for the login form before client-side submission takes over', () => {
  render(<LoginPage />)
  expect(screen.getByLabelText('Passwort').closest('form')).toHaveAttribute('method', 'post')
})

it('uses POST for registration before client-side submission takes over', () => {
  render(<RegisterPage />)
  expect(screen.getByLabelText('Passwort').closest('form')).toHaveAttribute('method', 'post')
})
