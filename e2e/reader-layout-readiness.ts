export type ReaderLayoutWindow = Window & { __readerLayoutGuard?: {
  settle: () => Promise<unknown>
  arm: () => void
  check: () => { unsafe: boolean; changes: number }
  finish: () => unknown
} }

// Serialized into the real page by Locator.evaluate. Keep all dependencies in
// this function so unit tests and Chromium execute the same diagnostic code.
export function installReaderLayoutGuard(target: Element) {
  const limits = { stableFrames: 3, frames: 120, timeoutMs: 5000, changes: 8 }
  const main = document.querySelector('#page-content')!
  const header = document.querySelector('.app-header')!
  const outline = document.querySelector('#course-contents-navigation')!
  const region = target.closest('section[aria-label="Ausgewählter Kursinhalt"]')!
  const certificate = Array.from(outline.querySelectorAll('button')).find(button => ['Zertifikat herunterladen', 'Wird erstellt …'].includes(button.textContent?.trim() || '')) ?? null
  const practice = main.querySelector('a[href$="/practice/learn"]')?.parentElement?.parentElement ?? null
  const rectangle = (element: Element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  }
  const box = (element: Element | null) => {
    if (!element) return null
    const rect = rectangle(element)
    // Normalize every ancestor's native scrolling, including nested outline
    // scrollports. Content positions are relative to the main content origin.
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      rect.left += parent.scrollLeft; rect.top += parent.scrollTop
    }
    if (element !== main && main.contains(element)) {
      const origin = rectangle(main)
      rect.left -= origin.left; rect.top -= origin.top
    }
    return { rect, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }
  }
  const snapshot = () => {
    const previous = main.previousElementSibling
    const noticeText = previous?.getAttribute('role') === 'status' ? previous.textContent?.trim() : ''
    const noticeKind = noticeText === 'Inhalt als abgeschlossen markiert.' ? 'completion-marked' : noticeText === 'Abschlussmarkierung entfernt.' ? 'completion-removed' : null
    const noticeStyle = noticeKind && previous ? getComputedStyle(previous) : null
    const targetRect = target.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    const style = getComputedStyle(target)
    return { time: Math.round(performance.now()), timeOrigin: performance.timeOrigin, wallTime: Date.now(), rootFont: getComputedStyle(document.documentElement).fontSize,
      fontStatus: document.fonts.status, fontReady: document.fonts.check(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`), mainBusy: main.getAttribute('aria-busy'),
      connected: target.isConnected, disabled: (target as HTMLButtonElement).disabled,
      boxes: { header: box(header), main: box(main), outline: box(outline), region: box(region), target: box(target), certificate: box(certificate), practice: box(practice) },
      notice: noticeKind && previous && noticeStyle ? { kind: noticeKind,
        occupiedHeight: previous.getBoundingClientRect().height + parseFloat(noticeStyle.marginTop || '0') + parseFloat(noticeStyle.marginBottom || '0') } : null,
      scroll: { mainTop: main.scrollTop, mainLeft: main.scrollLeft, outlineTop: outline.scrollTop },
      focused: document.activeElement === target, focusVisible: target.matches(':focus-visible'),
      fullyInMain: targetRect.top >= Math.max(0, mainRect.top) && targetRect.bottom <= Math.min(innerHeight, mainRect.bottom) &&
        targetRect.left >= Math.max(0, mainRect.left) && targetRect.right <= Math.min(innerWidth, mainRect.right),
    }
  }
  type State = ReturnType<typeof snapshot>
  const geometry = (state: State) => ({ rootFont: state.rootFont, fontStatus: state.fontStatus, fontReady: state.fontReady,
    mainBusy: state.mainBusy, connected: state.connected, disabled: state.disabled, boxes: state.boxes, notice: state.notice })
  const same = (left: unknown, right: unknown): boolean => {
    if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) <= .5
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const a = Object.entries(left), b = Object.entries(right)
      return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key) && same(value, (right as Record<string, unknown>)[key]))
    }
    return left === right
  }
  const noticeOnlyRemoval = (before: State, after: State) => {
    if (!before.notice || after.notice || !after.focused || !after.focusVisible || !after.fullyInMain) return false
    const a = before.boxes.main!, b = after.boxes.main!
    const occupied = before.notice.occupiedHeight
    const expected = { ...geometry(before), notice: null, boxes: { ...before.boxes,
      main: { ...a, clientHeight: a.clientHeight + occupied,
        rect: { ...a.rect, top: a.rect.top - occupied, height: a.rect.height + occupied } } } }
    return same(expected, geometry(after)) && b.scrollWidth - b.clientWidth <= 1 && after.boxes.region!.scrollWidth - after.boxes.region!.clientWidth <= 1
  }
  let stable: State | null = null
  let reference: State | null = null
  let armed = false
  let stopped = false
  let unsafe = false
  let raf = 0
  let sampledFrames = 0
  const changes: Array<{ reason: string; classification: string; before: State; after: State }> = []
  const record = (reason: string) => {
    if (!armed || stopped || !reference) return
    const after = snapshot()
    if (same(geometry(reference), geometry(after))) return
    const safeNotice = noticeOnlyRemoval(reference, after)
    if (changes.length < limits.changes && (!changes.length || !same(geometry(changes[changes.length - 1].after), geometry(after)))) {
      changes.push({ reason, classification: safeNotice ? 'known-safe-notice-removal' : 'unexpected-post-input-layout-drift', before: reference, after })
    }
    if (safeNotice) reference = after // Only the exact known, usable transition.
    else unsafe = true
  }
  const frame = () => {
    raf = 0
    if (stopped || !armed) return
    sampledFrames++; record('animation-frame')
    raf = requestAnimationFrame(frame)
  }
  const observe = () => record('resize-or-scroll')
  window.addEventListener('scroll', observe, { capture: true, passive: true })
  const resize = new ResizeObserver(observe)
  for (const element of [header, main, outline, region, target, certificate, practice]) if (element) resize.observe(element)
  ;(window as ReaderLayoutWindow).__readerLayoutGuard = {
    settle: () => new Promise((resolve, reject) => {
      let previous: State | null = null
      let consecutive = 0
      let frames = 0
      let done = false
      const timer = setTimeout(() => {
        done = true
        if (raf) cancelAnimationFrame(raf)
        reject(new Error('Reader whole-layout readiness exceeded its bounded deadline'))
      }, limits.timeoutMs)
      const tick = () => {
        if (done || stopped) return
        const current = snapshot()
        frames++
        const ready = current.connected && !current.disabled && current.mainBusy === 'false' && current.fontStatus === 'loaded' && current.fontReady
        consecutive = ready && previous && same(geometry(previous), geometry(current)) ? consecutive + 1 : ready ? 1 : 0
        previous = current
        if (consecutive >= limits.stableFrames) {
          done = true; clearTimeout(timer); raf = 0; stable = current
          resolve({ limits, frames, stable: current })
        } else if (frames >= limits.frames) {
          done = true; clearTimeout(timer); raf = 0
          reject(new Error('Reader whole layout did not stabilize within its frame budget'))
        } else raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }),
    arm: () => {
      if (!stable) throw new Error('Reader whole-layout readiness was not established')
      reference = stable; armed = true; record('arm')
      raf = requestAnimationFrame(frame)
    },
    check: () => { record('assertion-checkpoint'); return { unsafe, changes: changes.length } },
    finish: () => {
      record('before-intentional-refresh'); stopped = true; armed = false
      if (raf) cancelAnimationFrame(raf)
      resize.disconnect(); window.removeEventListener('scroll', observe, true)
      delete (window as ReaderLayoutWindow).__readerLayoutGuard
      return { limits, stable, sampledFrames, unsafe, changes }
    },
  }
}
