import { installReaderLayoutGuard, type ReaderLayoutWindow } from '../e2e/reader-layout-readiness'

let frames: Map<number, FrameRequestCallback>
let frameId: number
let headerHeight: number
let noticeHeight: number
let target: HTMLButtonElement
let main: HTMLElement
let outline: HTMLElement

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
  Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loaded', check: () => true } })
  global.ResizeObserver = class { observe() {} disconnect() {} unobserve() {} }
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
  document.body.innerHTML = '<header class="app-header"></header><main id="page-content" aria-busy="false"><div id="course-contents-navigation"><button disabled>Zertifikat herunterladen</button></div><section aria-label="Ausgewählter Kursinhalt"><button id="target">Aktualisieren</button></section></main>'
  main = document.querySelector('main')!; outline = document.querySelector('#course-contents-navigation')!; target = document.querySelector('#target')!
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
  if (kind === 'font') Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', check: () => false } })
  flushFrame()
  expect(guard.check().unsafe).toBe(true)
})

it('includes drift first observed by finish in its retained final verdict', async () => {
  const guard = await readyGuard()
  expect(guard.check().unsafe).toBe(false)
  headerHeight += 116
  expect(guard.finish()).toMatchObject({ unsafe: true, changes: [{ classification: 'unexpected-post-input-layout-drift' }] })
})
