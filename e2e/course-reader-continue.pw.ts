import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { observeReaderRequests, type ReaderReadiness } from './reader-request-readiness'
import { installReaderLayoutGuard, restoreReaderTextSize, type ReaderLayoutWindow } from './reader-layout-readiness'
import { serializeReaderEvidence } from './reader-evidence-budget'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const candidateSha = /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA! : 'local-unverified-sha'
const readerReadiness = new WeakMap<Page, ReaderReadiness>()
type Node = { id: string; parentId: string | null; title: string; content: string; order: number; type: 'TEXT'; prerequisiteIds?: string[]; releaseOn?: string }
type LearnerNode = Node & { locked: boolean; contentVersionToken: string | null; missingPrerequisites: Array<{ id: string }>; subContents: LearnerNode[] }
type Progress = { completedContentIds: string[]; complete: boolean }

function disposableDatabasePath() {
  const browserOrigin = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Reader continue browser QA requires a loopback origin and the explicitly disposable SQLite fixture.')
  }
  return path
}

function seedReaders(path: string, instructorId: string, nonce: string) {
  const chapter = { id: `chapter-${nonce}`, parentId: null, title: 'Ein Projekt beginnen', content: '', order: 1, type: 'TEXT' as const }
  const group = { ...chapter, id: `group-${nonce}`, parentId: chapter.id, title: 'Gemeinsam weiterlernen' }
  // IDs and insertion order deliberately disagree with the nested lesson order.
  const first = { ...chapter, id: `z-first-${nonce}`, parentId: group.id, title: 'Ein Lernziel festhalten', content: '<p>Synthetischer Lerntext zum ersten Lernziel.</p>' }
  const next = { ...first, id: `a-next-${nonce}`, title: 'Den nächsten Schritt planen', content: '<p>Synthetischer Lerntext zum nächsten Schritt.</p>', order: 2, prerequisiteIds: [first.id] }
  const locked = { ...chapter, id: `future-${nonce}`, title: 'Ein späteres Kapitel', content: '<p>Synthetischer gesperrter Lerntext.</p>', releaseOn: '2099-11-01' }
  const fixtures: Array<{ courseId: string; title: string; nodes: Node[] }> = [
    { courseId: `reader-${nonce}`, title: 'Synthetischer Kurs zum Weiterlernen', nodes: [chapter, group, next, first] },
    { courseId: `reader-empty-${nonce}`, title: 'Synthetischer leerer Kurs', nodes: [] },
    { courseId: `reader-locked-${nonce}`, title: 'Synthetischer Kurs vor Freigabe', nodes: [locked] },
  ]
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN')
    for (const fixture of fixtures) {
      const publicationId = `publication-${fixture.courseId}`
      const payload = JSON.stringify({ schemaVersion: 1, title: fixture.title, description: 'Browser-Fixture', startDate: null, endDate: null, imageUrl: null, contents: fixture.nodes })
      db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "price", "updatedAt")
        VALUES (?, ?, 'Browser-Fixture', ?, 0, CURRENT_TIMESTAMP)`).run(fixture.courseId, fixture.title, instructorId)
      for (const node of fixture.nodes) db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "parentId", "type", "updatedAt")
        VALUES (?, ?, ?, ?, ?, ?, 'TEXT', CURRENT_TIMESTAMP)`).run(node.id, node.title, node.content, node.order, fixture.courseId, node.parentId)
      db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
        VALUES (?, ?, 1, 'AUTHOR', ?, ?, ?)`).run(publicationId, fixture.courseId, payload, `qa-${fixture.courseId}`, fixture.nodes.length)
      db.prepare(`INSERT INTO "CourseDraft" ("courseId", "basePublicationId", "payload", "digest", "updatedAt")
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(fixture.courseId, publicationId, payload, `qa-${fixture.courseId}`)
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(publicationId, fixture.courseId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally { db.close() }
  return { fixtures, courseId: fixtures[0].courseId, first, next, locked }
}

function storedCompleted(path: string, courseId: string, userId: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return (db.prepare('SELECT "contentId" FROM "CourseContentProgress" WHERE "courseId" = ? AND "userId" = ? ORDER BY "contentId"')
      .all(courseId, userId) as Array<{ contentId: string }>).map(row => row.contentId)
  } finally { db.close() }
}

function flatten(nodes: LearnerNode[]): LearnerNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.subContents)])
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}

async function keyboardActivate(page: Page, action: Locator) {
  await page.keyboard.press('Tab')
  await action.focus()
  await expect(action).toBeFocused()
  expect(await action.evaluate(element => element.matches(':focus-visible'))).toBe(true)
  await page.keyboard.press('Enter')
}

type ReaderFocusProbeWindow = Window & { __readerTextZoomProbe?: {
  sample: (reason: string) => void
  finish: () => unknown
} }

// Observe the original keyboard path without changing focus, scrolling, styles,
// animation or assertion timing. No lesson text, URLs, identifiers or tokens.
async function observeReaderTextZoom(refresh: Locator) {
  await refresh.evaluate(target => {
    const limits = { rows: 40, ringBytes: 96 * 1024, ancestors: 12, rafBurst: 3 }
    const rows: Array<{ value: unknown; bytes: number }> = []
    const milestones: unknown[] = []
    let ringBytes = 0
    let droppedRows = 0
    let raf = 0
    let framesLeft = 0
    let stopped = false
    const rectangle = (element: Element) => {
      const rect = element.getBoundingClientRect()
      const round = (value: number) => Math.round(value * 1000) / 1000
      return { top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom), left: round(rect.left), width: round(rect.width), height: round(rect.height) }
    }
    const identity = (element: Element | null) => element ? {
      tag: element.tagName.toLowerCase(), target: element === target,
      main: element.id === 'page-content', outline: element.id === 'course-contents-navigation',
      reader: element === target.closest('[role="region"]'), active: element === document.activeElement,
    } : null
    const snapshot = (reason: string) => {
      const owners = new Set<Element>()
      let ancestor: Element | null = target
      for (let depth = 0; ancestor && depth < limits.ancestors; depth++, ancestor = ancestor.parentElement) owners.add(ancestor)
      for (const selector of ['.app-header', '#course-contents-navigation']) {
        const element = document.querySelector(selector)
        if (element) owners.add(element)
      }
      const viewport = window.visualViewport
      return { reason, time: Math.round(performance.now()), timeOrigin: performance.timeOrigin, wallTime: Date.now(), rootFont: getComputedStyle(document.documentElement).fontSize,
        viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY,
          visual: viewport ? { top: viewport.offsetTop, left: viewport.offsetLeft, width: viewport.width, height: viewport.height, scale: viewport.scale } : null },
        focused: identity(document.activeElement), focusVisible: target.matches(':focus-visible'), connected: target.isConnected,
        focusedRect: document.activeElement ? rectangle(document.activeElement) : null,
        ancestorsTruncated: ancestor !== null,
        owners: Array.from(owners).map(element => {
          const style = getComputedStyle(element)
          return { ...identity(element), rect: rectangle(element), scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
            scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
            maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight), maxScrollLeft: Math.max(0, element.scrollWidth - element.clientWidth),
            overflowX: style.overflowX, overflowY: style.overflowY, scrollBehavior: style.scrollBehavior, overflowAnchor: style.overflowAnchor,
            display: style.display, position: style.position, height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight,
            flexDirection: style.flexDirection, flexBasis: style.flexBasis, flexGrow: style.flexGrow, flexShrink: style.flexShrink }
        }) }
    }
    const record = (reason: string, milestone = false) => {
      if (stopped) return
      const value = snapshot(reason)
      if (milestone && milestones.length < 8) milestones.push(value)
      const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
      if (bytes > limits.ringBytes) { droppedRows++; return }
      while (rows.length && (rows.length >= limits.rows || ringBytes + bytes > limits.ringBytes)) {
        ringBytes -= rows.shift()!.bytes
        droppedRows++
      }
      rows.push({ value, bytes }); ringBytes += bytes
    }
    const frame = () => {
      raf = 0
      if (stopped) return
      record(`rAF:${limits.rafBurst - framesLeft + 1}`)
      if (--framesLeft > 0) raf = requestAnimationFrame(frame)
    }
    const sample = (reason: string) => {
      record(reason, true)
      framesLeft = limits.rafBurst
      if (!raf) raf = requestAnimationFrame(frame)
    }
    const observe = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Tab') return
      record(`${event.type}${event instanceof KeyboardEvent ? `:${event.shiftKey ? 'Shift+' : ''}Tab` : ''}`)
      framesLeft = limits.rafBurst
      if (!raf) raf = requestAnimationFrame(frame)
    }
    const events = ['keydown', 'keyup', 'focusin', 'focusout', 'scroll', 'resize'] as const
    for (const event of events) window.addEventListener(event, observe, { capture: true, passive: true })
    const resize = new ResizeObserver(() => { if (!stopped) record('layout-resize') })
    for (const element of [target, target.closest('[role="region"]'), document.querySelector('#page-content'), document.querySelector('.app-header')]) {
      if (element) resize.observe(element)
    }
    ;(window as ReaderFocusProbeWindow).__readerTextZoomProbe = { sample, finish: () => {
      record('original-verdict', true)
      stopped = true
      if (raf) cancelAnimationFrame(raf)
      resize.disconnect()
      for (const event of events) window.removeEventListener(event, observe, true)
      delete (window as ReaderFocusProbeWindow).__readerTextZoomProbe
      return { limits, ringBytes, droppedRows, milestones, rows: rows.map(row => row.value) }
    } }
    sample('before-text-zoom')
  })
}

// One read-only sample before the original overflow verdict identifies the
// actual overflowing descendants, rather than inferring a leaf from ancestors.
// Known control names are enums; lesson text, URLs, IDs and tokens stay private.
async function readerOverflowGeometry(reader: Locator) {
  return reader.evaluate(region => {
    const limits = { scannedElements: 1024, rows: 64, bytes: 48 * 1024 }
    const rect = (element: Element) => {
      const value = element.getBoundingClientRect()
      const round = (number: number) => Math.round(number * 1000) / 1000
      return { left: round(value.left), right: round(value.right), top: round(value.top), bottom: round(value.bottom), width: round(value.width), height: round(value.height) }
    }
    const main = document.querySelector('#page-content')!
    const mainRect = rect(main)
    const regionRect = rect(region)
    const knownControls: Record<string, string> = {
      'Als abgeschlossen markieren': 'mark-complete',
      'Abschlussmarkierung entfernen': 'remove-complete',
      'Wird gespeichert …': 'completion-busy',
      'Kurs starten': 'start', Weiterlernen: 'continue',
      'Nächste Lektion öffnen': 'next',
      'Lernfortschritt aktualisieren': 'refresh',
      'Wird geprüft …': 'refresh-busy',
      'Zugriff neu prüfen': 'recheck-access',
    }
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_ELEMENT)
    const elements: Element[] = [region]
    while (elements.length < limits.scannedElements) {
      const next = walker.nextNode()
      if (!next) break
      elements.push(next as Element)
    }
    const truncatedScan = elements.length === limits.scannedElements && walker.nextNode() !== null
    const rows: unknown[] = []
    let bytes = 0
    let droppedRows = 0
    for (const [index, element] of elements.entries()) {
      const bounds = rect(element)
      const parent = element.parentElement
      const parentRect = parent ? rect(parent) : null
      const control = element.matches('button, a, input, select, textarea, [role="button"]')
      const overflowX = element.scrollWidth - element.clientWidth
      const outsideRegion = bounds.left < regionRect.left - 1 || bounds.right > regionRect.right + 1
      const outsideParent = Boolean(parentRect && (bounds.left < parentRect.left - 1 || bounds.right > parentRect.right + 1))
      if (!bounds.width || !bounds.height || (!control && overflowX <= 1 && !outsideRegion && !outsideParent)) continue
      const style = getComputedStyle(element)
      const value = {
        index, parentIndex: parent ? elements.indexOf(parent) : null,
        tag: element.tagName.toLowerCase(), control: control ? knownControls[element.getAttribute('aria-label') || element.textContent?.trim() || ''] || 'other' : null,
        rect: bounds, parentRect, outsideRegion, outsideParent,
        scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
        style: { display: style.display, position: style.position, width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
          height: style.height, minHeight: style.minHeight, maxHeight: style.maxHeight,
          whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap, wordBreak: style.wordBreak,
          overflowX: style.overflowX, overflowY: style.overflowY,
          fontSize: style.fontSize, fontFamily: style.fontFamily, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
          paddingLeft: style.paddingLeft, paddingRight: style.paddingRight, boxSizing: style.boxSizing,
          flexDirection: style.flexDirection, flexBasis: style.flexBasis, flexGrow: style.flexGrow, flexShrink: style.flexShrink },
      }
      const rowBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength
      if (rows.length >= limits.rows || bytes + rowBytes > limits.bytes) { droppedRows++; continue }
      rows.push(value); bytes += rowBytes
    }
    return { limits, scannedElements: elements.length, truncatedScan, droppedRows, bytes,
      rootFont: getComputedStyle(document.documentElement).fontSize, viewport: { width: innerWidth, height: innerHeight },
      main: { rect: mainRect, scrollWidth: main.scrollWidth, clientWidth: main.clientWidth, scrollLeft: main.scrollLeft },
      region: { rect: regionRect, scrollWidth: region.scrollWidth, clientWidth: region.clientWidth }, rows }
  })
}

async function emitReaderTextZoomEvidence(page: Page, info: TestInfo, state: string, mode: 'light' | 'dark', originalCompleted: boolean, phase: string, overflowEvidence: unknown, readinessEvidence: unknown) {
  try {
    const evidence = await page.evaluate(() => (window as ReaderFocusProbeWindow).__readerTextZoomProbe?.finish())
    const payload = serializeReaderEvidence({ state, mode, candidateSha, originalCompleted, phase, evidence, overflowEvidence, readinessEvidence })
    // Observation must never replace the original assertion's verdict.
    if (Buffer.byteLength(payload) <= 192 * 1024) {
      console.info('Reader text-zoom focus evidence:', payload)
      await info.attach(`reader-${state}-text200-focus-${mode}`, { body: Buffer.from(payload), contentType: 'application/json' })
    } else console.info('Reader text-zoom evidence exceeded its bounded output cap.')
  } catch (error) {
    console.info('Reader text-zoom evidence unavailable:', error instanceof Error ? error.name : 'unknown error')
  }
}

async function captureReaderTextZoom(page: Page, info: TestInfo, state: string, mode: 'light' | 'dark') {
  const reader = page.getByRole('region', { name: 'Ausgewählter Kursinhalt' })
  const refresh = reader.getByRole('button', { name: 'Lernfortschritt aktualisieren', exact: true })
  const originalRootSize = await page.locator('html').evaluate(element => element.style.fontSize)
  const rootPixels = await page.locator('html').evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  const originalLabelPixels = await refresh.evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  await observeReaderTextZoom(refresh)
  let originalCompleted = false
  let originalFailed = false
  let phase = 'text-enlargement'
  let overflowEvidence: unknown = null
  const reads = readerReadiness.get(page)!
  const readinessEvidence: { data?: unknown; enlarged?: unknown; guard?: unknown; finalData?: unknown } = {}
  try {
    phase = 'real-reader-data-readiness'
    await expect.poll(() => reads().ready, { message: 'Actual authenticated Reader GETs must finish successfully' }).toBe(true)
    await expect(page.locator('#page-content')).toHaveAttribute('aria-busy', 'false')
    await expect(refresh).toBeEnabled()
    const certificate = page.locator('#course-contents-navigation').getByRole('button', { name: 'Zertifikat herunterladen', exact: true })
    await expect(certificate).toBeVisible()
    if (reads().certificateEnabled) await expect(certificate).toBeEnabled()
    else await expect(certificate).toBeDisabled()
    await page.evaluate(async () => { await document.fonts.ready })
    readinessEvidence.data = reads()
    const readySequence = reads().sequence
    await refresh.evaluate(installReaderLayoutGuard)
    phase = 'deliberate-text-enlargement'
    // Actual text enlargement changes computed font size and layout. Do not use
    // a screenshot transform, device scale factor, or an overflow-hiding rule.
    await page.locator('html').evaluate((element, pixels) => { element.style.fontSize = `${pixels * 2}px` }, rootPixels)
    await expect.poll(() => refresh.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(originalLabelPixels * 1.99)
    await page.evaluate(async () => { await document.fonts.ready })
    readinessEvidence.enlarged = await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.settle())
    expect(reads().sequence, 'No new relevant data read after declared Reader readiness').toBe(readySequence)
    expect(reads().ready).toBe(true)
    await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.arm())
    await page.evaluate(() => (window as ReaderFocusProbeWindow).__readerTextZoomProbe?.sample('text-enlarged'))
    await page.keyboard.press('Tab')
    await page.evaluate(() => (window as ReaderFocusProbeWindow).__readerTextZoomProbe?.sample('after-native-tab'))
    phase = 'locator-focus'
    await refresh.focus()
    await page.evaluate(() => (window as ReaderFocusProbeWindow).__readerTextZoomProbe?.sample('after-locator-focus'))
    await expect(refresh).toBeFocused()
    phase = 'full-viewport-assertion'
    await expect(refresh).toBeInViewport({ ratio: 1 })
    phase = 'remaining-original-assertions'
    expect(await refresh.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    try { overflowEvidence = await readerOverflowGeometry(reader) }
    catch (error) { overflowEvidence = { unavailable: error instanceof Error ? error.name : 'unknown error' } }
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth), `${state} ${mode} 320px text200 document overflow`).toBeLessThanOrEqual(1)
    expect(await page.locator('#page-content').evaluate(element => element.scrollWidth - element.clientWidth), `${state} text200 main overflow`).toBeLessThanOrEqual(1)
    expect(await reader.evaluate(element => element.scrollWidth - element.clientWidth), `${state} text200 reader overflow`).toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.check().unsafe), 'Unexpected post-readiness layout drift').toBe(false)
    for (const action of await reader.getByRole('button', { name: /^(Kurs starten|Nächste Lektion öffnen|Lernfortschritt aktualisieren)$/ }).all()) {
      const bounds = await action.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const parent = element.parentElement!.getBoundingClientRect()
        return { height: rect.height, fits: rect.left >= parent.left - 1 && rect.right <= parent.right + 1,
          overflowX: element.scrollWidth - element.clientWidth, overflowY: element.scrollHeight - element.clientHeight }
      })
      expect(bounds.height).toBeGreaterThanOrEqual(44)
      expect(bounds.fits).toBe(true)
      expect(bounds.overflowX).toBeLessThanOrEqual(1)
      expect(bounds.overflowY).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: info.outputPath(`reader-${state}-refresh-text200-${mode}-320-${candidateSha}.png`), fullPage: true, animations: 'disabled' })
    expect(await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.check().unsafe), 'Unexpected post-input layout drift before explicit refresh').toBe(false)
    expect(reads().sequence, 'No unexpected relevant data read before explicit refresh').toBe(readySequence)
    readinessEvidence.guard = await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.finish())
    expect((readinessEvidence.guard as { unsafe: boolean }).unsafe, 'Final retained layout verdict before intentional refresh').toBe(false)
    expect(reads().sequence, 'No late relevant data read before intentional refresh').toBe(readySequence)
    expect(reads().ready).toBe(true)
    readinessEvidence.finalData = reads()
    const checking = page.waitForResponse(response => /\/api\/courses\/[^/]+\/progress$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET')
    await page.keyboard.press('Enter')
    expect((await checking).status()).toBe(200)
    await expect(refresh).toBeEnabled()
    originalCompleted = true
  } catch (error) {
    originalFailed = true
    // The automatic failure screenshot runs after finally restores normal text.
    // Capture the actual enlarged state without replacing the original verdict.
    try {
      await page.screenshot({ path: info.outputPath(`reader-${state}-failure-before-text-reset-${mode}-320-${candidateSha}.png`), fullPage: true, animations: 'disabled' })
    } catch (captureError) {
      console.info('Reader enlarged failure capture unavailable:', captureError instanceof Error ? captureError.name : 'unknown error')
    }
    throw error
  } finally {
    const unfinishedGuard = await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard?.finish()).catch(() => undefined)
    if (unfinishedGuard) readinessEvidence.guard = unfinishedGuard
    readinessEvidence.finalData = reads()
    await emitReaderTextZoomEvidence(page, info, state, mode, originalCompleted, phase, overflowEvidence, readinessEvidence)
    await restoreReaderTextSize(
      () => page.locator('html').evaluate((element, previous) => { element.style.fontSize = previous }, originalRootSize),
      originalFailed, () => console.info('Reader text-size reset failed after retained original failure'))
  }
}

async function captureActiveNoticeControls(page: Page, info: TestInfo, withNext: boolean) {
  const notice = page.getByRole('status').filter({ hasText: /^Inhalt als abgeschlossen markiert\./ })
  const reader = page.getByRole('region', { name: 'Ausgewählter Kursinhalt' })
  const remove = reader.getByRole('button', { name: 'Abschlussmarkierung entfernen', exact: true })
  const refresh = reader.getByRole('button', { name: 'Lernfortschritt aktualisieren', exact: true })
  const reads = readerReadiness.get(page)!
  const mode = await page.locator('html').evaluate(element => element.classList.contains('dark') ? 'dark' : 'light')
  const originalRootSize = await page.locator('html').evaluate(element => element.style.fontSize)
  const rootPixels = await page.locator('html').evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  const originalLabelPixels = await refresh.evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  const controls: unknown[] = []
  const readinessEvidence: { data?: unknown; enlarged?: unknown; guard?: unknown; finalData?: unknown; completionRetainedFocus?: boolean } = {}
  let overflowEvidence: unknown = null
  let originalCompleted = false
  let originalFailed = false
  let phase = 'completion-notice-active-setup'
  let guard: unknown
  try {
    expect(await page.evaluate(() => innerWidth)).toBe(320)
    await expect(notice).toBeVisible()
    // Native disabling during PATCH may blur this button while retaining the
    // sequential-focus origin. Observe it; the first real Tab is the verdict.
    readinessEvidence.completionRetainedFocus = await remove.evaluate(element => document.activeElement === element)
    await expect.poll(() => reads().ready).toBe(true)
    readinessEvidence.data = reads()
    const readySequence = reads().sequence
    await refresh.evaluate(installReaderLayoutGuard)
    await page.locator('html').evaluate((element, pixels) => { element.style.fontSize = `${pixels * 2}px` }, rootPixels)
    await expect.poll(() => refresh.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(originalLabelPixels * 1.99)
    await page.evaluate(async () => { await document.fonts.ready })
    readinessEvidence.enlarged = await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.settle())
    await expect(notice).toBeVisible()
    await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.arm())
    // Native Tab order only: Remove -> Lesson question -> [Next ->] Refresh,
    // then the same controls in reverse. The Q&A entry is an actual tab stop.
    // No locator.focus(), retry, scroll correction or notice/clock manipulation.
    const sequence = withNext ? [
      ['Tab', 'Zu dieser Lektion fragen', false],
      ['Tab', 'Nächste Lektion öffnen', true], ['Tab', 'Lernfortschritt aktualisieren', true],
      ['Shift+Tab', 'Nächste Lektion öffnen', false], ['Shift+Tab', 'Zu dieser Lektion fragen', false],
      ['Shift+Tab', 'Abschlussmarkierung entfernen', true],
    ] as const : [
      ['Tab', 'Zu dieser Lektion fragen', false], ['Tab', 'Lernfortschritt aktualisieren', true],
      ['Shift+Tab', 'Zu dieser Lektion fragen', false], ['Shift+Tab', 'Abschlussmarkierung entfernen', true],
    ] as const
    for (const [key, name, capture] of sequence) {
      phase = `native-${key}-${name}`
      await expect(notice).toBeVisible()
      await page.keyboard.press(key)
      const action = reader.getByRole('button', { name, exact: true })
      await expect(action).toBeFocused()
      await expect(action).toBeInViewport({ ratio: 1 })
      expect(await action.evaluate(element => element.matches(':focus-visible'))).toBe(true)
      const geometry = await action.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const parent = element.parentElement!.getBoundingClientRect()
        return { time: Math.round(performance.now()), height: rect.height, fits: rect.left >= parent.left - 1 && rect.right <= parent.right + 1,
          overflowX: element.scrollWidth - element.clientWidth, overflowY: element.scrollHeight - element.clientHeight }
      })
      controls.push({ name, key, geometry })
      expect(geometry.height).toBeGreaterThanOrEqual(44)
      expect(geometry.fits).toBe(true)
      expect(geometry.overflowX).toBeLessThanOrEqual(1)
      expect(geometry.overflowY).toBeLessThanOrEqual(1)
      if (!overflowEvidence) overflowEvidence = await readerOverflowGeometry(reader)
      expect(await page.locator('#page-content').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      expect(await reader.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await expect(notice).toBeVisible()
      if (capture) await page.screenshot({ path: info.outputPath(`reader-completion-notice-${withNext ? 'with-next' : 'all-complete'}-active-${controls.length}-text200-${mode}-320-${candidateSha}.png`), fullPage: true, animations: 'disabled' })
      await expect(notice).toBeVisible()
    }
    guard = await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.finish())
    expect((guard as { unsafe: boolean }).unsafe).toBe(false)
    expect(reads().sequence).toBe(readySequence)
    expect(reads().ready).toBe(true)
    // The learner-control sequence and guard above stay intact. Now check the
    // notice itself while its real four-second lifetime is still running.
    phase = 'active-notice-dismiss-control'
    const close = notice.getByRole('button', { name: 'Meldung schließen', exact: true })
    await expect(notice).toBeVisible()
    const noticeGeometry = await notice.evaluate(element => ({
      overflowX: element.scrollWidth - element.clientWidth,
      messageOverflowX: element.firstElementChild!.scrollWidth - element.firstElementChild!.clientWidth,
    }))
    const closeGeometry = await close.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const parent = element.parentElement!.getBoundingClientRect()
      return { width: rect.width, height: rect.height,
        fitsNotice: rect.left >= parent.left && rect.right <= parent.right && rect.top >= parent.top && rect.bottom <= parent.bottom,
        fitsViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight }
    })
    expect(noticeGeometry.overflowX).toBeLessThanOrEqual(1)
    expect(noticeGeometry.messageOverflowX).toBeLessThanOrEqual(1)
    expect(closeGeometry.width).toBeGreaterThanOrEqual(44)
    expect(closeGeometry.height).toBeGreaterThanOrEqual(44)
    expect(closeGeometry.fitsNotice).toBe(true)
    expect(closeGeometry.fitsViewport).toBe(true)
    await expect(close).toBeInViewport({ ratio: 1 })
    // Traverse the existing outline's native reverse tab order, without
    // locator.focus(), scrolling, retries, or changing the notice clock.
    let reverseTabs = 0
    while (reverseTabs < 16 && !await close.evaluate(element => document.activeElement === element)) {
      await page.keyboard.press('Shift+Tab')
      reverseTabs++
      await expect(notice).toBeVisible()
    }
    await expect(close).toBeFocused()
    expect(await close.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    await expect(close).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: info.outputPath(`reader-completion-notice-${withNext ? 'with-next' : 'all-complete'}-dismiss-focused-text200-${mode}-320-${candidateSha}.png`), fullPage: true, animations: 'disabled' })
    await expect(notice).toBeVisible()
    // Observe the trusted keyboard click before React handles it. A later
    // timeout must not make a missed Enter or a disconnected control pass.
    await close.evaluate(element => {
      document.documentElement.removeAttribute('data-reader-notice-dismissal')
      element.addEventListener('click', event => {
        document.documentElement.setAttribute('data-reader-notice-dismissal', JSON.stringify({
          trusted: event.isTrusted, keyboard: (event as MouseEvent).detail === 0,
          connected: element.isConnected, focused: document.activeElement === element,
          noticeConnected: element.parentElement?.isConnected === true && element.parentElement.getAttribute('role') === 'status',
        }))
      }, { once: true })
    })
    await page.keyboard.press('Enter')
    const dismissal = JSON.parse(await page.locator('html').getAttribute('data-reader-notice-dismissal') ?? '{}') as Record<string, boolean>
    expect(dismissal).toEqual({ trusted: true, keyboard: true, connected: true, focused: true, noticeConnected: true })
    expect(await notice.count()).toBe(0)
    controls.push({ name: 'Meldung schließen', key: 'Shift+Tab', reverseTabs, geometry: closeGeometry, noticeGeometry, dismissal })
    await page.locator('html').evaluate(element => element.removeAttribute('data-reader-notice-dismissal'))
    originalCompleted = true
  } catch (error) {
    originalFailed = true
    await page.screenshot({ path: info.outputPath(`reader-completion-notice-active-failure-before-text-reset-${mode}-320-${candidateSha}.png`), fullPage: true, animations: 'disabled' }).catch(() => {})
    throw error
  } finally {
    guard ??= await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard?.finish()).catch(() => undefined)
    readinessEvidence.guard = guard
    readinessEvidence.finalData = reads()
    try {
      overflowEvidence ??= await readerOverflowGeometry(reader)
      const payload = serializeReaderEvidence({ state: withNext ? 'completion-notice-with-next-active' : 'completion-notice-all-complete-active', mode, candidateSha, originalCompleted, phase, controls, overflowEvidence, readinessEvidence })
      console.info('Reader active-notice text-zoom evidence:', payload)
      await info.attach(`reader-completion-notice-${withNext ? 'with-next' : 'all-complete'}-active-text200-${mode}-geometry`, { body: Buffer.from(payload), contentType: 'application/json' })
    } catch (error) { console.info('Reader active-notice evidence unavailable:', error instanceof Error ? error.name : 'unknown error') }
    await restoreReaderTextSize(
      () => page.locator('html').evaluate((element, previous) => { element.style.fontSize = previous }, originalRootSize),
      originalFailed, () => console.info('Reader active-notice text-size reset failed after retained original failure'))
  }
}

async function capture(page: Page, info: TestInfo, state: string, focus?: Locator) {
  for (const mode of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Farbschema auswählen' }).click()
    await page.getByRole('menuitem', { name: mode === 'light' ? 'Hell' : 'Dunkel', exact: true }).click()
    if (mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport)
      await page.evaluate(async () => { await document.fonts.ready })
      if (!focus) await page.getByRole('region', { name: 'Ausgewählter Kursinhalt' }).getByRole('heading').first().scrollIntoViewIfNeeded()
      if (focus) {
        await page.keyboard.press('Tab')
        await focus.focus()
        await expect(focus).toBeFocused()
        await expect(focus).toBeInViewport({ ratio: 1 })
        expect(await focus.evaluate(element => element.matches(':focus-visible'))).toBe(true)
      }
      expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth), `${state} ${mode} ${viewport.width}px document overflow`).toBeLessThanOrEqual(1)
      expect(await page.locator('#page-content').evaluate(element => element.scrollWidth - element.clientWidth), `${state} main overflow`).toBeLessThanOrEqual(1)
      expect(await page.getByRole('region', { name: 'Ausgewählter Kursinhalt' }).evaluate(element => element.scrollWidth - element.clientWidth), `${state} reader overflow`).toBeLessThanOrEqual(1)
      await page.screenshot({ path: info.outputPath(`reader-${state}-${mode}-${viewport.width}-${candidateSha}.png`), fullPage: true, animations: 'disabled' })
      if (viewport.width === 320 && (state === 'entry' || state === 'completed-with-next')) await captureReaderTextZoom(page, info, state, mode)
    }
  }
}

// An independent read-only context captures the disabled/enabled certificate
// at actual enlarged text. Capture-only scrolling never alters the original
// Reader's native keyboard/focus path or requests a certificate.
async function captureCertificateReflow(page: Page, info: TestInfo, courseIds: string[], learnerId: string, state: 'entry-disabled' | 'complete-enabled') {
  const context = await page.context().browser()!.newContext({ baseURL: origin, storageState: await page.context().storageState(), viewport: { width: 320, height: 700 }, reducedMotion: 'reduce' })
  const capturePage = await context.newPage()
  const reads = observeReaderRequests(capturePage, courseIds, learnerId)
  try {
    await capturePage.goto(page.url())
    await expect.poll(() => reads().ready).toBe(true)
    await expect(capturePage.locator('#page-content')).toHaveAttribute('aria-busy', 'false')
    const certificate = capturePage.locator('#course-contents-navigation').getByRole('button', { name: 'Zertifikat herunterladen', exact: true })
    const refresh = capturePage.getByRole('region', { name: 'Ausgewählter Kursinhalt' }).getByRole('button', { name: 'Lernfortschritt aktualisieren', exact: true })
    for (const mode of ['light', 'dark'] as const) {
      await capturePage.getByRole('button', { name: 'Farbschema auswählen' }).click()
      await capturePage.getByRole('menuitem', { name: mode === 'light' ? 'Hell' : 'Dunkel', exact: true }).click()
      const originalRootSize = await capturePage.locator('html').evaluate(element => element.style.fontSize)
      const rootPixels = await capturePage.locator('html').evaluate(element => parseFloat(getComputedStyle(element).fontSize))
      const originalLabelPixels = await certificate.evaluate(element => parseFloat(getComputedStyle(element).fontSize))
      let originalFailed = false
      let phase = 'certificate-text-enlargement'
      try {
        await capturePage.locator('html').evaluate((element, pixels) => { element.style.fontSize = `${pixels * 2}px` }, rootPixels)
        await expect.poll(() => certificate.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(originalLabelPixels * 1.99)
        await capturePage.evaluate(async () => { await document.fonts.ready })
        await refresh.evaluate(installReaderLayoutGuard)
        phase = 'certificate-whole-layout-readiness'
        await capturePage.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.settle())
        phase = 'certificate-geometry'
        await certificate.scrollIntoViewIfNeeded()
        await expect(certificate).toBeInViewport({ ratio: 1 })
        await expect(certificate).toHaveCSS('white-space', 'normal')
        if (state === 'entry-disabled') await expect(certificate).toBeDisabled()
        else await expect(certificate).toBeEnabled()
        const geometry = await certificate.evaluate(element => {
          const rect = element.getBoundingClientRect()
          const label = element.querySelector('span')!
          return { rootFont: getComputedStyle(document.documentElement).fontSize, labelFont: getComputedStyle(label).fontSize,
            height: rect.height, left: rect.left, right: rect.right, viewport: innerWidth,
            overflowX: element.scrollWidth - element.clientWidth, overflowY: element.scrollHeight - element.clientHeight,
            labelOverflowX: label.scrollWidth - label.clientWidth, labelOverflowY: label.scrollHeight - label.clientHeight }
        })
        expect(geometry.height).toBeGreaterThanOrEqual(44)
        expect(geometry.left).toBeGreaterThanOrEqual(0)
        expect(geometry.right).toBeLessThanOrEqual(geometry.viewport)
        expect(geometry.overflowX).toBeLessThanOrEqual(1)
        expect(geometry.overflowY).toBeLessThanOrEqual(1)
        expect(geometry.labelOverflowX).toBeLessThanOrEqual(1)
        expect(geometry.labelOverflowY).toBeLessThanOrEqual(1)
        expect(await capturePage.locator('#page-content').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        await info.attach(`reader-certificate-${state}-text200-${mode}-geometry`, { body: Buffer.from(JSON.stringify({ state, mode, candidateSha, geometry })), contentType: 'application/json' })
        await capturePage.screenshot({ path: info.outputPath(`reader-certificate-${state}-text200-${mode}-320-${candidateSha}.png`), fullPage: true, animations: 'disabled' })
      } catch (error) {
        originalFailed = true
        await capturePage.screenshot({ path: info.outputPath(`reader-certificate-${state}-failure-before-text-reset-${mode}-320-${candidateSha}.png`), fullPage: true, animations: 'disabled' }).catch(() => {})
        throw error
      } finally {
        const guard = await capturePage.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard?.finish()).catch(() => undefined)
        try {
          const payload = serializeReaderEvidence({ state, mode, candidateSha, originalFailed, phase,
            readinessEvidence: { guard, finalData: reads() } })
          console.info('Reader certificate readiness evidence:', payload)
          await info.attach(`reader-certificate-${state}-text200-${mode}-readiness`, { body: Buffer.from(payload), contentType: 'application/json' })
        } catch (error) { console.info('Reader certificate readiness evidence unavailable:', error instanceof Error ? error.name : 'unknown error') }
        await restoreReaderTextSize(
          () => capturePage.locator('html').evaluate((element, previous) => { element.style.fontSize = previous }, originalRootSize),
          originalFailed, () => console.info('Reader certificate text-size reset failed after retained original failure'))
      }
    }
  } finally { await context.close() }
}

test('reader opens and continues only on explicit learner actions with current server-unlocked progress', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'One disposable real-reader journey captures desktop and 320px in both themes.')
  test.setTimeout(300_000)
  const path = disposableDatabasePath()
  const nonce = randomUUID()
  const password = `ReaderContinueQA1!${nonce}`
  const authorEmail = `reader-author-${nonce}@example.test`
  const learnerEmail = `reader-learner-${nonce}@example.test`
  const author = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name: 'Reader QA Author', email: authorEmail, password } })
  const learner = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name: 'Reader QA Learner', email: learnerEmail, password } })
  expect(author.status()).toBe(201)
  expect(learner.status()).toBe(201)
  const instructorId = (await author.json() as { userId: string }).userId
  const learnerId = (await learner.json() as { userId: string }).userId
  const fixture = seedReaders(path, instructorId, nonce)
  readerReadiness.set(page, observeReaderRequests(page, fixture.fixtures.map(course => course.courseId), learnerId))
  const base = `/courses/${fixture.courseId}/contents`
  const progressPath = `/api/courses/${fixture.courseId}/progress`
  const contentsPath = `/api/courses/${fixture.courseId}/contents`
  const reader = page.getByRole('region', { name: 'Ausgewählter Kursinhalt' })
  const firstHeading = reader.getByRole('heading', { name: fixture.first.title, level: 2, exact: true })
  const nextHeading = reader.getByRole('heading', { name: fixture.next.title, level: 2, exact: true })
  const saved = () => storedCompleted(path, fixture.courseId, learnerId)
  const progressPaths = new Set(fixture.fixtures.map(course => `/api/courses/${course.courseId}/progress`))
  const patches: Array<{ contentId: string; completed: boolean }> = []
  page.on('request', incoming => {
    if (progressPaths.has(new URL(incoming.url()).pathname) && incoming.method() === 'PATCH') {
      const body = incoming.postDataJSON() as { contentId: string; completed: boolean }
      // Retain no opaque content-version token in browser evidence or reports.
      patches.push({ contentId: body.contentId, completed: body.completed })
    }
  })
  await login(page, learnerEmail, password)
  for (const course of fixture.fixtures) expect((await page.request.post(`${origin}/api/courses/${course.courseId}/enrollment`, { headers: { origin } })).status()).toBe(201)
  const contents = await page.request.get(`${origin}${contentsPath}`)
  expect(contents.status()).toBe(200)
  const before = flatten(await contents.json() as LearnerNode[])
  expect(before.find(node => node.id === fixture.first.id)?.locked).toBe(false)
  expect(before.find(node => node.id === fixture.next.id)).toMatchObject({ locked: true, content: '', contentVersionToken: null, missingPrerequisites: [{ id: fixture.first.id }] })

  await page.goto(base)
  await expect(reader.getByRole('heading', { name: 'Dein nächster Lernschritt', exact: true })).toBeVisible()
  await expect(reader).toContainText(fixture.first.title)
  const start = reader.getByRole('button', { name: 'Kurs starten', exact: true })
  await expect(start).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true })).toHaveCount(0)
  await expect(page.locator('#course-contents-navigation [aria-current="page"]')).toHaveCount(0)
  await capture(page, info, 'entry', start)
  await captureCertificateReflow(page, info, fixture.fixtures.map(course => course.courseId), learnerId, 'entry-disabled')
  expect(new URL(page.url()).searchParams.has('content')).toBe(false)
  expect(saved()).toEqual([])
  expect(patches).toEqual([])

  await keyboardActivate(page, start)
  await expect(page).toHaveURL(url => url.pathname === base && url.searchParams.get('content') === fixture.first.id)
  await expect(firstHeading).toBeFocused()
  await expect(reader.getByText('Synthetischer Lerntext zum ersten Lernziel.', { exact: true })).toBeVisible()
  await capture(page, info, 'first-open', firstHeading)
  expect(saved()).toEqual([])
  expect(patches).toEqual([])

  async function complete(contentId: string, expectedIds: string[], allComplete: boolean) {
    const saving = page.waitForResponse(response => new URL(response.url()).pathname === progressPath && response.request().method() === 'PATCH')
    const refreshing = page.waitForResponse(response => new URL(response.url()).pathname === contentsPath && response.request().method() === 'GET')
    await keyboardActivate(page, reader.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true }))
    const changed = await saving
    expect(changed.status()).toBe(200)
    const progress = await changed.json() as Progress
    expect(progress.completedContentIds.sort()).toEqual([...expectedIds].sort())
    expect(progress.complete).toBe(allComplete)
    const refreshed = await refreshing
    expect(refreshed.status()).toBe(200)
    expect(saved()).toEqual([...expectedIds].sort())
    expect(patches.at(-1)).toEqual({ contentId, completed: true })
    await expect(reader.getByRole('button', { name: 'Abschlussmarkierung entfernen', exact: true })).toBeEnabled()
    return flatten(await refreshed.json() as LearnerNode[])
  }

  // Choose the theme before the real mutation, never after its success notice
  // starts. The existing completion keyboard helper remains unchanged.
  await page.getByRole('button', { name: 'Farbschema auswählen' }).click()
  await page.getByRole('menuitem', { name: 'Hell', exact: true }).click()
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
  const unlocked = await complete(fixture.first.id, [fixture.first.id], false)
  await captureActiveNoticeControls(page, info, true)
  expect(unlocked.find(node => node.id === fixture.next.id)?.locked).toBe(false)
  await expect(firstHeading).toBeVisible()
  await expect(page).toHaveURL(url => url.searchParams.get('content') === fixture.first.id)
  const next = reader.getByRole('button', { name: 'Nächste Lektion öffnen', exact: true })
  await expect(next).toBeEnabled()
  await expect(reader).toContainText(fixture.next.title)
  await capture(page, info, 'completed-with-next', next)
  expect(patches).toHaveLength(1)
  expect(saved()).toEqual([fixture.first.id])
  await page.reload()
  await expect(firstHeading).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Abschlussmarkierung entfernen', exact: true })).toBeVisible()
  await expect(next).toBeVisible()

  await page.goto(base)
  await expect(reader.getByRole('heading', { name: 'Dein nächster Lernschritt', exact: true })).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Weiterlernen', exact: true })).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Kurs starten', exact: true })).toHaveCount(0)
  await expect(reader).toContainText(fixture.next.title)
  await expect(firstHeading).toHaveCount(0)
  expect(new URL(page.url()).searchParams.has('content')).toBe(false)
  expect(patches).toHaveLength(1)
  await capture(page, info, 'resume', reader.getByRole('button', { name: 'Weiterlernen', exact: true }))
  await page.goto(`${base}?content=${fixture.first.id}`)
  await expect(firstHeading).toBeVisible()
  await keyboardActivate(page, next)
  await expect(page).toHaveURL(url => url.pathname === base && url.searchParams.get('content') === fixture.next.id)
  await expect(nextHeading).toBeFocused()
  await expect(reader.getByText('Synthetischer Lerntext zum nächsten Schritt.', { exact: true })).toBeVisible()
  expect(patches).toHaveLength(1)
  expect(saved()).toEqual([fixture.first.id])
  await capture(page, info, 'next-open', nextHeading)
  await page.reload()
  await expect(nextHeading).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true })).toBeVisible()
  expect(saved()).toEqual([fixture.first.id])

  await expect(page.locator('html')).toHaveClass(/\bdark\b/)
  await complete(fixture.next.id, [fixture.first.id, fixture.next.id], true)
  await captureActiveNoticeControls(page, info, false)
  await expect(nextHeading).toBeVisible()
  await expect(page).toHaveURL(url => url.searchParams.get('content') === fixture.next.id)
  await expect(next).toHaveCount(0)
  expect(patches).toHaveLength(2)
  await page.goto(base)
  const finished = reader.getByRole('heading', { name: 'Aktuelle Inhalte abgeschlossen', exact: true })
  await expect(finished).toBeVisible()
  await expect(reader.getByRole('button', { name: /^(Kurs starten|Weiterlernen|Nächste Lektion öffnen)$/ })).toHaveCount(0)
  await capture(page, info, 'all-current-complete')
  await captureCertificateReflow(page, info, fixture.fixtures.map(course => course.courseId), learnerId, 'complete-enabled')
  // Explicitly revisiting a completed lesson must survive reload, too.
  await page.goto(`${base}?content=${fixture.first.id}`)
  await page.reload()
  await expect(firstHeading).toBeVisible()
  await expect(page).toHaveURL(url => url.searchParams.get('content') === fixture.first.id)
  await expect(reader.getByRole('button', { name: 'Abschlussmarkierung entfernen', exact: true })).toBeVisible()
  await expect(next).toHaveCount(0)
  expect(saved()).toEqual([fixture.first.id, fixture.next.id].sort())
  expect(patches).toHaveLength(2)

  for (const [index, state] of ['empty', 'locked'].entries()) {
    const course = fixture.fixtures[index + 1]
    await page.goto(`/courses/${course.courseId}/contents`)
    if (state === 'empty') await expect(reader.getByRole('heading', { name: 'Noch keine Kursinhalte', exact: true })).toBeVisible()
    else await expect(reader.getByRole('heading', { name: 'Weitere Inhalte sind noch gesperrt', exact: true })).toBeVisible()
    await expect(reader.getByRole('heading', { name: 'Aktuelle Inhalte abgeschlossen', exact: true })).toHaveCount(0)
    await expect(reader.getByRole('button', { name: /^(Kurs starten|Weiterlernen|Nächste Lektion öffnen|Als abgeschlossen markieren)$/ })).toHaveCount(0)
    expect(new URL(page.url()).searchParams.has('content')).toBe(false)
    expect(storedCompleted(path, course.courseId, learnerId)).toEqual([])
    await capture(page, info, state)
  }
  await page.goto(`/courses/${fixture.fixtures[2].courseId}/contents?content=${fixture.locked.id}`)
  await expect(reader.getByText('Inhalt gesperrt', { exact: true })).toBeVisible()
  await expect(reader.getByText('Synthetischer gesperrter Lerntext.', { exact: true })).toHaveCount(0)
  await expect(reader.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true })).toHaveCount(0)
  expect(patches).toHaveLength(2)
})
