import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { FirstActionGuide } from '@/components/community/FirstActionGuide'
import { firstActionSnapshot, firstActionStorageKey, registerNewMemberFirstAction, setFirstActionVisibility } from '@/lib/new-member-first-action'

beforeEach(() => window.localStorage.clear())
afterEach(() => jest.restoreAllMocks())

it('shows no guide to an account without a registration receipt', () => {
  render(<FirstActionGuide userId="existing-member" />)
  expect(screen.queryByRole('region', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
})

it('matches the receipt to the current account without leaking it during account switches', () => {
  registerNewMemberFirstAction('alice-new')
  const view = render(<FirstActionGuide userId="bob-existing" />)
  expect(screen.queryByRole('region', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
  view.rerender(<FirstActionGuide userId="alice-new" />)
  expect(screen.getByRole('heading', { name: 'Dein Einstieg' })).toBeVisible()
  view.rerender(<FirstActionGuide userId="bob-existing" />)
  expect(screen.queryByRole('region', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
})

it('persists Skip for one account, leaves another new account open and does not reset on repeated receipts', async () => {
  const user = userEvent.setup()
  registerNewMemberFirstAction('alice-skip')
  registerNewMemberFirstAction('bob-new')
  const view = render(<FirstActionGuide userId="alice-skip" />)
  await user.click(screen.getByRole('button', { name: 'Überspringen' }))
  expect(window.localStorage.getItem(firstActionStorageKey('alice-skip'))).toBe('dismissed')
  expect(window.localStorage.getItem(firstActionStorageKey('bob-new'))).toBe('open')
  registerNewMemberFirstAction('alice-skip')
  expect(firstActionSnapshot('alice-skip')).toBe('dismissed')
  view.unmount()
  const revisit = render(<FirstActionGuide userId="alice-skip" />)
  expect(screen.queryByRole('heading', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Einstieg anzeigen' })).toBeVisible()
  revisit.rerender(<FirstActionGuide userId="bob-new" />)
  expect(screen.getByRole('heading', { name: 'Dein Einstieg' })).toBeVisible()
})

it('supports keyboard Skip/Reopen with focus returned to a surviving control and no initial focus grab', async () => {
  const user = userEvent.setup()
  registerNewMemberFirstAction('keyboard-new')
  render(<><button>Unrelated action</button><FirstActionGuide userId="keyboard-new" /></>)
  expect(screen.getByRole('heading', { name: 'Dein Einstieg' })).not.toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Unrelated action' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Überspringen' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('button', { name: 'Einstieg anzeigen' })).toHaveFocus()
  await user.keyboard('{Enter}')
  expect(screen.getByRole('heading', { name: 'Dein Einstieg' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Überspringen' })).toHaveFocus()
})

it('provides real optional destinations without progress scores, permissions or mutation requests', async () => {
  const user = userEvent.setup()
  registerNewMemberFirstAction('choices-new')
  render(<FirstActionGuide userId="choices-new" />)
  for (const [label, href] of [
    ['Beiträge lesen', '#community-feed-title'], ['Kurse entdecken', '/courses'],
    ['Events ansehen', '/events'], ['Fähigkeiten ergänzen', '/settings?tab=skills'],
  ]) expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href)
  expect(screen.getByText(/ohne weitere Profilangaben/)).toBeVisible()
  expect(screen.getByText(/nur in diesem Browser/)).toBeVisible()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  const link = screen.getByRole('link', { name: 'Kurse entdecken' })
  const activate = jest.fn((event: Event) => event.preventDefault())
  link.addEventListener('click', activate)
  link.focus()
  await user.keyboard('{Enter}')
  expect(activate).toHaveBeenCalledTimes(1)
  expect(firstActionSnapshot('choices-new')).toBe('open')
  expect(fetch).not.toHaveBeenCalled()
})

it('continues locally and permits Skip when storage reads and writes are unavailable', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  registerNewMemberFirstAction('blocked-new')
  const user = userEvent.setup()
  const view = render(<FirstActionGuide userId="blocked-new" />)
  expect(screen.getByRole('heading', { name: 'Dein Einstieg' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Überspringen' }))
  expect(screen.getByRole('button', { name: 'Einstieg anzeigen' })).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  view.rerender(<FirstActionGuide userId="blocked-other" />)
  expect(screen.queryByRole('region', { name: 'Dein Einstieg' })).not.toBeInTheDocument()
})

it('reflects another tab’s dismissal without stealing focus', () => {
  registerNewMemberFirstAction('multi-tab-new')
  render(<><button>Keep focus</button><FirstActionGuide userId="multi-tab-new" /></>)
  const control = screen.getByRole('button', { name: 'Keep focus' })
  control.focus()
  act(() => {
    window.localStorage.setItem(firstActionStorageKey('multi-tab-new'), 'dismissed')
    window.dispatchEvent(new StorageEvent('storage', { key: firstActionStorageKey('multi-tab-new'), newValue: 'dismissed' }))
  })
  expect(screen.getByRole('button', { name: 'Einstieg anzeigen' })).toBeVisible()
  expect(control).toHaveFocus()
})

it('ignores invalid receipts and unknown stored values', () => {
  for (const receipt of [null, undefined, {}, 42, '', 'x'.repeat(129)]) registerNewMemberFirstAction(receipt)
  expect(window.localStorage.length).toBe(0)
  window.localStorage.setItem(firstActionStorageKey('bad-status'), 'completed')
  expect(firstActionSnapshot('bad-status')).toBeNull()
  setFirstActionVisibility('existing-member', true)
  expect(firstActionSnapshot('existing-member')).toBeNull()
})

it('hydrates a receipt-gated guide without exposing browser state in server HTML', async () => {
  registerNewMemberFirstAction('hydration-new')
  const view = <StrictMode><FirstActionGuide userId="hydration-new" /></StrictMode>
  const container = document.createElement('div')
  container.innerHTML = renderToString(view)
  expect(container.innerHTML).toBe('')
  document.body.appendChild(container)
  const errors: unknown[] = []
  let root!: ReturnType<typeof hydrateRoot>
  try {
    await act(async () => { root = hydrateRoot(container, view, { onRecoverableError: error => errors.push(error) }) })
    expect(screen.getByRole('heading', { name: 'Dein Einstieg' })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await act(async () => root?.unmount())
    container.remove()
  }
})
