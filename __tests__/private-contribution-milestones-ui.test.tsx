import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ContributionMilestonesCard } from '@/components/community/ContributionMilestonesCard'
import { usePrivateContributions } from '@/hooks/usePrivateContributions'
import { isContributionSummary, type ContributionSummary } from '@/lib/contributions'

const summary = (selectedByAuthors: number, eligible = true): ContributionSummary => ({ eligible, selectedByAuthors, saturated: selectedByAuthors === 5 })
function Harness({ userId }: { userId?: string }) {
  const state = usePrivateContributions(userId)
  return <ContributionMilestonesCard {...state} isSignedIn={!!userId} onRefresh={state.refresh} />
}
const response = (data: unknown, ok = true) => ({ ok, json: async () => data })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue(response(summary(0)))
})

test.each([[0, 1], [1, 3], [2, 3], [3, 5], [4, 5]])('current count %i shows honest next threshold %i with native accessible progress', (count, target) => {
  render(<ContributionMilestonesCard summary={summary(count)} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />)
  const card = screen.getByRole('region', { name: 'Meine Diskussionsmeilensteine' })
  const progress = within(card).getByRole('progressbar', { name: `Diskussionsmeilenstein: ${count} von ${target} unterschiedlichen Diskussionsautoren` })
  expect(progress.tagName).toBe('PROGRESS')
  expect(progress).toHaveAttribute('max', String(target))
  expect(progress).toHaveAttribute('value', String(count))
  expect(within(card).getByRole('list', { name: 'Aktuelle Diskussionsmeilensteine' })).toBeInTheDocument()
  expect(within(card).getAllByRole('listitem')).toHaveLength(3)
  expect(card).toHaveTextContent('Nur für dich sichtbar')
  expect(card).toHaveTextContent('keine unabhängige Prüfung')
  expect(card).toHaveTextContent('Sie vergibt keine Punkte')
  expect(card).toHaveTextContent('Der Stand kann sinken')
  expect(card.querySelector('[style*="animation"], [style*="transform"]')).toBeNull()
})

test('saturation is explicitly 5+, never an exact uncapped score or invitation to farm', () => {
  render(<ContributionMilestonesCard summary={summary(5)} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />)
  expect(screen.getByText('Aktuell von 5+ Diskussionsautoren ausgewählt')).toBeInTheDocument()
  expect(screen.getAllByText('Aktuell erreicht')).toHaveLength(3)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.getByText(/Die Anzeige endet bei 5\+/)).toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})

test('ineligible accounts do not show false zero progress, while sign-out hides prior private data', () => {
  const view = render(<ContributionMilestonesCard summary={summary(0, false)} loading={false} error={false} isSignedIn onRefresh={jest.fn()} />)
  expect(screen.getByText(/Für dieses Konto werden derzeit keine Diskussionsmeilensteine angezeigt/)).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  view.rerender(<ContributionMilestonesCard summary={summary(5)} loading={false} error={false} isSignedIn={false} onRefresh={jest.fn()} />)
  expect(screen.getByText(/Melde dich an/)).toBeInTheDocument()
  expect(screen.queryByText(/Aktuell von/)).not.toBeInTheDocument()
})

test('loading and server errors are separate from zero progress; keyboard retry recovers with no cache', async () => {
  const pending = deferred<ReturnType<typeof response>>()
  global.fetch = jest.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response(summary(1)))
  const user = userEvent.setup()
  render(<Harness userId="alice" />)
  expect(screen.getByRole('status')).toHaveTextContent('Diskussionsmeilensteine werden geladen')
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  await act(async () => pending.resolve(response({ error: 'Unavailable' }, false)))
  expect(await screen.findByRole('alert')).toHaveTextContent('Diskussionsmeilensteine konnten nicht geladen werden')
  expect(screen.queryByText(/Noch keine aktuelle Auswahl/)).not.toBeInTheDocument()
  const retry = screen.getByRole('button', { name: 'Diskussionsmeilensteine erneut laden' })
  retry.focus(); await user.keyboard('{Enter}')
  expect(await screen.findByText('Aktuell von 1 Diskussionsautor ausgewählt')).toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith('/api/contributions/me', expect.objectContaining({ signal: expect.any(AbortSignal), cache: 'no-store' }))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('switching accounts immediately hides old results, aborts old reads and ignores a late old-account response', async () => {
  const oldRead = deferred<ReturnType<typeof response>>()
  const secondRead = deferred<ReturnType<typeof response>>()
  global.fetch = jest.fn().mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(secondRead.promise)
  const view = render(<Harness userId="alice" />)
  const aliceSignal = (global.fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal
  view.rerender(<Harness userId="bob" />)
  expect(aliceSignal.aborted).toBe(true)
  expect(screen.getByRole('status')).toBeInTheDocument()
  await act(async () => oldRead.resolve(response(summary(5))))
  expect(screen.queryByText(/Aktuell von 5\+/)).not.toBeInTheDocument()
  await act(async () => secondRead.resolve(response(summary(1))))
  expect(await screen.findByText('Aktuell von 1 Diskussionsautor ausgewählt')).toBeInTheDocument()
  view.rerender(<Harness />)
  expect(screen.queryByText(/Aktuell von/)).not.toBeInTheDocument()
  expect(screen.getByText(/Melde dich an/)).toBeInTheDocument()
})

test('returning to the same account after logout clears its old data before a failed new read', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(response(summary(5))).mockResolvedValueOnce(response({ error: 'Unavailable' }, false))
  const view = render(<Harness userId="alice" />)
  expect(await screen.findByText('Aktuell von 5+ Diskussionsautoren ausgewählt')).toBeInTheDocument()
  view.rerender(<Harness />)
  view.rerender(<Harness userId="alice" />)
  expect(screen.queryByText(/Aktuell von 5\+/)).not.toBeInTheDocument()
  expect(await screen.findByRole('alert')).toBeInTheDocument()
})

test('focus and visible-page refresh current changes; overlapping reads abort and cannot overwrite newer state', async () => {
  const obsolete = deferred<ReturnType<typeof response>>()
  global.fetch = jest.fn().mockResolvedValueOnce(response(summary(3))).mockReturnValueOnce(obsolete.promise).mockResolvedValueOnce(response(summary(0))).mockResolvedValueOnce(response(summary(1)))
  render(<Harness userId="alice" />)
  expect(await screen.findByText('Aktuell von 3 Diskussionsautoren ausgewählt')).toBeInTheDocument()
  fireEvent(window, new Event('focus'))
  expect(screen.queryByText(/Aktuell von 3/)).not.toBeInTheDocument()
  const obsoleteSignal = (global.fetch as jest.Mock).mock.calls[1][1].signal as AbortSignal
  fireEvent(window, new Event('focus'))
  expect(obsoleteSignal.aborted).toBe(true)
  expect(await screen.findByText('Noch keine aktuelle Auswahl durch andere Diskussionsautoren.')).toBeInTheDocument()
  await act(async () => obsolete.resolve(response(summary(5))))
  expect(screen.queryByText(/Aktuell von 5\+/)).not.toBeInTheDocument()
  fireEvent(document, new Event('visibilitychange'))
  expect(await screen.findByText('Aktuell von 1 Diskussionsautor ausgewählt')).toBeInTheDocument()
})

test('unmount aborts requests and removes focus listeners', async () => {
  const pending = deferred<ReturnType<typeof response>>()
  global.fetch = jest.fn().mockReturnValueOnce(pending.promise)
  const view = render(<Harness userId="alice" />)
  const signal = (global.fetch as jest.Mock).mock.calls[0][1].signal as AbortSignal
  view.unmount()
  expect(signal.aborted).toBe(true)
  fireEvent(window, new Event('focus'))
  await act(async () => pending.resolve(response(summary(1))))
  expect(global.fetch).toHaveBeenCalledTimes(1)
})

test.each([{}, null, { eligible: true, selectedByAuthors: 6, saturated: true }, { eligible: true, selectedByAuthors: 5, saturated: false }, { eligible: false, selectedByAuthors: 1, saturated: false }])('malformed successful payload is a retryable error: %j', async data => {
  global.fetch = jest.fn().mockResolvedValue(response(data))
  render(<Harness userId="alice" />)
  expect(await screen.findByRole('alert')).toBeInTheDocument()
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

test('summary validation accepts only bounded internally consistent live state', () => {
  expect(isContributionSummary(summary(0))).toBe(true)
  expect(isContributionSummary(summary(5))).toBe(true)
  expect(isContributionSummary(summary(0, false))).toBe(true)
  expect(isContributionSummary({ eligible: true, selectedByAuthors: 1.5, saturated: false })).toBe(false)
})
