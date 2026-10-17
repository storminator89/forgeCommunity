import { installReaderLayoutGuard, restoreReaderTextSize, type ReaderLayoutWindow } from '../e2e/reader-layout-readiness'

let frames: Map<number, FrameRequestCallback>
let frameId: number
let headerHeight: number
let noticeHeight: number
let target: HTMLButtonElement
let main: HTMLElement
let outline: HTMLElement

function setFonts({ status = 'loaded', primary = 'loaded', fallback = 'loaded', check = () => true }: {
  status?: string; primary?: string | null; fallback?: string; check?: (font: string, text?: string) => boolean
} = {}) {
  const faces = [...primary ? [{ family: 'Inter', status: primary }] : [], { family: '"Inter Fallback"', status: fallback }]
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status, check,
    forEach: (callback: (face: unknown) => void) => faces.forEach(callback) } })
}

function flushFrame() {
  const pending = [...frames.values()]
  frames.clear()
  for (const callback of pending) callback(performance.now())
}

function setBox(element: Element, top: () => number, height: () => number, scrollHeight: number) {
  Object.defineProperty(element, 'getBoundingClientRect', { value: () => ({ top: top(), bottom: top() + height(), left: 0, right: 320, width: 320, height: height() }) })
  for (const [key, value] of Object.entries({ scrollWidth: 320, clientWidth: 320, scrollHeight })) Object.defineProperty(element, key, { configurable: true, value })
  Object.defineProperty(element, 'clientHeight', { configurable: true, get: height })
}

beforeEach(() => {
  frames = new Map(); frameId = 0; headerHeight = 100; noticeHeight = 0
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++frameId, callback); return frameId })
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  setFonts()
  global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
  document.body.innerHTML = '<header class="app-header"></header><main id="page-content" aria-busy="false"><div id="course-contents-navigation"><button disabled>Zertifikat herunterladen</button></div><section aria-label="Ausgewählter Kursinhalt"><button id="target">Aktualisieren</button></section></main>'
  main = document.querySelector('main')!; outline = document.querySelector('#course-contents-navigation')!; target = document.querySelector('#target')!
  target.style.fontFamily = 'Inter, "Inter Fallback"'; target.style.fontSize = '16px'; target.style.fontWeight = '500'
  setBox(document.querySelector('header')!, () => 0, () => headerHeight, 100)
  setBox(main, () => headerHeight + noticeHeight, () => 700 - headerHeight - noticeHeight, 1200)
  setBox(outline, () => headerHeight + noticeHeight - main.scrollTop, () => 300, 500)
  setBox(outline.querySelector('button')!, () => headerHeight + noticeHeight + 180 - main.scrollTop - outline.scrollTop, () => 88, 88)
  setBox(document.querySelector('section')!, () => headerHeight + noticeHeight + 300 - main.scrollTop, () => 900, 900)
  setBox(target, () => headerHeight + noticeHeight + 600 - main.scrollTop, () => 88, 88)
})

afterEach(() => {
  ;(window as ReaderLayoutWindow).__readerLayoutGuard?.finish()
  jest.restoreAllMocks()
  jest.useRealTimers()
  document.body.innerHTML = ''
})

async function readyGuard() {
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const settled = guard.settle()
  flushFrame(); flushFrame(); flushFrame()
  await settled
  guard.arm()
  return guard
}

it('normalizes native main and nested outline scrolling without calling it layout drift', async () => {
  const guard = await readyGuard()
  target.focus(); main.scrollTop = 400; outline.scrollTop = 30
  flushFrame()
  expect(guard.check()).toEqual({ unsafe: false, changes: 0 })
})

it('retains an unexpected post-input Header reflow even if the layout later returns', async () => {
  const guard = await readyGuard()
  target.focus(); main.scrollTop = 400
  headerHeight += 116; flushFrame()
  expect(guard.check().unsafe).toBe(true)
  headerHeight -= 116; flushFrame()
  expect(guard.check().unsafe).toBe(true)
  expect(guard.finish()).toMatchObject({ unsafe: true, changes: [{ classification: 'unexpected-post-input-layout-drift' }] })
})

it('allows only the exact known notice-only removal while focus remains fully visible', async () => {
  noticeHeight = 40
  const notice = document.createElement('div')
  notice.setAttribute('role', 'status'); notice.textContent = 'Inhalt als abgeschlossen markiert.'
  main.before(notice)
  setBox(notice, () => headerHeight, () => noticeHeight, 40)
  const guard = await readyGuard()
  target.focus(); main.scrollTop = 400
  notice.remove(); noticeHeight = 0; flushFrame()
  expect(guard.check()).toEqual({ unsafe: false, changes: 1 })
  expect(guard.finish()).toMatchObject({ changes: [{ classification: 'known-safe-notice-removal' }] })
})

it('fails bounded readiness instead of sleeping or focusing a disabled target', async () => {
  target.disabled = true
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) flushFrame()
  await failure
  expect(document.activeElement).not.toBe(target)
})

it.each(['header', 'font', 'not-visible'] as const)('does not exempt notice removal accompanied by %s drift', async kind => {
  noticeHeight = 40
  const notice = document.createElement('div')
  notice.setAttribute('role', 'status'); notice.textContent = 'Inhalt als abgeschlossen markiert.'
  main.before(notice); setBox(notice, () => headerHeight, () => noticeHeight, 40)
  const guard = await readyGuard()
  target.focus(); main.scrollTop = kind === 'not-visible' ? 0 : 400
  notice.remove(); noticeHeight = 0
  if (kind === 'header') headerHeight += 116
  if (kind === 'font') setFonts({ status: 'loading', primary: 'unloaded', check: () => false })
  flushFrame()
  expect(guard.check().unsafe).toBe(true)
})

it('includes drift first observed by finish in its retained final verdict', async () => {
  const guard = await readyGuard()
  expect(guard.check().unsafe).toBe(false)
  headerHeight += 116
  expect(guard.finish()).toMatchObject({ unsafe: true, changes: [{ classification: 'unexpected-post-input-layout-drift' }] })
})

it('permits a ready declared primary while preserving the unloaded unused fallback as evidence', async () => {
  setFonts({ fallback: 'unloaded', check: font => !font.includes(',') && !font.includes('Inter Fallback') })
  const guard = await readyGuard()
  expect(guard.finish()).toMatchObject({ limits: { stableFrames: 3, frames: 120, timeoutMs: 5000 }, unsafe: false,
    stable: { fontReady: true, fontStackReady: false, fontPrimary: 'inter' },
    settleEvidence: { outcome: 'stable', frames: 3, readyFrames: 3,
      first: { fonts: { checks: { stackDefaultSpace: { ready: false }, inter: { defaultSpace: { ready: true }, refreshLabel: { ready: true } }, interFallback: { defaultSpace: { ready: false } } },
        familyFaces: { inter: { loaded: 1 }, interFallback: { unloaded: 1 } } } } } })
})

it('retains stable-geometry, unavailable-primary failure separately from geometry drift', async () => {
  setFonts({ primary: 'unloaded', check: () => false })
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) flushFrame()
  await failure
  expect(guard.finish()).toMatchObject({ stable: null, sampledFrames: 0, unsafe: false,
    settleEvidence: { outcome: 'frame-budget', frames: 120, readyFrames: 0, maxConsecutive: 0, comparisons: 119,
      falseFlags: { fontReadyFalse: 120, fontStatusNotLoaded: 0, mainBusyNotFalse: 0 },
      geometryChanges: 0, readinessChanges: 0, changedFields: {}, transitions: [],
      first: { state: { fontStatus: 'loaded', fontReady: false, fontPrimaryLoaded: false }, fonts: { familyFaces: { inter: { unloaded: 1 } } } },
      last: { state: { fontStatus: 'loaded', fontReady: false, fontPrimaryLoaded: false } } } })
})

it('retains changing-geometry frame failure with first/final reasons under the same budget', async () => {
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) { headerHeight++; flushFrame() }
  await failure
  const result = guard.finish() as { settleEvidence: { transitions: Array<{ frame: number; fields: string[] }> } }
  expect(result).toMatchObject({ stable: null, unsafe: false, settleEvidence: {
    outcome: 'frame-budget', frames: 120, readyFrames: 120, maxConsecutive: 1, geometryChanges: 119, readinessChanges: 0,
    falseFlags: { disconnected: 0, disabled: 0, mainBusyNotFalse: 0, fontStatusNotLoaded: 0, fontReadyFalse: 0 },
    changedFields: { 'boxes.header.rect.height': 119 }, omittedTransitions: 111,
    first: { state: { boxes: { header: { rect: { height: 101 } } } } }, last: { state: { boxes: { header: { rect: { height: 220 } } } } },
  } })
  expect(result.settleEvidence.transitions).toHaveLength(8)
  expect(result.settleEvidence.transitions[0]).toMatchObject({ frame: 2, fields: expect.arrayContaining(['boxes.header.rect.height']) })
  expect(result.settleEvidence.transitions.at(-1)).toMatchObject({ frame: 120 })
})

it('retains the bounded deadline reason and last sampled readiness flags', async () => {
  jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  target.disabled = true
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('bounded deadline')
  flushFrame(); jest.advanceTimersByTime(5000)
  await failure
  expect(guard.finish()).toMatchObject({ settleEvidence: { outcome: 'deadline', frames: 1,
    falseFlags: { disabled: 1 }, first: { state: { disabled: true } }, last: { state: { disabled: true } } } })
})

it.each(['Arial', '"Inter Fallback", Inter', 'Inter, Arial'])('fails closed for an unrecognized primary stack %s', async family => {
  target.style.fontFamily = family
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) flushFrame()
  await failure
  expect(guard.finish()).toMatchObject({ settleEvidence: { falseFlags: { fontReadyFalse: 120 }, last: { state: { fontPrimary: 'unknown' } } } })
})

it('does not accept the FontFaceSet empty-match success without a registered loaded primary', async () => {
  setFonts({ primary: null, check: () => true })
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) flushFrame()
  await failure
  expect(guard.finish()).toMatchObject({ settleEvidence: { last: { state: { fontPrimaryCheck: true, fontPrimaryLoaded: false, fontReady: false } } } })
})

it('blocks a failed primary-label check even when an Inter face is registered and loaded', async () => {
  const check = jest.fn().mockReturnValue(false)
  setFonts({ check })
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) flushFrame()
  await failure
  expect(check).toHaveBeenCalledWith('500 16px "Inter"', 'Aktualisieren')
  expect(guard.finish()).toMatchObject({ settleEvidence: { last: { state: { fontPrimaryCheck: false, fontPrimaryLoaded: true, fontReady: false } } } })
})

it('keeps a full-stack-only check exception diagnostic when the declared primary is ready', async () => {
  setFonts({ check: font => { if (font.includes(',')) throw new DOMException('invalid descriptor', 'SyntaxError'); return true } })
  const guard = await readyGuard()
  expect(guard.finish()).toMatchObject({ unsafe: false, stable: { fontReady: true, fontStackReady: false, fontStackCheckError: true },
    settleEvidence: { outcome: 'stable', first: { fonts: { checks: { stackDefaultSpace: { ready: false, error: true } } } } } })
})

it('retains a primary check exception as a bounded, fail-closed readiness failure', async () => {
  setFonts({ check: () => { throw new DOMException('invalid descriptor', 'SyntaxError') } })
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) flushFrame()
  await failure
  expect(guard.finish()).toMatchObject({ settleEvidence: { outcome: 'frame-budget', falseFlags: { fontReadyFalse: 120 },
    last: { state: { fontPrimaryCheck: false, fontPrimaryCheckError: true, fontStackCheckError: true },
      fonts: { checks: { inter: { refreshLabel: { ready: false, error: true } } } } } } })
})

it('retains a detached target as disconnected rather than losing the failed-settle summary', async () => {
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  target.remove()
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) flushFrame()
  await failure
  expect(guard.finish()).toMatchObject({ settleEvidence: { outcome: 'frame-budget', falseFlags: { disconnected: 120 },
    first: { state: { connected: false } }, last: { state: { connected: false } } } })
})

it('keeps active font loading blocked even when the declared primary check succeeds', async () => {
  setFonts({ status: 'loading' })
  installReaderLayoutGuard(target)
  const guard = (window as ReaderLayoutWindow).__readerLayoutGuard!
  const failure = expect(guard.settle()).rejects.toThrow('frame budget')
  for (let frame = 0; frame < 120; frame++) flushFrame()
  await failure
  expect(guard.finish()).toMatchObject({ settleEvidence: { falseFlags: { fontStatusNotLoaded: 120, fontReadyFalse: 0 } } })
})

it('retains a changed declared primary as unsafe after input', async () => {
  const guard = await readyGuard()
  target.style.fontFamily = 'Arial'
  expect(guard.check().unsafe).toBe(true)
  expect(guard.finish()).toMatchObject({ changes: [{ before: { fontPrimary: 'inter' }, after: { fontPrimary: 'unknown', fontReady: false } }] })
})

it('keeps the original error object when a failed flow also fails its text-size reset', async () => {
  const original = new Error('original assertion'), cleanup = new Error('context destroyed')
  const record = jest.fn()
  const run = async () => {
    let originalFailed = false
    try { throw original }
    catch (error) { originalFailed = true; throw error }
    finally { await restoreReaderTextSize(async () => { throw cleanup }, originalFailed, record) }
  }
  await expect(run()).rejects.toBe(original)
  expect(record).toHaveBeenCalledTimes(1)
  expect(record).toHaveBeenCalledWith()
})

it('still fails a previously successful flow when its text-size reset fails', async () => {
  const cleanup = new Error('context destroyed'), record = jest.fn()
  await expect(restoreReaderTextSize(async () => { throw cleanup }, false, record)).rejects.toBe(cleanup)
  expect(record).not.toHaveBeenCalled()
})

it('does not emit a cleanup failure marker when restoring succeeds', async () => {
  const restore = jest.fn().mockResolvedValue(undefined), record = jest.fn()
  await restoreReaderTextSize(restore, false, record)
  expect(restore).toHaveBeenCalledTimes(1)
  expect(record).not.toHaveBeenCalled()
})
