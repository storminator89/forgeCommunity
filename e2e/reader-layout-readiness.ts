export type ReaderLayoutWindow = Window & { __readerLayoutGuard?: {
  settle: () => Promise<unknown>
  arm: () => void
  check: () => { unsafe: boolean; changes: number }
  finish: () => unknown
} }

export type ReaderLayoutOptions = {
  kind: 'qa-capture'
  expectedRootFontPixels: number
  expectedTargetFontPixels: number
}

// Serialized into the real page by Locator.evaluate. Keep all dependencies in
// this function so unit tests and Chromium execute the same diagnostic code.
export function installReaderLayoutGuard(target: Element, options?: ReaderLayoutOptions) {
  const limits = { stableFrames: 3, frames: 120, timeoutMs: 5000, changes: 8 }
  const qaCapture = options?.kind === 'qa-capture' ? options : null
  const fontSample = qaCapture ? 'Fragen' : 'Aktualisieren'
  const main = document.querySelector('#page-content')!
  const header = document.querySelector('.app-header')!
  const outline = qaCapture ? null : document.querySelector('#course-contents-navigation')!
  const region = target.closest(qaCapture ? 'section[aria-label="Frage und Antworten"]' : 'section[aria-label="Ausgewählter Kursinhalt"]')
  const certificate = qaCapture ? null : Array.from(outline!.querySelectorAll('button')).find(button => ['Zertifikat herunterladen', 'Wird erstellt …'].includes(button.textContent?.trim() || '')) ?? null
  const practice = qaCapture ? null : main.querySelector('a[href$="/practice/learn"]')?.parentElement?.parentElement ?? null
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
  const checkFont = (descriptor: string, text?: string) => {
    try { return { ready: text === undefined ? document.fonts.check(descriptor) : document.fonts.check(descriptor, text), error: false } }
    catch { return { ready: false, error: true } }
  }
  const fontReadiness = (style: CSSStyleDeclaration) => {
    // This app declares Inter first and Next's optional local Inter Fallback
    // second. Do not silently treat an unknown/reordered stack as that primary.
    const knownStack = /^\s*(?:Inter|"Inter"|'Inter')\s*(?:,\s*(?:Inter Fallback|"Inter Fallback"|'Inter Fallback')\s*)?$/i.test(style.fontFamily)
    let primaryLoaded = false
    document.fonts.forEach(face => {
      if (face.family.trim().replace(/^['"]|['"]$/g, '').toLowerCase() === 'inter' && face.status === 'loaded') primaryLoaded = true
    })
    const primaryCheck = knownStack ? checkFont(`${style.fontWeight} ${style.fontSize} "Inter"`, fontSample) : { ready: false, error: false }
    const stackCheck = checkFont(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
    return { fontPrimary: knownStack ? 'inter' : 'unknown', fontPrimaryLoaded: primaryLoaded,
      fontPrimaryCheck: primaryCheck.ready, fontPrimaryCheckError: primaryCheck.error,
      fontReady: knownStack && primaryLoaded && primaryCheck.ready,
      // check() can also require an unused local fallback. Observe its original
      // full-stack/default-space result without making it a primary-font gate.
      fontStackReady: stackCheck.ready, fontStackCheckError: stackCheck.error }
  }
  const snapshot = () => {
    const previous = main.previousElementSibling
    const noticeText = previous?.getAttribute('role') === 'status' ? previous.textContent?.trim() : ''
    const noticeKind = noticeText === 'Inhalt als abgeschlossen markiert.' ? 'completion-marked' : noticeText === 'Abschlussmarkierung entfernt.' ? 'completion-removed' : null
    const noticeStyle = noticeKind && previous ? getComputedStyle(previous) : null
    const targetRect = target.getBoundingClientRect()
    const mainRect = main.getBoundingClientRect()
    const style = getComputedStyle(target)
    const rootFont = getComputedStyle(document.documentElement).fontSize
    const matchesPixels = (actual: string, expected: number) => Number.isFinite(expected) && expected > 0 &&
      Number.isFinite(parseFloat(actual)) && Math.abs(parseFloat(actual) - expected) <= .5
    return { time: Math.round(performance.now()), timeOrigin: performance.timeOrigin, wallTime: Date.now(), rootFont,
      fontStatus: document.fonts.status, ...fontReadiness(style), mainBusy: main.getAttribute('aria-busy'),
      connected: target.isConnected, disabled: (target as HTMLButtonElement).disabled,
      ...(qaCapture ? { qaCapture: {
        expectedRootFontPixels: qaCapture.expectedRootFontPixels, expectedTargetFontPixels: qaCapture.expectedTargetFontPixels,
        targetFont: style.fontSize, targetFontFamily: style.fontFamily, targetFontWeight: style.fontWeight,
        rootFontMatches: matchesPixels(rootFont, qaCapture.expectedRootFontPixels),
        targetFontMatches: matchesPixels(style.fontSize, qaCapture.expectedTargetFontPixels),
        regionConnected: region?.isConnected === true, regionInMain: region !== null && main.contains(region), targetInRegion: region?.contains(target) === true,
        mainConnected: main.isConnected, headerConnected: header.isConnected,
      } } : {}),
      boxes: { header: box(header), main: box(main), outline: box(outline), region: box(region), target: box(target), certificate: box(certificate), practice: box(practice) },
      notice: noticeKind && previous && noticeStyle ? { kind: noticeKind,
        occupiedHeight: previous.getBoundingClientRect().height + parseFloat(noticeStyle.marginTop || '0') + parseFloat(noticeStyle.marginBottom || '0') } : null,
      scroll: { mainTop: main.scrollTop, mainLeft: main.scrollLeft, outlineTop: qaCapture ? null : outline!.scrollTop },
      focused: document.activeElement === target, focusVisible: target.matches(':focus-visible'),
      fullyInMain: targetRect.top >= Math.max(0, mainRect.top) && targetRect.bottom <= Math.min(innerHeight, mainRect.bottom) &&
        targetRect.left >= Math.max(0, mainRect.left) && targetRect.right <= Math.min(innerWidth, mainRect.right),
    }
  }
  type State = ReturnType<typeof snapshot>
  const geometry = (state: State) => ({ rootFont: state.rootFont, fontStatus: state.fontStatus, fontReady: state.fontReady, fontPrimary: state.fontPrimary,
    mainBusy: state.mainBusy, connected: state.connected, disabled: state.disabled, boxes: state.boxes, notice: state.notice,
    ...(qaCapture ? { qaCapture: state.qaCapture } : {}) })
  // The Q&A main has no aria-busy attribute. Keep its raw null in evidence;
  // only this explicit mode accepts absence. Reader mode still requires false.
  const busyReady = (state: State) => state.mainBusy === 'false' || Boolean(qaCapture && state.mainBusy === null)
  const captureReady = (state: State) => !qaCapture || Boolean(state.qaCapture?.rootFontMatches && state.qaCapture.targetFontMatches &&
    state.qaCapture.regionConnected && state.qaCapture.regionInMain && state.qaCapture.targetInRegion && state.qaCapture.mainConnected && state.qaCapture.headerConnected)
  const same = (left: unknown, right: unknown): boolean => {
    if (typeof left === 'number' && typeof right === 'number') return Math.abs(left - right) <= .5
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      const a = Object.entries(left), b = Object.entries(right)
      return a.length === b.length && a.every(([key, value]) => Object.hasOwn(right, key) && same(value, (right as Record<string, unknown>)[key]))
    }
    return left === right
  }
  // Additional observations never participate in the primary readiness gate.
  // FontFaceSet.check without text checks U+0020, not the painted label. Keep
  // both fixed samples and known family roles without exposing arbitrary names.
  const fontEvidence = () => {
    try {
      const style = getComputedStyle(target)
      const families = style.fontFamily.split(',').map(family => family.trim().replace(/^['"]|['"]$/g, '').toLowerCase())
      const descriptor = `${style.fontWeight} ${style.fontSize}`
      const stack = `${descriptor} ${style.fontFamily}`
      const counts = () => ({ loaded: 0, unloaded: 0, loading: 0, error: 0 })
      const familyFaces = { inter: counts(), interFallback: counts(), other: counts() }
      let scannedFaces = 0, omittedFaces = 0
      document.fonts.forEach(face => {
        if (scannedFaces >= 64) { omittedFaces++; return }
        scannedFaces++
        const family = face.family.trim().replace(/^['"]|['"]$/g, '').toLowerCase()
        const role = family === 'inter' ? 'inter' : family === 'inter fallback' ? 'interFallback' : 'other'
        familyFaces[role][face.status]++
      })
      const roleChecks = (family: 'Inter' | 'Inter Fallback') => families.includes(family.toLowerCase()) ? {
        defaultSpace: checkFont(`${descriptor} "${family}"`),
        ...(qaCapture ? { questionLabel: checkFont(`${descriptor} "${family}"`, fontSample) } :
          { refreshLabel: checkFont(`${descriptor} "${family}"`, fontSample) }),
      } : null
      return { available: true, time: Math.round(performance.now()), size: style.fontSize, weight: style.fontWeight,
        stackRoles: { inter: families.includes('inter'), interFallback: families.includes('inter fallback'), other: families.some(family => !['inter', 'inter fallback'].includes(family)) },
        checks: { stackDefaultSpace: checkFont(stack), ...(qaCapture ? { stackQuestionLabel: checkFont(stack, fontSample) } :
          { stackRefreshLabel: checkFont(stack, fontSample) }),
          inter: roleChecks('Inter'), interFallback: roleChecks('Inter Fallback') },
        // Counts describe family entries, not a claim about which face painted.
        familyFaces, scannedFaces, omittedFaces }
    } catch { return { available: false } }
  }
  const changedFields = (before: unknown, after: unknown, path = ''): string[] => {
    if (same(before, after)) return []
    if (before && after && typeof before === 'object' && typeof after === 'object') {
      return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => changedFields(
        (before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], path ? `${path}.${key}` : key))
    }
    return [path]
  }
  type Sample = { state: State; fonts: ReturnType<typeof fontEvidence> }
  const falseFlags = () => ({ disconnected: 0, disabled: 0, mainBusyNotFalse: 0, fontStatusNotLoaded: 0, fontReadyFalse: 0 })
  const captureFalseFlags = () => ({ rootFontMismatch: 0, targetFontMismatch: 0, regionDisconnected: 0, regionOutsideMain: 0, targetOutsideRegion: 0, mainDisconnected: 0, headerDisconnected: 0 })
  type SettleEvidence = {
    outcome: 'pending' | 'stable' | 'frame-budget' | 'deadline'
    frames: number; readyFrames: number; consecutive: number; maxConsecutive: number
    falseFlags: ReturnType<typeof falseFlags>
    qaCapture?: { falseFlags: ReturnType<typeof captureFalseFlags> }
    comparisons: number; geometryChanges: number; readinessChanges: number
    changedFields: Record<string, number>
    transitions: Array<{ frame: number; time: number; fields: string[]; omittedFields: number }>
    omittedTransitions: number; first: Sample | null; last: Sample | null
  }
  let settleEvidence: SettleEvidence | null = null
  const noticeOnlyRemoval = (before: State, after: State) => {
    if (qaCapture) return false
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
      const evidence: SettleEvidence = settleEvidence = { outcome: 'pending', frames: 0, readyFrames: 0, consecutive: 0, maxConsecutive: 0,
        falseFlags: falseFlags(), comparisons: 0, geometryChanges: 0, readinessChanges: 0, changedFields: {},
        transitions: [], omittedTransitions: 0, first: null, last: null,
        ...(qaCapture ? { qaCapture: { falseFlags: captureFalseFlags() } } : {}) }
      const retainLast = () => { if (previous) evidence.last = { state: previous, fonts: fontEvidence() } }
      const timer = setTimeout(() => {
        done = true
        if (raf) cancelAnimationFrame(raf)
        evidence.outcome = 'deadline'; retainLast()
        reject(new Error('Reader whole-layout readiness exceeded its bounded deadline'))
      }, limits.timeoutMs)
      const tick = () => {
        if (done || stopped) return
        const current = snapshot()
        frames++
        evidence.frames = frames
        if (!evidence.first) evidence.first = { state: current, fonts: fontEvidence() }
        if (!current.connected) evidence.falseFlags.disconnected++
        if (current.disabled) evidence.falseFlags.disabled++
        if (!busyReady(current)) evidence.falseFlags.mainBusyNotFalse++
        if (current.fontStatus !== 'loaded') evidence.falseFlags.fontStatusNotLoaded++
        if (!current.fontReady) evidence.falseFlags.fontReadyFalse++
        if (current.qaCapture && evidence.qaCapture) {
          const flags = evidence.qaCapture.falseFlags
          if (!current.qaCapture.rootFontMatches) flags.rootFontMismatch++
          if (!current.qaCapture.targetFontMatches) flags.targetFontMismatch++
          if (!current.qaCapture.regionConnected) flags.regionDisconnected++
          if (!current.qaCapture.regionInMain) flags.regionOutsideMain++
          if (!current.qaCapture.targetInRegion) flags.targetOutsideRegion++
          if (!current.qaCapture.mainConnected) flags.mainDisconnected++
          if (!current.qaCapture.headerConnected) flags.headerDisconnected++
        }
        if (previous) {
          evidence.comparisons++
          const fields = changedFields(geometry(previous), geometry(current))
          if (fields.some(field => field === 'rootFont' || field.startsWith('boxes.') || field.startsWith('notice') || field.startsWith('qaCapture.targetFont'))) evidence.geometryChanges++
          if (fields.some(field => ['fontStatus', 'fontReady', 'fontPrimary', 'mainBusy', 'connected', 'disabled'].includes(field) ||
            (field.startsWith('qaCapture.') && !field.startsWith('qaCapture.targetFont')))) evidence.readinessChanges++
          for (const field of fields) evidence.changedFields[field] = (evidence.changedFields[field] || 0) + 1
          if (fields.length) {
            const transition = { frame: frames, time: current.time, fields: fields.slice(0, 12), omittedFields: Math.max(0, fields.length - 12) }
            if (evidence.transitions.length < limits.changes) evidence.transitions.push(transition)
            else { evidence.transitions[limits.changes - 1] = transition; evidence.omittedTransitions++ }
          }
        }
        const ready = current.connected && !current.disabled && busyReady(current) && current.fontStatus === 'loaded' && current.fontReady && captureReady(current)
        if (ready) evidence.readyFrames++
        consecutive = ready && previous && same(geometry(previous), geometry(current)) ? consecutive + 1 : ready ? 1 : 0
        evidence.consecutive = consecutive; evidence.maxConsecutive = Math.max(evidence.maxConsecutive, consecutive)
        previous = current
        if (consecutive >= limits.stableFrames) {
          done = true; clearTimeout(timer); raf = 0; stable = current
          evidence.outcome = 'stable'; retainLast()
          resolve({ limits, frames, stable: current })
        } else if (frames >= limits.frames) {
          done = true; clearTimeout(timer); raf = 0
          evidence.outcome = 'frame-budget'; retainLast()
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
      return { limits, stable, sampledFrames, unsafe, changes, settleEvidence }
    },
  }
}

// A cleanup rejection must still fail a successful flow, while an existing
// assertion retains its own error. Record only a fixed, bounded failure marker.
export async function restoreReaderTextSize(restore: () => Promise<unknown>, originalFailed: boolean, recordFailure: () => void) {
  try { await restore() }
  catch (error) {
    if (!originalFailed) throw error
    recordFailure()
  }
}
