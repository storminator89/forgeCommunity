import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from '@/lib/sites-auth/react'
import UserManagement from '@/components/admin/UserManagement'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/components/admin/AddUserDialog', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/admin/EditUserDialog', () => ({ EditUserDialog: () => null }))

const account = {
  id: 'u1', name: 'Ada Test', email: 'ada@example.com', role: 'USER',
  createdAt: '2026-01-01T00:00:00.000Z', endorsements: 0, isTestAccount: false,
}
function sessionAs(role: string) {
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'admin', role }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
}
beforeEach(() => {
  jest.clearAllMocks()
  sessionAs('ADMIN')
  global.fetch = jest.fn().mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/admin/users') return { ok: true, json: async () => [account] }
    if (url === '/api/admin/users/u1/test-account' && options?.method === 'PATCH') {
      return { ok: true, json: async () => ({ isTestAccount: JSON.parse(options.body as string).isTestAccount }) }
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
})

it('lets admins flag an account as a test account and explains reward exclusion', async () => {
  const user = userEvent.setup()
  render(<UserManagement />)
  await user.click(await screen.findByRole('button', { name: 'Details von Ada Test öffnen' }))
  const toggle = screen.getByRole('switch', { name: 'Testkonto' })
  expect(toggle).not.toBeChecked()
  expect(screen.getByText(/Testkonten können keine Punkte oder Kursbelohnungen verdienen/)).toBeInTheDocument()
  await user.click(toggle)
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/users/u1/test-account', expect.objectContaining({
    method: 'PATCH', body: JSON.stringify({ isTestAccount: true }),
  })))
  await waitFor(() => expect(toggle).toBeChecked())
})

it('does not fetch or render the user roster for a non-admin session', () => {
  sessionAs('USER')
  render(<UserManagement />)
  expect(screen.getByRole('alert')).toHaveTextContent('Keine Administratorrechte.')
  expect(screen.queryByRole('button', { name: 'Details von Ada Test öffnen' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: 'Testkonto' })).not.toBeInTheDocument()
  expect(global.fetch).not.toHaveBeenCalled()
})
