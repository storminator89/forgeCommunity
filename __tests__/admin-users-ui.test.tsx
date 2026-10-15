import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSession } from 'next-auth/react'
import UserManagement from '@/components/admin/UserManagement'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/components/admin/AddUserDialog', () => ({ __esModule: true, default: () => null }))
jest.mock('@/components/admin/EditUserDialog', () => ({ EditUserDialog: ({ user }: { user: { settings?: { emailNotifications: boolean } } | null }) => user ? <p>Editor E-Mail: {String(user.settings?.emailNotifications)}</p> : null }))

const rows = [
  { id: 'u1', name: 'Ada Beispiel', email: 'ada@example.com', role: 'USER', createdAt: '2026-01-01T00:00:00.000Z', title: 'Designerin', isTestAccount: false },
  { id: 'u2', name: 'Bert Beispiel', email: 'bert@example.com', role: 'MODERATOR', createdAt: '2026-02-01T00:00:00.000Z', isTestAccount: true },
]
const detail = {
  ...rows[0], bio: 'Arbeitet in der Community.',
  userSettings: { emailNotifications: false, pushNotifications: true, theme: 'DARK', language: 'de' },
  stats: { postsCount: 3, commentsCount: 2, likesReceived: 1, endorsementsCount: 0, coursesCount: 4, projectsCount: 1 },
  badges: [{ name: 'Willkommen', awardedAt: '2026-01-01T00:00:00.000Z' }],
  skills: [{ name: 'Design', level: 75 }],
}
const ok = (value: unknown): Response => ({ ok: true, json: async () => value } as Response)

beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'admin', role: 'ADMIN' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url === '/api/admin/users') return ok(rows)
    if (url === '/api/admin/users/u1') return ok(detail)
    if (url === '/api/admin/users/u2') return ok(rows[1])
    throw new Error(`Unexpected request ${url}`)
  })
})

test('keeps one heading and uses an explicit, keyboard-accessible detail control', async () => {
  const user = userEvent.setup()
  const { container } = render(<UserManagement />)
  expect(await screen.findByRole('button', { name: 'Details von Ada Beispiel öffnen' })).toBeVisible()
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  expect(container.querySelector('main')).toBeNull()
  const list = screen.getByRole('region', { name: 'Benutzerliste, horizontal verschiebbar' })
  expect(list).toHaveAttribute('tabindex', '0')
  expect(within(list).getByRole('button', { name: 'Aktionen für Ada Beispiel' })).toBeVisible()
  fireEvent.click(screen.getByText('ada@example.com'))
  expect(screen.queryByRole('complementary', { name: 'Details zu Ada Beispiel' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Details von Ada Beispiel öffnen' }))
  expect(screen.getByRole('button', { name: 'Details von Ada Beispiel öffnen' })).toHaveAttribute('aria-pressed', 'true')
  expect(await screen.findByText('Arbeitet in der Community.')).toBeVisible()
  expect(global.fetch).toHaveBeenCalledWith('/api/admin/users/u1', expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
})

test('normalizes detailed settings, stats and skills from the existing account endpoint', async () => {
  const user = userEvent.setup()
  render(<UserManagement />)
  await user.click(await screen.findByRole('button', { name: 'Details von Ada Beispiel öffnen' }))
  await screen.findByText('Arbeitet in der Community.')
  await user.click(screen.getByRole('tab', { name: 'Aktivität' }))
  const panel = screen.getByRole('tabpanel', { name: 'Aktivität' })
  expect(within(panel).getByText('Beiträge')).toBeVisible()
  expect(within(panel).getByText('3')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Skills' }))
  expect(screen.getByText('Design')).toBeVisible()
  expect(screen.getByText('75%')).toBeVisible()
  await user.click(screen.getByRole('tab', { name: 'Einstellungen' }))
  expect(screen.getByText('Deaktiviert')).toBeVisible()
  expect(screen.getByText('Dunkel')).toBeVisible()
})

test('searches, announces result count, and offers a reset for no matches', async () => {
  const user = userEvent.setup()
  render(<UserManagement />)
  await screen.findByRole('button', { name: 'Details von Ada Beispiel öffnen' })
  await user.type(screen.getByRole('searchbox', { name: 'Benutzer suchen' }), 'no match')
  expect(screen.getByText('0 von 2 Konten')).toBeVisible()
  expect(screen.getByText('Keine Treffer')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Suche zurücksetzen' }))
  expect(screen.getByRole('button', { name: 'Details von Bert Beispiel öffnen' })).toBeVisible()
})

test('offers retry after a failed initial load and does not invent zero statistics', async () => {
  jest.mocked(global.fetch).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'offline' }) } as Response)
  const user = userEvent.setup()
  render(<UserManagement />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Benutzer konnten nicht geladen werden')
  expect(screen.queryByText('Gesamt')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByRole('button', { name: 'Details von Ada Beispiel öffnen' })).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('loads full settings before opening the edit form', async () => {
  const user = userEvent.setup()
  render(<UserManagement />)
  await screen.findByRole('button', { name: 'Aktionen für Ada Beispiel' })
  await user.click(screen.getByRole('button', { name: 'Aktionen für Ada Beispiel' }))
  await user.click(screen.getByRole('menuitem', { name: 'Bearbeiten' }))
  expect(await screen.findByText('Editor E-Mail: false')).toBeVisible()
})

test('keeps a failed deletion visible instead of silently removing the user', async () => {
  const user = userEvent.setup()
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true)
  jest.mocked(global.fetch).mockImplementation(async (input: string | Request | URL, init?: RequestInit) => {
    if (input === '/api/admin/users' && init?.method === 'GET') return ok(rows)
    if (input === '/api/admin/users/u1' && init?.method === 'DELETE') return { ok: false, json: async () => ({ error: 'Der letzte Administrator muss erhalten bleiben' }) } as Response
    throw new Error(`Unexpected request ${input}`)
  })
  render(<UserManagement />)
  await screen.findByRole('button', { name: 'Aktionen für Ada Beispiel' })
  await user.click(screen.getByRole('button', { name: 'Aktionen für Ada Beispiel' }))
  await user.click(screen.getByRole('menuitem', { name: 'Löschen' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Der letzte Administrator muss erhalten bleiben'))
  expect(screen.getByRole('button', { name: 'Details von Ada Beispiel öffnen' })).toBeVisible()
  confirm.mockRestore()
})

test('explains why another learner’s certificate blocks account deletion', async () => {
  const user = userEvent.setup()
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true)
  jest.mocked(global.fetch).mockImplementation(async (input: string | Request | URL, init?: RequestInit) => {
    if (input === '/api/admin/users' && init?.method === 'GET') return ok(rows)
    if (input === '/api/admin/users/u1' && init?.method === 'DELETE') return {
      ok: false, status: 409,
      json: async () => ({ error: 'Dieses Konto kann nicht gelöscht werden, weil andere Mitglieder Zertifikate für seine Kurse besitzen. Es wurden keine Daten gelöscht.' }),
    } as Response
    throw new Error(`Unexpected request ${input}`)
  })
  render(<UserManagement />)
  await user.click(await screen.findByRole('button', { name: 'Aktionen für Ada Beispiel' }))
  await user.click(screen.getByRole('menuitem', { name: 'Löschen' }))
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Zertifikate für Kurse dieses Kontos'))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('andere Mitglieder Zertifikate'))
  expect(screen.getByRole('button', { name: 'Details von Ada Beispiel öffnen' })).toBeVisible()
  confirm.mockRestore()
})

test('immediately hides admin data and details when the authenticated account loses admin access', async () => {
  const user = userEvent.setup()
  const { rerender } = render(<UserManagement />)
  await user.click(await screen.findByRole('button', { name: 'Details von Ada Beispiel öffnen' }))
  expect(await screen.findByText('Arbeitet in der Community.')).toBeVisible()

  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'ordinary-user', role: 'USER' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  rerender(<UserManagement />)
  expect(screen.getByRole('alert')).toHaveTextContent('Keine Administratorrechte')
  expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument()
  expect(screen.queryByText('Arbeitet in der Community.')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Aktionen für Ada Beispiel' })).not.toBeInTheDocument()
})

test('discards a pending previous admin list after switching to another admin', async () => {
  let resolveOld!: (response: Response) => void
  const oldRequest = new Promise<Response>(resolve => { resolveOld = resolve })
  let listRequests = 0
  jest.mocked(global.fetch).mockImplementation(async (input: string | Request | URL) => {
    if (input === '/api/admin/users') return ++listRequests === 1 ? oldRequest : ok([rows[1]])
    throw new Error(`Unexpected request ${input}`)
  })
  const { rerender } = render(<UserManagement />)
  expect(screen.getByRole('status')).toHaveTextContent('Benutzer werden geladen')
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'second-admin', role: 'ADMIN' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  rerender(<UserManagement />)
  expect(await screen.findByRole('button', { name: 'Details von Bert Beispiel öffnen' })).toBeVisible()
  await act(async () => { resolveOld(ok([rows[0]])); await oldRequest })
  expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument()
  expect(screen.getByText('bert@example.com')).toBeVisible()
})

test('discards previous-admin detail responses after an account switch', async () => {
  let resolveOld!: (response: Response) => void
  const oldDetail = new Promise<Response>(resolve => { resolveOld = resolve })
  let listRequests = 0
  jest.mocked(global.fetch).mockImplementation(async (input: string | Request | URL) => {
    if (input === '/api/admin/users') return ok(++listRequests === 1 ? [rows[0]] : [rows[1]])
    if (input === '/api/admin/users/u1') return oldDetail
    throw new Error(`Unexpected request ${input}`)
  })
  const user = userEvent.setup()
  const { rerender } = render(<UserManagement />)
  await user.click(await screen.findByRole('button', { name: 'Details von Ada Beispiel öffnen' }))
  jest.mocked(useSession).mockReturnValue({
    data: { user: { id: 'second-admin', role: 'ADMIN' }, expires: '2099-01-01' }, status: 'authenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
  rerender(<UserManagement />)
  expect(await screen.findByRole('button', { name: 'Details von Bert Beispiel öffnen' })).toBeVisible()
  await act(async () => { resolveOld(ok(detail)); await oldDetail })
  expect(screen.queryByText('Arbeitet in der Community.')).not.toBeInTheDocument()
  expect(screen.queryByText('ada@example.com')).not.toBeInTheDocument()
})
