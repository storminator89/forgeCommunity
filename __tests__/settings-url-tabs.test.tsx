import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime'
import axios from 'axios'
import { useSession } from 'next-auth/react'
import SettingsPage from '@/app/settings/page'
import { SettingsUrlContext as UrlContext } from '../test-utils/settings-url-context'

jest.mock('axios')
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }))
jest.mock('@/components/user-nav', () => ({ UserNav: () => null }))
jest.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => null }))
jest.mock('@/components/ImageUpload', () => ({ ImageUpload: () => null }))

function setUser(id: string | null) {
  jest.mocked(useSession).mockReturnValue({
    data: id ? { user: { id }, expires: '2099-01-01' } : null,
    status: id ? 'authenticated' : 'unauthenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
}

function profile(id: string) {
  return { data: { id, name: id, email: `${id}@example.test`, userSettings: { publicRankingOptIn: false } } }
}

beforeEach(() => {
  jest.clearAllMocks()
  window.history.replaceState(null, '', '/settings')
  setUser('alice')
  jest.mocked(axios.get).mockImplementation(async (url: string) => url === '/api/user/profile' ? profile('alice') : { data: [] })
})
afterEach(() => window.history.replaceState(null, '', '/settings'))

it.each([
  ['account', 'Konto'], ['notifications', 'Meldungen'], ['privacy', 'Privatsphäre'],
  ['skills', 'Fähigkeiten'], ['certificates', 'Zertifikate'],
])('opens the allowlisted %s tab on a direct load', async (tab, label) => {
  window.history.replaceState(null, '', `/settings?tab=${tab}`)
  render(<UrlContext><SettingsPage /></UrlContext>)
  expect(await screen.findByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true')
  if (tab === 'skills') {
    expect(screen.getByRole('heading', { name: 'Neue Fähigkeit hinzufügen' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeVisible()
  }
  expect(axios.post).not.toHaveBeenCalled()
  expect(axios.put).not.toHaveBeenCalled()
})

it.each(['', '?tab=', '?tab=unknown', '?tab=SKILLS', '?tab=__proto__', '?tab=javascript%3Aalert(1)'])('falls back to Konto for %s without rewriting the URL', async query => {
  window.history.replaceState(null, '', `/settings${query}`)
  const initialUrl = window.location.href
  render(<UrlContext><SettingsPage /></UrlContext>)
  expect(await screen.findByRole('tab', { name: 'Konto' })).toHaveAttribute('aria-selected', 'true')
  expect(window.location.href).toBe(initialUrl)
})

it('updates the URL by keyboard, keeps unrelated URL state and restores tabs on real Back/Forward events', async () => {
  const user = userEvent.setup()
  window.history.replaceState(null, '', '/settings?source=profile&tab=skills#page-content')
  render(<UrlContext><SettingsPage /></UrlContext>)
  const skills = await screen.findByRole('tab', { name: 'Fähigkeiten' })
  skills.focus()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Zertifikate' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: 'Zertifikate' })).toHaveAttribute('aria-selected', 'true')
  expect(window.location.search).toBe('?source=profile&tab=certificates')
  expect(window.location.hash).toBe('#page-content')
  const entries = window.history.length
  await user.click(screen.getByRole('tab', { name: 'Zertifikate' }))
  expect(window.history.length).toBe(entries)

  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener('popstate', () => resolve(), { once: true })
      window.history.back()
    })
  })
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Fähigkeiten' })).toHaveAttribute('aria-selected', 'true'))
  expect(window.location.search).toBe('?source=profile&tab=skills')
  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener('popstate', () => resolve(), { once: true })
      window.history.forward()
    })
  })
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Zertifikate' })).toHaveAttribute('aria-selected', 'true'))
  expect(axios.post).not.toHaveBeenCalled()
  expect(axios.put).not.toHaveBeenCalled()
})

it('keeps an unsaved account edit while changing tabs and navigating back', async () => {
  const user = userEvent.setup()
  render(<UrlContext><SettingsPage /></UrlContext>)
  const name = await screen.findByLabelText('Name')
  await user.clear(name)
  await user.type(name, 'Unsaved name')
  await user.click(screen.getByRole('tab', { name: 'Fähigkeiten' }))
  await act(async () => {
    await new Promise<void>(resolve => {
      window.addEventListener('popstate', () => resolve(), { once: true })
      window.history.back()
    })
  })
  expect(await screen.findByLabelText('Name')).toHaveValue('Unsaved name')
  expect(axios.put).not.toHaveBeenCalled()
})

it('drops old skills and pending responses on account switch while preserving the URL tab', async () => {
  window.history.replaceState(null, '', '/settings?tab=skills')
  let finishBob!: (value: { data: unknown }) => void
  jest.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url === '/api/user/profile') return profile('alice')
    if (url === '/api/user/skills') return { data: [{ id: 'alice-skill', skillId: 'typescript', level: 33, skill: { name: 'Alice private skill' } }] }
    return { data: [] }
  })
  const view = render(<UrlContext><SettingsPage /></UrlContext>)
  expect(await screen.findByText('Alice private skill')).toBeVisible()
  jest.mocked(axios.get).mockImplementation(async (url: string) => {
    if (url === '/api/user/profile') return new Promise(resolve => { finishBob = resolve })
    return { data: [] }
  })
  setUser('bob')
  view.rerender(<UrlContext><SettingsPage /></UrlContext>)
  expect(screen.queryByText('Alice private skill')).not.toBeInTheDocument()
  await waitFor(() => expect(finishBob).toBeDefined())
  const bobSignal = jest.mocked(axios.get).mock.calls.filter(([url]) => url === '/api/user/profile').at(-1)?.[1]?.signal
  setUser(null)
  view.rerender(<UrlContext><SettingsPage /></UrlContext>)
  expect(bobSignal?.aborted).toBe(true)
  await act(async () => finishBob(profile('bob')))
  expect(screen.getByText('Anmeldung erforderlich')).toBeVisible()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()

  setUser('bob')
  jest.mocked(axios.get).mockImplementation(async (url: string) => url === '/api/user/profile' ? profile('bob') : { data: [] })
  view.rerender(<UrlContext><SettingsPage /></UrlContext>)
  expect(await screen.findByRole('tab', { name: 'Fähigkeiten' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByText('Alice private skill')).not.toBeInTheDocument()
  expect(window.location.search).toBe('?tab=skills')
})

it('hydrates the skills deep link without hydration errors', async () => {
  window.history.replaceState(null, '', '/settings?tab=skills')
  const view = <SearchParamsContext.Provider value={new URLSearchParams('tab=skills')}><SettingsPage /></SearchParamsContext.Provider>
  const container = document.createElement('div')
  container.innerHTML = renderToString(view)
  document.body.appendChild(container)
  const errors: unknown[] = []
  let root!: ReturnType<typeof hydrateRoot>
  try {
    await act(async () => { root = hydrateRoot(container, view, { onRecoverableError: error => errors.push(error) }) })
    expect(await screen.findByRole('tab', { name: 'Fähigkeiten' })).toHaveAttribute('aria-selected', 'true')
    expect(errors).toEqual([])
  } finally {
    await act(async () => root?.unmount())
    container.remove()
  }
})
