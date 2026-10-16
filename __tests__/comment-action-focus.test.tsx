import '@testing-library/jest-dom'
import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommentSection } from '@/components/community/CommentSection'

jest.mock('framer-motion', () => jest.requireActual('@/lib/motion'))
jest.mock('@/components/community/ReportControl', () => ({ ReportControl: () => null }))

const peer = { id: 'peer', authorId: 'peer-user', author: { name: 'Bea', image: null }, content: 'Ein nächster Schritt.', createdAt: '2026-10-10T10:00:00Z', votes: 0, isLiked: false }
type Request = { kind: string; args: string[]; resolve: () => void; reject: (error: Error) => void }
let requests: Request[]

function Harness({ postId = 'post', account = 'account', visible = true, showPeer = true, busy = false }: {
  postId?: string; account?: string; visible?: boolean; showPeer?: boolean; busy?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [liked, setLiked] = useState(false)
  async function request(kind: string, args: string[]) {
    setPending(true)
    try { await new Promise<void>((resolve, reject) => requests.push({ kind, args, resolve, reject })) }
    finally { setPending(false) }
  }
  return <>
    {visible && <CommentSection postId={postId} currentUserId={account} canReport={false}
      comments={showPeer ? [{ ...peer, isLiked: liked, votes: liked ? 1 : 0 }] : []} isLoading={pending || busy}
      onAddComment={(...args) => request('comment', args)}
      onLikeComment={async (...args) => {
        // The real Community handler reports failure and resolves its callback.
        try { await request('like', args); setLiked(value => !value) } catch { /* reported by owner */ }
      }} />}
    <button>Andere Aktion</button><p data-testid="outside">Außerhalb</p>
  </>
}

function pendingBlur() {
  // JSDOM retains disabled-control focus. Model Chromium's native pending
  // blur, without making production code depend on this simulation.
  document.body.setAttribute('tabindex', '-1')
  document.body.focus()
  document.body.removeAttribute('tabindex')
  expect(document.activeElement).toBe(document.body)
}
async function finish(fail = false) {
  const request = requests[requests.length - 1]
  await act(async () => { if (fail) request.reject(new Error('Synthetic failure')); else request.resolve() })
}
async function start(kind: 'comment' | 'like', pointer = false) {
  if (kind === 'like') {
    const like = screen.getByRole('button', { name: /Kommentar liken|Kommentar-Like entfernen/ })
    if (pointer) await userEvent.click(like)
    else { like.focus(); await userEvent.keyboard('{Enter}') }
    return like
  }
  const input = screen.getByRole('textbox', { name: 'Kommentar schreiben' })
  await userEvent.type(input, `Kommentar ${requests.length + 1}`)
  if (pointer) await userEvent.click(screen.getByRole('button', { name: 'Kommentar senden' }))
  else await userEvent.keyboard('{Enter}')
  return input
}

beforeEach(() => { requests = []; jest.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => jest.restoreAllMocks())

test.each(['comment', 'like'] as const)('repeated %s success/failure restores the concrete control and permits the immediate next action', async kind => {
  render(<Harness />)
  for (const [index, fail] of [false, true, false, true].entries()) {
    const target = await start(kind, index % 2 === 1)
    expect(target).toBeDisabled()
    expect(requests).toHaveLength(index + 1)
    // Native disabled controls cannot issue an accidental repeated request.
    screen.getByRole('button', { name: kind === 'comment' ? 'Kommentar senden' : /Kommentar liken|Kommentar-Like entfernen/ }).click()
    expect(requests).toHaveLength(index + 1)
    pendingBlur()
    await finish(fail)
    expect(target).toBeEnabled()
    expect(target).toHaveFocus()
    if (kind === 'comment') expect(target).toHaveValue(fail ? `Kommentar ${index + 1}` : '')
    if (kind === 'comment' && fail) await userEvent.clear(target)
  }
  expect(requests.map(request => request.kind)).toEqual([kind, kind, kind, kind])
  expect(requests[0].args).toEqual(kind === 'comment' ? ['post', 'Kommentar 1'] : ['peer', 'post'])
})

test.each(['comment', 'like'] as const)('does not call focus again when %s focus never left the control', async kind => {
  render(<Harness />)
  const target = await start(kind)
  const focus = jest.spyOn(target, 'focus')
  await finish()
  expect(target).toHaveFocus()
  expect(focus).not.toHaveBeenCalled()
})

test.each(['comment', 'like'] as const)('restores %s only after the owner has re-enabled its pending controls', async kind => {
  const view = render(<Harness />)
  const target = await start(kind)
  pendingBlur()
  view.rerender(<Harness busy />)
  await finish()
  expect(target).toBeDisabled()
  expect(document.activeElement).toBe(document.body)
  view.rerender(<Harness />)
  expect(target).toHaveFocus()
})

for (const kind of ['comment', 'like'] as const) {
  test.each(['focus', 'focus-then-body', 'pointer', 'tab', 'window-blur'])(`${kind} never steals focus after %s during a slow response`, async movement => {
    render(<Harness />)
    const target = await start(kind)
    pendingBlur()
    const outside = screen.getByRole('button', { name: 'Andere Aktion' })
    if (movement.startsWith('focus')) outside.focus()
    if (movement === 'focus-then-body') pendingBlur()
    if (movement === 'pointer') fireEvent.pointerDown(screen.getByTestId('outside'))
    if (movement === 'tab') fireEvent.keyDown(document.body, { key: 'Tab' })
    if (movement === 'window-blur') fireEvent(window, new Event('blur'))
    const focus = jest.spyOn(target, 'focus')
    await finish()
    expect(target).toBeEnabled()
    expect(focus).not.toHaveBeenCalled()
    expect(movement === 'focus' ? outside : document.body).toHaveFocus()
    expect(requests).toHaveLength(1)
  })
}

test.each(['account', 'post', 'unmount', 'missing-like', 'replacement-like'] as const)('discards a stale action on %s without focusing its old or replacement target', async change => {
  const view = render(<Harness />)
  const target = await start(change.endsWith('like') ? 'like' : 'comment')
  pendingBlur()
  const focus = jest.spyOn(target, 'focus')
  if (change === 'unmount') view.rerender(<Harness visible={false} />)
  if (change === 'account') view.rerender(<Harness account="replacement-account" />)
  if (change === 'post') view.rerender(<Harness postId="replacement-post" />)
  if (change === 'missing-like') view.rerender(<Harness showPeer={false} />)
  if (change === 'replacement-like') {
    view.rerender(<Harness showPeer={false} />)
    expect(target).not.toBeInTheDocument()
    view.rerender(<Harness />)
  }
  await finish()
  expect(focus).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(document.body)
  expect(requests).toHaveLength(1)
})

test('unmount removes navigation listeners before a late action settles', async () => {
  const view = render(<Harness />)
  const target = await start('comment')
  pendingBlur()
  const focus = jest.spyOn(target, 'focus')
  view.unmount()
  fireEvent.pointerDown(document.body)
  await finish()
  expect(focus).not.toHaveBeenCalled()
})

test('unrelated loading and a callback without a disabled pending phase never invent restoration', async () => {
  const view = render(<Harness busy />)
  pendingBlur()
  view.rerender(<Harness />)
  expect(document.activeElement).toBe(document.body)
  view.unmount()
  let resolve!: () => void
  render(<CommentSection postId="post" comments={[]} onAddComment={() => new Promise<void>(done => { resolve = done })} />)
  const input = screen.getByRole('textbox', { name: 'Kommentar schreiben' })
  await userEvent.type(input, 'Ohne Pending{Enter}')
  pendingBlur()
  const focus = jest.spyOn(input, 'focus')
  await act(async () => resolve())
  expect(focus).not.toHaveBeenCalled()
})
