export type ThemeCaptureFocusPhase =
  | 'before-menu-open'
  | 'after-menu-select'
  | 'after-menu-detach'
  | 'after-trigger-focus'
  | 'after-native-tab'
  | 'after-heading-focus'

type TargetKind = 'none' | 'theme-trigger' | 'reader-heading' | 'menu' | 'menuitem' |
  'lesson-qa-control' | 'other-menu-trigger' | 'button' | 'link' | 'input' | 'body' | 'other'
type TargetRole = 'none' | 'menu' | 'menuitem' | 'menuitemcheckbox' | 'menuitemradio' |
  'button' | 'link' | 'textbox' | 'heading' | 'other'
type TargetBucket = Readonly<{ kind: TargetKind; role: TargetRole; connected: boolean }>
type FocusRecord = Readonly<{
  timeMs: number
  type: 'focusin' | 'focusout' | 'checkpoint'
  phase: ThemeCaptureFocusPhase | 'finish'
  target: TargetBucket
  active: TargetBucket
  menuCount: number
  closedMenuCount: number
}>
export type ThemeCaptureFocusSnapshot = Readonly<{
  limit: 64
  totalEvents: number
  omittedEvents: number
  events: readonly FocusRecord[]
}>
export type ThemeCaptureFocusEvidence = Readonly<{
  checkpoint(phase: ThemeCaptureFocusPhase): ThemeCaptureFocusSnapshot
  finish(): ThemeCaptureFocusSnapshot
}>
export type ThemeCaptureFocusWindow = Window & {
  __themeCaptureFocusEvidence?: ThemeCaptureFocusEvidence
}

/** Serialized into the browser: passive, bounded, and limited to fixed public buckets. */
export function installThemeCaptureFocusEvidence(trigger: Element): void {
  const doc = trigger.ownerDocument
  const view = doc.defaultView as ThemeCaptureFocusWindow | null
  if (!view) throw new Error('Theme capture focus evidence requires a browser window')
  if ('__themeCaptureFocusEvidence' in view) {
    throw new Error('Theme capture focus evidence is already installed')
  }
  // Keep every runtime dependency inside this callback for Locator.evaluate().
  const phases: readonly ThemeCaptureFocusPhase[] = [
    'before-menu-open', 'after-menu-select', 'after-menu-detach',
    'after-trigger-focus', 'after-native-tab', 'after-heading-focus',
  ]
  const events: FocusRecord[] = []
  let totalEvents = 0
  let currentPhase: ThemeCaptureFocusPhase = 'before-menu-open'
  let finished = false
  let finishedSnapshot: ThemeCaptureFocusSnapshot | undefined

  function roleBucket(element: Element): TargetRole {
    switch (element.getAttribute('role')) {
      case null: case 'none': return 'none'
      case 'menu': return 'menu'
      case 'menuitem': return 'menuitem'
      case 'menuitemcheckbox': return 'menuitemcheckbox'
      case 'menuitemradio': return 'menuitemradio'
      case 'button': return 'button'
      case 'link': return 'link'
      case 'textbox': return 'textbox'
      case 'heading': return 'heading'
      default: return 'other'
    }
  }

  function bucket(target: EventTarget | null): TargetBucket {
    if (!(target instanceof Element)) {
      return Object.freeze({ kind: target === null ? 'none' : 'other', role: 'none',
        connected: target instanceof Node && target.isConnected })
    }
    let kind: TargetKind = 'other'
    if (target === trigger) kind = 'theme-trigger'
    else if (target.matches('section[aria-label="Ausgewählter Kursinhalt"] h2')) kind = 'reader-heading'
    else if (target.matches('[role="menu"]')) kind = 'menu'
    else if (target.matches('[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]')) kind = 'menuitem'
    // Compare only this fixed product label; never retain or return DOM text.
    else if (target.matches('button') && target.textContent?.trim() === 'Zu dieser Lektion fragen') kind = 'lesson-qa-control'
    else if (target.matches('button[aria-haspopup="menu"]')) kind = 'other-menu-trigger'
    else if (target.matches('button')) kind = 'button'
    else if (target.matches('a[href]')) kind = 'link'
    else if (target.matches('input,textarea,select')) kind = 'input'
    else if (target === doc.body) kind = 'body'
    return Object.freeze({ kind, role: roleBucket(target), connected: target.isConnected })
  }

  function isClosed(menu: Element): boolean {
    for (let element: Element | null = menu; element; element = element.parentElement) {
      if (element.matches('[data-state="closed"],[hidden],[aria-hidden="true"]')) return true
      const style = view!.getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return true
    }
    return false
  }

  function record(type: FocusRecord['type'], phase: FocusRecord['phase'], target: EventTarget | null): void {
    // Query all menu DOM nodes, including closed/hidden nodes, rather than visible-role locators.
    const menus = doc.querySelectorAll('[role="menu"]')
    let closedMenuCount = 0
    for (const menu of menus) if (isClosed(menu)) closedMenuCount++
    const entry: FocusRecord = Object.freeze({
      timeMs: Math.round(view!.performance.now()), type, phase,
      target: bucket(target), active: bucket(doc.activeElement),
      menuCount: menus.length, closedMenuCount,
    })
    totalEvents = Math.min(totalEvents + 1, Number.MAX_SAFE_INTEGER)
    if (events.length < 64) events.push(entry)
    else events[63] = entry // Preserve the first 63 records and the latest record.
  }

  function snapshot(): ThemeCaptureFocusSnapshot {
    return Object.freeze({ limit: 64, totalEvents, omittedEvents: Math.max(0, totalEvents - events.length),
      events: Object.freeze(events.slice()) })
  }

  function onFocus(event: FocusEvent): void {
    if (!finished) record(event.type === 'focusin' ? 'focusin' : 'focusout', currentPhase, event.target)
  }

  const recorder: ThemeCaptureFocusEvidence = Object.freeze({
    checkpoint(phase: ThemeCaptureFocusPhase): ThemeCaptureFocusSnapshot {
      if (!phases.includes(phase)) throw new Error('Unknown theme capture focus phase')
      if (finished) throw new Error('Theme capture focus evidence is finished')
      currentPhase = phase
      record('checkpoint', phase, null)
      return snapshot()
    },
    finish(): ThemeCaptureFocusSnapshot {
      if (finishedSnapshot) return finishedSnapshot
      if (finished) throw new Error('Theme capture focus evidence is finished')
      try {
        record('checkpoint', 'finish', null)
        finishedSnapshot = snapshot()
        return finishedSnapshot
      } finally {
        finished = true
        doc.removeEventListener('focusin', onFocus, true)
        doc.removeEventListener('focusout', onFocus, true)
        if (view!.__themeCaptureFocusEvidence === recorder) delete view!.__themeCaptureFocusEvidence
      }
    },
  })
  Object.defineProperty(view, '__themeCaptureFocusEvidence', { configurable: true, value: recorder })
  doc.addEventListener('focusin', onFocus, true)
  doc.addEventListener('focusout', onFocus, true)
}
