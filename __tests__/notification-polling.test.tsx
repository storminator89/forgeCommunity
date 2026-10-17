import { act, render, screen, waitFor } from '@testing-library/react'
import { NotificationProvider, useNotifications } from '@/contexts/NotificationContext'
import { useSession } from '@/lib/sites-auth/react'

jest.mock('next-auth/react', () => ({ useSession: jest.fn() }))

function Consumer() {
  const { notifications, unreadCount, loadError } = useNotifications()
  return <>
    <div data-testid="items">{notifications.map(item => item.content).join(',')}</div>
    <div data-testid="unread-items">{notifications.filter(item => !item.isRead).map(item => item.content).join(',')}</div>
    <div data-testid="count">{unreadCount}</div>
    <div data-testid="error">{loadError}</div>
  </>
}

function response(items: Array<{ id: string; content: string; isRead: boolean }>, unreadCount: number, nextCursor: string | null = null): Response {
  return { ok: true, json: async () => ({
    items: items.map(item => ({ ...item, createdAt: item.id === 'new' ? '2026-01-02T00:00:00Z' : '2026-01-01T00:00:00Z' })),
    nextCursor, unreadCount,
  }) } as Response
}

let visible = true
let online = true
let focused = true

function setUser(id: string | null) {
  jest.mocked(useSession).mockReturnValue({
    data: id ? { user: { id }, expires: '2099-01-01' } : null,
    status: id ? 'authenticated' : 'unauthenticated', update: jest.fn(),
  } as ReturnType<typeof useSession>)
}

beforeEach(() => {
  jest.useFakeTimers()
  jest.mocked(fetch).mockReset()
  setUser('alice')
  visible = true
  online = true
  focused = true
  jest.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  jest.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible ? 'visible' : 'hidden')
  jest.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function advance(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); await Promise.resolve() })
}

it('finds a notification created after first load, with one latest-page request per interval', async () => {
  jest.mocked(fetch)
    .mockResolvedValueOnce(response([{ id: 'old', content: 'Old', isRead: true }], 0))
    .mockResolvedValueOnce(response([
      { id: 'new', content: 'New', isRead: false },
      { id: 'old', content: 'Old', isRead: true },
    ], 1))
  render(<NotificationProvider><Consumer /></NotificationProvider>)
  await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('Old'))
  expect(fetch).toHaveBeenCalledTimes(1)
  await advance(29_999)
  expect(fetch).toHaveBeenCalledTimes(1)
  await advance(1)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(screen.getByTestId('items')).toHaveTextContent('New,Old')
  expect(screen.getByTestId('count')).toHaveTextContent('1')
})

it('reconciles older pages when the server total reveals a newly unread older item', async () => {
  jest.mocked(fetch)
    .mockResolvedValueOnce(response([{ id: 'head', content: 'Head', isRead: true }], 0, 'head'))
    .mockResolvedValueOnce(response([{ id: 'older', content: 'Older', isRead: true }], 0))
    .mockResolvedValueOnce(response([{ id: 'head', content: 'Head', isRead: true }], 1, 'head'))
    .mockResolvedValueOnce(response([{ id: 'older', content: 'Older', isRead: false }], 1))
  render(<NotificationProvider><Consumer /></NotificationProvider>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(screen.getByTestId('count')).toHaveTextContent('0')
  expect(screen.getByTestId('unread-items')).toBeEmptyDOMElement()
  await advance(30_000)
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(screen.getByTestId('count')).toHaveTextContent('1')
  expect(screen.getByTestId('unread-items')).toHaveTextContent('Older')
})

it('pauses offline and hidden, then recovers from a fetch error with bounded backoff', async () => {
  jest.mocked(fetch)
    .mockResolvedValueOnce(response([], 0))
    .mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(response([{ id: 'new', content: 'Recovered', isRead: false }], 1))
    .mockResolvedValueOnce(response([{ id: 'new', content: 'Recovered', isRead: false }], 1))
    .mockResolvedValueOnce(response([{ id: 'new', content: 'Recovered', isRead: false }], 1))
  render(<NotificationProvider><Consumer /></NotificationProvider>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  await act(async () => { online = false; window.dispatchEvent(new Event('offline')) })
  await advance(60_000)
  expect(fetch).toHaveBeenCalledTimes(1)

  await act(async () => { online = true; window.dispatchEvent(new Event('online')) })
  await advance(0)
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(screen.getByTestId('error')).toHaveTextContent('konnten nicht aktualisiert')
  await advance(4_999)
  expect(fetch).toHaveBeenCalledTimes(2)
  await advance(1)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(screen.getByTestId('count')).toHaveTextContent('1')
  expect(screen.getByTestId('error')).toBeEmptyDOMElement()

  await act(async () => { visible = false; document.dispatchEvent(new Event('visibilitychange')) })
  await advance(60_000)
  expect(fetch).toHaveBeenCalledTimes(3)
  await act(async () => { visible = true; document.dispatchEvent(new Event('visibilitychange')) })
  await advance(0)
  expect(fetch).toHaveBeenCalledTimes(4)

  await act(async () => { focused = false; window.dispatchEvent(new Event('blur')) })
  await advance(60_000)
  expect(fetch).toHaveBeenCalledTimes(4)
  await act(async () => { focused = true; window.dispatchEvent(new Event('focus')) })
  await advance(0)
  expect(fetch).toHaveBeenCalledTimes(5)
})

it('does not overlap polls while a response is pending, even after repeated focus events', async () => {
  let finish!: (value: Response) => void
  jest.mocked(fetch)
    .mockResolvedValueOnce(response([], 0))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    .mockResolvedValueOnce(response([{ id: 'new', content: 'After pending', isRead: false }], 1))
  render(<NotificationProvider><Consumer /></NotificationProvider>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  await advance(30_000)
  expect(fetch).toHaveBeenCalledTimes(2)
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))
  })
  await advance(1_000)
  expect(fetch).toHaveBeenCalledTimes(2)
  await act(async () => { finish(response([], 0)) })
  await advance(999)
  expect(fetch).toHaveBeenCalledTimes(2)
  await advance(1)
  expect(fetch).toHaveBeenCalledTimes(3)
  expect(screen.getByTestId('items')).toHaveTextContent('After pending')
})

it('cleans up timers and private data on account switch and logout', async () => {
  jest.mocked(fetch)
    .mockResolvedValueOnce(response([{ id: 'alice', content: 'Alice private', isRead: false }], 1))
    .mockResolvedValueOnce(response([{ id: 'bob', content: 'Bob private', isRead: true }], 0))
  const view = render(<NotificationProvider><Consumer /></NotificationProvider>)
  await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('Alice private'))
  expect(fetch).toHaveBeenCalledTimes(1)

  setUser('bob')
  view.rerender(<NotificationProvider><Consumer /></NotificationProvider>)
  expect(screen.getByTestId('items')).not.toHaveTextContent('Alice private')
  await waitFor(() => expect(screen.getByTestId('items')).toHaveTextContent('Bob private'))
  expect(fetch).toHaveBeenCalledTimes(2)

  setUser(null)
  view.rerender(<NotificationProvider><Consumer /></NotificationProvider>)
  expect(screen.getByTestId('items')).toBeEmptyDOMElement()
  expect(screen.getByTestId('count')).toHaveTextContent('0')
  await advance(120_000)
  expect(fetch).toHaveBeenCalledTimes(2)
})
