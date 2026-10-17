/** @jest-environment jsdom */
import { installThemeCaptureFocusEvidence, type ThemeCaptureFocusPhase, type ThemeCaptureFocusWindow } from '../e2e/theme-capture-focus-evidence'

const focusWindow = window as ThemeCaptureFocusWindow
const phases: readonly ThemeCaptureFocusPhase[] = [
  'before-menu-open', 'after-menu-select', 'after-menu-detach',
  'after-trigger-focus', 'after-native-tab', 'after-heading-focus',
]
let trigger: HTMLButtonElement

beforeEach(() => {
  document.body.innerHTML = '<button aria-haspopup="menu">Private theme account</button>'
  trigger = document.querySelector('button')!
})

afterEach(() => {
  focusWindow.__themeCaptureFocusEvidence?.finish()
  jest.restoreAllMocks()
  document.body.innerHTML = ''
})

function install() {
  installThemeCaptureFocusEvidence(trigger)
  return focusWindow.__themeCaptureFocusEvidence!
}

it('records only the fixed checkpoint phases, rounded times, and a final fixed phase', () => {
  jest.spyOn(performance, 'now').mockReturnValue(12.6)
  const recorder = install()
  const first = recorder.checkpoint(phases[0])
  for (const phase of phases.slice(1)) recorder.checkpoint(phase)
  const evidence = recorder.finish()
  expect(evidence.events.map(event => [event.type, event.phase, event.timeMs])).toEqual(
    [...phases, 'finish'].map(phase => ['checkpoint', phase, 13]),
  )
  expect(evidence).toMatchObject({ limit: 64, totalEvents: 7, omittedEvents: 0 })
  expect(evidence.events[0]).toMatchObject({ target: { kind: 'none', role: 'none', connected: false },
    active: { kind: 'body', role: 'none', connected: true } })
  expect(first.events).toHaveLength(1)
  expect(Object.isFrozen(recorder)).toBe(true)
  expect(Object.isFrozen(evidence)).toBe(true)
  expect(Object.isFrozen(evidence.events)).toBe(true)
  expect(Object.isFrozen(evidence.events[0])).toBe(true)
  expect(Object.isFrozen(evidence.events[0].active)).toBe(true)
})

it('counts all menu DOM nodes and closed/hidden states until actual detachment', () => {
  document.body.insertAdjacentHTML('beforeend', `
    <div role="menu" data-state="open">Secret open menu</div>
    <div role="menu" data-state="closed">Secret closed menu</div>
    <section hidden><div role="menu">Secret hidden menu</div></section>
    <section aria-hidden="true"><div role="menu">Secret aria-hidden menu</div></section>
    <section style="display:none"><div role="menu">Secret CSS-hidden menu</div></section>
  `)
  const recorder = install()
  expect(recorder.checkpoint('before-menu-open').events[0]).toMatchObject({ menuCount: 5, closedMenuCount: 4 })
  document.querySelector('[data-state="open"]')!.setAttribute('data-state', 'closed')
  expect(recorder.checkpoint('after-menu-select').events[1]).toMatchObject({ menuCount: 5, closedMenuCount: 5 })
  for (const menu of document.querySelectorAll('[role="menu"]')) menu.remove()
  expect(recorder.checkpoint('after-menu-detach').events[2]).toMatchObject({ menuCount: 0, closedMenuCount: 0 })
})

it('observes real focus transitions and retains the actual post-Tab checkpoint target bucket', () => {
  document.body.insertAdjacentHTML('beforeend', `
    <section aria-label="Ausgewählter Kursinhalt"><h2 tabindex="-1">Secret lesson title</h2></section>
    <div role="menu" tabindex="-1"><button role="menuitem">Secret theme option</button></div>
    <button>Zu dieser Lektion fragen</button><button aria-haspopup="menu">Secret account menu</button>
    <button>Secret ordinary button</button><a href="https://example.test/private-account">Secret link</a>
    <input aria-label="Secret email" value="secret-account@example.test" role="private-secret-role">
    <textarea aria-label="Secret reply"></textarea>
  `)
  const recorder = install()
  recorder.checkpoint('before-menu-open')
  trigger.focus()
  const heading = document.querySelector('h2')!
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!
  const menuItem = document.querySelector<HTMLButtonElement>('[role="menuitem"]')!
  menu.focus(); menuItem.focus()
  const buttons = document.querySelectorAll('button')
  buttons[2].focus(); buttons[3].focus(); buttons[4].focus()
  document.querySelector('a')!.focus()
  const input = document.querySelector('input')!
  input.focus()
  // The helper samples the actual active element. Native keyboard input belongs to Playwright.
  const afterTab = recorder.checkpoint('after-native-tab')
  expect(afterTab.events[afterTab.events.length - 1].active).toEqual({ kind: 'input', role: 'other', connected: true })
  heading.focus(); recorder.checkpoint('after-heading-focus')
  const evidence = recorder.finish()
  const focused = evidence.events.filter(event => event.type === 'focusin')
  expect(focused.map(event => event.target.kind)).toEqual([
    'theme-trigger', 'menu', 'menuitem', 'lesson-qa-control', 'other-menu-trigger', 'button', 'link', 'input', 'reader-heading',
  ])
  expect(focused.find(event => event.target.kind === 'menuitem')?.target.role).toBe('menuitem')
  expect(focused.every(event => event.target.connected && event.active.kind === event.target.kind)).toBe(true)
  expect(evidence.events.some(event => event.type === 'focusout' && event.target.kind === 'theme-trigger')).toBe(true)
  expect(focused.every(event => event.phase === 'before-menu-open' || event.phase === 'after-native-tab')).toBe(true)
})

it('never emits private DOM text, labels, IDs, titles, hrefs, values, or arbitrary roles', () => {
  const secrets = ['Private theme account', 'Learner Ada Secret', 'private-course-id', 'Secret lesson title',
    'secret-account@example.test', 'secret-private-role', 'secret-host.test', 'Secret button title', 'Secret menu option']
  document.body.insertAdjacentHTML('beforeend', `
    <section aria-label="Ausgewählter Kursinhalt" id="private-course-id"><h2 tabindex="-1">Secret lesson title</h2></section>
    <button aria-label="Learner Ada Secret" title="Secret button title">Learner Ada Secret</button>
    <input value="secret-account@example.test" role="secret-private-role">
    <a href="https://secret-host.test/private-course-id">Learner Ada Secret</a>
    <div role="menu"><button role="menuitemcheckbox">Secret menu option</button></div>
  `)
  const recorder = install()
  for (const element of document.querySelectorAll<HTMLElement>('button,h2,input,a')) element.focus()
  recorder.checkpoint('after-heading-focus')
  const evidence = recorder.finish()
  const serialized = JSON.stringify(evidence)
  for (const secret of secrets) expect(serialized).not.toContain(secret)
  expect(evidence.events.some(event => event.target.role === 'other')).toBe(true)
  expect(evidence.events.some(event => event.target.role === 'menuitemcheckbox')).toBe(true)
  expect(evidence.events.every(event => Object.keys(event).sort().join(',') ===
    'active,closedMenuCount,menuCount,phase,target,timeMs,type')).toBe(true)
})

it('bounds evidence to the first 63 records plus the last, with an omitted count', () => {
  let time = 0
  jest.spyOn(performance, 'now').mockImplementation(() => ++time + 0.1)
  const recorder = install()
  const first = recorder.checkpoint('before-menu-open')
  for (let index = 1; index < 70; index++) recorder.checkpoint(phases[index % phases.length])
  const evidence = recorder.finish()
  expect(evidence.events).toHaveLength(64)
  expect(evidence.events.slice(0, 63).map(event => event.timeMs)).toEqual(Array.from({ length: 63 }, (_, index) => index + 1))
  expect(evidence.events[63]).toMatchObject({ timeMs: 71, type: 'checkpoint', phase: 'finish' })
  expect(evidence).toMatchObject({ limit: 64, totalEvents: 71, omittedEvents: 7 })
  expect(first.events).toHaveLength(1)
  expect(first.totalEvents).toBe(1)
})

it('rejects unknown runtime phases without storing or exposing the supplied value', () => {
  const recorder = install()
  for (const phase of ['Private lesson phase', undefined, null, 123]) {
    expect(() => recorder.checkpoint(phase as ThemeCaptureFocusPhase)).toThrow('Unknown theme capture focus phase')
  }
  const evidence = recorder.finish()
  expect(evidence.totalEvents).toBe(1)
  expect(JSON.stringify(evidence)).not.toContain('Private lesson phase')
})

it('rejects a second installation while retaining the installed evidence', () => {
  const recorder = install()
  recorder.checkpoint('before-menu-open')
  expect(() => installThemeCaptureFocusEvidence(trigger)).toThrow('already installed')
  const secondTrigger = document.createElement('button')
  document.body.append(secondTrigger)
  expect(() => installThemeCaptureFocusEvidence(secondTrigger)).toThrow('already installed')
  expect(focusWindow.__themeCaptureFocusEvidence).toBe(recorder)
  expect(recorder.finish()).toMatchObject({ totalEvents: 2, omittedEvents: 0 })
})

it('finishes once, removes the exact listeners and global, and permits a fresh recorder', () => {
  const addListener = jest.spyOn(document, 'addEventListener')
  const removeListener = jest.spyOn(document, 'removeEventListener')
  const recorder = install()
  trigger.focus()
  const finished = recorder.finish()
  expect(focusWindow.__themeCaptureFocusEvidence).toBeUndefined()
  for (const type of ['focusin', 'focusout']) {
    const installed = addListener.mock.calls.find(call => call[0] === type)!
    expect(removeListener).toHaveBeenCalledWith(type, installed[1], true)
  }
  trigger.blur(); trigger.focus()
  expect(recorder.finish()).toBe(finished)
  expect(() => recorder.checkpoint('after-menu-detach')).toThrow('is finished')
  expect(finished.events[finished.events.length - 1].phase).toBe('finish')
  const next = install()
  expect(next).not.toBe(recorder)
  expect(next.checkpoint('before-menu-open').totalEvents).toBe(1)
})

it('does not call focus or blur, schedule frames, or mutate the DOM', () => {
  const focus = jest.spyOn(HTMLElement.prototype, 'focus')
  const blur = jest.spyOn(HTMLElement.prototype, 'blur')
  const frame = jest.spyOn(window, 'requestAnimationFrame')
  const markup = document.body.innerHTML
  const active = document.activeElement
  const recorder = install()
  for (const phase of phases) recorder.checkpoint(phase)
  recorder.finish()
  expect(focus).not.toHaveBeenCalled()
  expect(blur).not.toHaveBeenCalled()
  expect(frame).not.toHaveBeenCalled()
  expect(document.body.innerHTML).toBe(markup)
  expect(document.activeElement).toBe(active)
})
