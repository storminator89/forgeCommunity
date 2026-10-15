import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddUserDialog from '@/components/admin/AddUserDialog'
import { EditUserDialog } from '@/components/admin/EditUserDialog'

beforeAll(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})

it('explains the notification preferences when an admin creates another account', async () => {
  const user = userEvent.setup()
  render(<AddUserDialog isOpen onClose={jest.fn()} onAddUser={jest.fn()} />)
  await user.click(screen.getByRole('tab', { name: 'Einstellungen' }))

  const email = screen.getByRole('switch', { name: 'E-Mail-Wunsch für später' })
  const desktop = screen.getByRole('switch', { name: 'Desktop-Hinweise für Chatnachrichten' })
  expect(email).toHaveAccessibleDescription(/E-Mails werden derzeit nicht versendet/)
  expect(desktop).toHaveAccessibleDescription(/Nur bei geöffneter App, inaktivem Tab und erteilter Browserberechtigung; kein Hintergrund-Push/)
})

it('explains that changing another account’s preference reaches open tabs on reload', async () => {
  const user = userEvent.setup()
  render(<EditUserDialog
    isOpen
    user={{ id: 'another-user', name: 'Ada', email: 'ada@example.test', role: 'USER', createdAt: '2026-01-01' }}
    onClose={jest.fn()}
    onUpdateUser={jest.fn()}
  />)
  await user.click(screen.getByRole('tab', { name: 'Einstellungen' }))

  const email = screen.getByRole('switch', { name: 'E-Mail-Wunsch für später' })
  const desktop = screen.getByRole('switch', { name: 'Desktop-Hinweise für Chatnachrichten' })
  expect(email).toHaveAccessibleDescription(/E-Mails werden derzeit nicht versendet/)
  expect(desktop).toHaveAccessibleDescription(/Bereits geöffnete Tabs übernehmen Admin-Änderungen erst nach Neuladen/)
})
