import { act, render, screen, waitFor } from '@testing-library/react'
import { useSession } from 'next-auth/react'
import { ChatProvider, useChat } from '@/contexts/ChatContext'
import { publishBrowserChatAlertPreference } from '@/lib/browser-chat-alerts'

const mockAddNotification = jest.fn(async () => undefined)
jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))
jest.mock('@/contexts/NotificationContext', () => ({
  useNotifications: () => ({ addNotification: mockAddNotification }),
}))

const originalNotification = Object.getOwnPropertyDescriptor(window, 'Notification')
let browserNotification: jest.Mock
let requestPermission: jest.Mock
let intervalSpy: jest.SpyInstance
let activeDesktopAlerts: Set<string>

const channel = { id: 'room', name: 'general', isPrivate: false, _count: { messages: 0, members: 0 }, members: [] }
const response = (data: unknown) => ({ ok: true, json: async () => data } as Response)
const message = (id: string) => ({
  id, channelId: 'room', content: `New message ${id}`,
  author: { id: 'other', name: 'Other', image: null },
  createdAt: `2026-10-15T00:00:0${id.slice(-1)}.000Z`, messageType: 'text',
})

function setViewer(id: string | null) {
  jest.mocked(useSession).mockReturnValue({
    data: id ? { user: { id, name: id }, expires: '2099-01-01' } : null,
    status: id ? 'authenticated' : 'unauthenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
}

function installBrowserPermission(permission: NotificationPermission | 'unsupported') {
  requestPermission = jest.fn(async () => 'granted')
  activeDesktopAlerts = new Set()
  browserNotification = jest.fn((_title: string, options: NotificationOptions) => {
    const notification = new EventTarget()
    const body = options.body ?? ''
    activeDesktopAlerts.add(body)
    return Object.assign(notification, {
      close: jest.fn(() => {
        activeDesktopAlerts.delete(body)
        notification.dispatchEvent(new Event('close'))
      }),
    })
  })
  if (permission === 'unsupported') {
    Reflect.deleteProperty(window, 'Notification')
    return
  }
  Object.defineProperties(browserNotification, {
    permission: { configurable: true, value: permission },
    requestPermission: { configurable: true, value: requestPermission },
  })
  Object.defineProperty(window, 'Notification', { configurable: true, value: browserNotification })
}

function ChatProbe() {
  const { currentChannel } = useChat()
  return <p>{currentChannel?.id ?? 'none'}</p>
}

async function mountChat(preference: (id: string) => boolean, nextPollMessage: () => ReturnType<typeof message>) {
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/user/profile') {
      const id = jest.mocked(useSession)().data?.user?.id ?? ''
      return Promise.resolve(response({ id, userSettings: { pushNotifications: preference(id) } }))
    }
    if (url === '/api/chat/channels') return Promise.resolve(response([channel]))
    if (url.includes('latest=true')) return Promise.resolve(response({ items: [] }))
    if (url.includes('/api/chat/messages?') && url.includes('after=')) return Promise.resolve(response({ items: [nextPollMessage()] }))
    throw new Error(`Unexpected fetch: ${url}`)
  })
  const view = render(<ChatProvider><ChatProbe /></ChatProvider>)
  await screen.findByText('room')
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/user/profile', expect.objectContaining({ signal: expect.any(AbortSignal) })))
  await act(async () => { await Promise.resolve() })
  return view
}

async function pollWhileUnfocused() {
  await act(async () => { window.dispatchEvent(new Event('blur')) })
  const callback = intervalSpy.mock.calls.filter(([, delay]) => delay === 10000).at(-1)?.[0] as (() => Promise<void>) | undefined
  expect(callback).toBeDefined()
  await act(async () => { await callback?.() })
}

beforeEach(() => {
  jest.clearAllMocks()
  setViewer('alice')
  installBrowserPermission('granted')
  intervalSpy = jest.spyOn(global, 'setInterval')
})

afterEach(() => {
  intervalSpy.mockRestore()
  if (originalNotification) Object.defineProperty(window, 'Notification', originalNotification)
  else Reflect.deleteProperty(window, 'Notification')
})

it('never asks for browser permission on mount and only alerts with saved opt-in and a grant', async () => {
  let next = 0
  await mountChat(() => true, () => message(String(++next)))
  expect(requestPermission).not.toHaveBeenCalled()
  await pollWhileUnfocused()
  expect(browserNotification).toHaveBeenCalledWith('Neue Nachricht', expect.objectContaining({ body: expect.stringContaining('New message 1') }))
  expect(browserNotification.mock.calls[0][1]).not.toHaveProperty('icon')
  expect(mockAddNotification).not.toHaveBeenCalled()
})

it.each(['default', 'denied', 'unsupported'] as const)('avoids client-written inbox duplicates and skips desktop alerts with %s browser permission', async (permission) => {
  installBrowserPermission(permission)
  let next = 0
  await mountChat(() => true, () => message(String(++next)))
  await pollWhileUnfocused()
  expect(browserNotification).not.toHaveBeenCalled()
  expect(requestPermission).not.toHaveBeenCalled()
  expect(mockAddNotification).not.toHaveBeenCalled()
})

it.each([undefined, null, 'bob'])('fails closed when the profile account ID is %s', async (profileId) => {
  let next = 0
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/user/profile') return Promise.resolve(response({ id: profileId, userSettings: { pushNotifications: true } }))
    if (url === '/api/chat/channels') return Promise.resolve(response([channel]))
    if (url.includes('latest=true')) return Promise.resolve(response({ items: [] }))
    if (url.includes('/api/chat/messages?') && url.includes('after=')) return Promise.resolve(response({ items: [message(String(++next))] }))
    throw new Error(`Unexpected fetch: ${url}`)
  })

  render(<ChatProvider><ChatProbe /></ChatProvider>)
  await screen.findByText('room')
  await act(async () => { await Promise.resolve() })
  await pollWhileUnfocused()
  expect(browserNotification).not.toHaveBeenCalled()
  expect(mockAddNotification).not.toHaveBeenCalled()
})

it('follows successful setting off and on updates without client-written inbox duplicates', async () => {
  let next = 0
  await mountChat(() => false, () => message(String(++next)))
  await pollWhileUnfocused()
  expect(browserNotification).not.toHaveBeenCalled()
  expect(mockAddNotification).not.toHaveBeenCalled()

  act(() => publishBrowserChatAlertPreference({ userId: 'alice', enabled: true }))
  await pollWhileUnfocused()
  expect(browserNotification).toHaveBeenCalledTimes(1)
  expect(mockAddNotification).not.toHaveBeenCalled()

  act(() => publishBrowserChatAlertPreference({ userId: 'alice', enabled: false }))
  await pollWhileUnfocused()
  expect(browserNotification).toHaveBeenCalledTimes(1)
  expect(mockAddNotification).not.toHaveBeenCalled()
})

it('fails closed while the saved preference is pending and ignores a stale reply after an update', async () => {
  let finishProfile!: (value: Response) => void
  const pendingProfile = new Promise<Response>(resolve => { finishProfile = resolve })
  let next = 0
  global.fetch = jest.fn((input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/user/profile') return pendingProfile
    if (url === '/api/chat/channels') return Promise.resolve(response([channel]))
    if (url.includes('latest=true')) return Promise.resolve(response({ items: [] }))
    if (url.includes('/api/chat/messages?') && url.includes('after=')) return Promise.resolve(response({ items: [message(String(++next))] }))
    throw new Error(`Unexpected fetch: ${url}`)
  })

  render(<ChatProvider><ChatProbe /></ChatProvider>)
  await screen.findByText('room')
  await pollWhileUnfocused()
  expect(browserNotification).not.toHaveBeenCalled()
  expect(mockAddNotification).not.toHaveBeenCalled()

  act(() => publishBrowserChatAlertPreference({ userId: 'alice', enabled: false }))
  await act(async () => {
    finishProfile(response({ id: 'alice', userSettings: { pushNotifications: true } }))
    await pendingProfile
  })
  await pollWhileUnfocused()
  expect(browserNotification).not.toHaveBeenCalled()
  expect(mockAddNotification).not.toHaveBeenCalled()

  act(() => publishBrowserChatAlertPreference({ userId: 'alice', enabled: true }))
  await pollWhileUnfocused()
  expect(browserNotification).toHaveBeenCalledTimes(1)
})

it('does not apply Alice’s preference event to Bob after an account switch', async () => {
  let next = 0
  const view = await mountChat(id => id === 'alice', () => message(String(++next)))
  setViewer('bob')
  view.rerender(<ChatProvider><ChatProbe /></ChatProvider>)
  await screen.findByText('room')
  await act(async () => { await Promise.resolve() })
  act(() => publishBrowserChatAlertPreference({ userId: 'alice', enabled: true }))
  await pollWhileUnfocused()
  expect(browserNotification).not.toHaveBeenCalled()
  expect(mockAddNotification).not.toHaveBeenCalled()

  setViewer(null)
  view.rerender(<ChatProvider><ChatProbe /></ChatProvider>)
  expect(screen.getByText('none')).toBeInTheDocument()
})

it('aborts and ignores a late Alice profile after switching to Bob', async () => {
  let finishAlice!: (value: Response) => void
  const aliceProfile = new Promise<Response>(resolve => { finishAlice = resolve })
  let aliceSignal: AbortSignal | undefined
  let next = 0
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/user/profile' && jest.mocked(useSession)().data?.user?.id === 'alice') {
      aliceSignal = init?.signal as AbortSignal
      return aliceProfile
    }
    if (url === '/api/user/profile') return Promise.resolve(response({ id: 'bob', userSettings: { pushNotifications: false } }))
    if (url === '/api/chat/channels') return Promise.resolve(response([channel]))
    if (url.includes('latest=true')) return Promise.resolve(response({ items: [] }))
    if (url.includes('/api/chat/messages?') && url.includes('after=')) return Promise.resolve(response({ items: [message(String(++next))] }))
    throw new Error(`Unexpected fetch: ${url}`)
  })

  const view = render(<ChatProvider><ChatProbe /></ChatProvider>)
  await waitFor(() => expect(aliceSignal).toBeDefined())
  setViewer('bob')
  view.rerender(<ChatProvider><ChatProbe /></ChatProvider>)
  expect(aliceSignal?.aborted).toBe(true)
  await screen.findByText('room')
  await act(async () => { finishAlice(response({ id: 'alice', userSettings: { pushNotifications: true } })); await aliceProfile })
  await pollWhileUnfocused()
  expect(browserNotification).not.toHaveBeenCalled()
  expect(mockAddNotification).not.toHaveBeenCalled()
})

it.each(['bob', null])('closes every private desktop alert when Alice changes session to %s', async nextViewer => {
  let next = 0
  const view = await mountChat(() => true, () => message(String(++next)))
  await pollWhileUnfocused()
  await pollWhileUnfocused()
  expect([...activeDesktopAlerts]).toEqual([
    expect.stringContaining('New message 1'), expect.stringContaining('New message 2'),
  ])

  setViewer(nextViewer)
  view.rerender(<ChatProvider><ChatProbe /></ChatProvider>)
  expect(activeDesktopAlerts.size).toBe(0)
  for (const notification of browserNotification.mock.results) {
    expect(notification.value.close).toHaveBeenCalledTimes(1)
  }

  if (nextViewer) {
    await screen.findByText('room')
    await act(async () => { await Promise.resolve() })
    await pollWhileUnfocused()
    expect([...activeDesktopAlerts]).toEqual([expect.stringContaining('New message 3')])
  }
})

it('closes existing desktop alerts immediately when their owner opts out', async () => {
  let next = 0
  await mountChat(() => true, () => message(String(++next)))
  await pollWhileUnfocused()
  expect(activeDesktopAlerts.size).toBe(1)

  act(() => publishBrowserChatAlertPreference({ userId: 'bob', enabled: false }))
  expect(activeDesktopAlerts.size).toBe(1)
  act(() => publishBrowserChatAlertPreference({ userId: 'alice', enabled: false }))
  expect(activeDesktopAlerts.size).toBe(0)
  await pollWhileUnfocused()
  expect(browserNotification).toHaveBeenCalledTimes(1)
  expect(mockAddNotification).not.toHaveBeenCalled()
})

it('releases alerts on provider unmount and forgets already-closed handles', async () => {
  let next = 0
  const view = await mountChat(() => true, () => message(String(++next)))
  await pollWhileUnfocused()
  const first = browserNotification.mock.results[0].value
  act(() => first.close())
  await pollWhileUnfocused()
  const second = browserNotification.mock.results[1].value
  expect(activeDesktopAlerts.size).toBe(1)

  view.unmount()
  expect(activeDesktopAlerts.size).toBe(0)
  expect(first.close).toHaveBeenCalledTimes(1)
  expect(second.close).toHaveBeenCalledTimes(1)
})

it('keeps alerts across a same-account session refresh', async () => {
  let next = 0
  const view = await mountChat(() => true, () => message(String(++next)))
  await pollWhileUnfocused()

  setViewer('alice')
  view.rerender(<ChatProvider><ChatProbe /></ChatProvider>)
  expect(activeDesktopAlerts.size).toBe(1)
  expect(browserNotification.mock.results[0].value.close).not.toHaveBeenCalled()
})

it('does not reopen old alerts when a pre-switch poll finishes late', async () => {
  let next = 0
  const view = await mountChat(() => true, () => message(String(++next)))
  await pollWhileUnfocused()
  let finishPoll!: (value: Response) => void
  jest.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve }))
  const callback = intervalSpy.mock.calls.filter(([, delay]) => delay === 10000).at(-1)?.[0] as () => Promise<void>
  let pendingPoll!: Promise<void>
  act(() => { pendingPoll = callback() })

  setViewer('bob')
  view.rerender(<ChatProvider><ChatProbe /></ChatProvider>)
  expect(activeDesktopAlerts.size).toBe(0)
  await act(async () => { finishPoll(response({ items: [message('late-alice')] })); await pendingPoll })
  expect(activeDesktopAlerts.size).toBe(0)
  expect(browserNotification).toHaveBeenCalledTimes(1)
})
