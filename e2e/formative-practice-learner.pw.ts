import { randomUUID } from 'node:crypto'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const courseId = 'qa-learner-practice'
const endpoint = `/api/courses/${courseId}/practice/learner`

const reviewViewports = [
  { width: 320, height: 700 },
  { width: 375, height: 850 },
  { width: 414, height: 850 },
  { width: 768, height: 850 },
  { width: 1280, height: 800 },
]

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.getByRole('button', { name: 'Farbschema auswählen' }).click()
  await page.getByRole('menuitem', { name: theme === 'light' ? 'Hell' : 'Dunkel', exact: true }).click()
  if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
  else await expect(page.locator('html')).not.toHaveClass(/dark/)
}

async function checkDecision(page: Page, actionName: string) {
  const action = page.getByRole('button', { name: actionName, exact: true })
  const notice = page.getByRole('complementary', { name: 'Privat und freiwillig' })
  await page.evaluate(async () => { await document.fonts.ready })
  await expect(action).toBeVisible()
  await expect(notice).toBeVisible()
  await expect(notice.getByText('Deine Antworten und deine optionale Sicherheitseinschätzung werden für deine private Übung gespeichert.', { exact: true })).toBeVisible()
  await expect(notice.getByText('Kein Einfluss auf Kursabschluss, Prüfungen, Zertifikate oder Belohnungen. Keine persönliche Übungsauswertung für Lehrende.', { exact: true })).toBeVisible()
  const decision = await notice.evaluate((element, name) => {
    const button = Array.from(document.querySelectorAll('button')).find(candidate => candidate.textContent === name)
    if (!button) return null
    // Read both rectangles in one layout/scroll snapshot after font readiness.
    const noticeBox = element.getBoundingClientRect()
    const actionBox = button.getBoundingClientRect()
    return {
      noticeBeforeAction: Boolean(element.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING),
      noticeBottom: noticeBox.bottom,
      actionTop: actionBox.top,
    }
  }, actionName)
  expect(decision).not.toBeNull()
  expect(decision!.noticeBeforeAction).toBe(true)
  expect(decision!.noticeBottom).toBeLessThanOrEqual(decision!.actionTop)
  const disclosure = notice.locator('summary')
  const details = notice.locator('details')
  await expect(details).not.toHaveAttribute('open')
  await page.getByRole('link', { name: 'Zum Kursinhalt' }).focus()
  await page.keyboard.press('Tab')
  await expect(disclosure).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(details).toHaveAttribute('open', '')
  await expect(details).toContainText('12 Kalendermonaten ohne Übungsaktivität zur automatischen Löschung fällig')
  await expect(details).toContainText('technische Belege zur Antwortübermittlung nach 90 Tagen')
  await expect(details).toContainText('Bei Störungen oder Rückstand kann sich die Löschung verzögern.')
  await expect(details).toContainText('Mit „Zurücksetzen“ löschst du deine Übungsdaten samt diesen technischen Belegen sofort.')
  await page.keyboard.press('Space')
  await expect(details).not.toHaveAttribute('open')
  await page.keyboard.press('Tab')
  await expect(action).toBeFocused()
  await expect(page.locator('main input[type="checkbox"]')).toHaveCount(0)
}

async function captureState(page: Page, testInfo: TestInfo, label: string, actionName?: string, allWidths = false) {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const viewport of allWidths ? reviewViewports : [reviewViewports[0], reviewViewports[4]]) {
      await page.setViewportSize(viewport)
      if (actionName) await checkDecision(page, actionName)
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0) })
      const actual = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))
      expect(actual, `${label} ${theme} ${viewport.width}px overflow`).toBeLessThanOrEqual(viewport.width + 1)
      await page.screenshot({ path: testInfo.outputPath(`learner-practice-${label}-${theme}-${viewport.width}.png`), fullPage: true, animations: 'disabled' })
      if (actionName && (viewport.width === 320 || viewport.width === 1280)) {
        const details = page.getByRole('complementary', { name: 'Privat und freiwillig' }).locator('details')
        await details.locator('summary').focus()
        await page.keyboard.press('Enter')
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: testInfo.outputPath(`learner-practice-${label}-details-${theme}-${viewport.width}.png`), fullPage: true, animations: 'disabled' })
        await page.keyboard.press('Space')
        await expect(details).not.toHaveAttribute('open')
      }
    }
  }
}

async function captureConfirmation(page: Page, testInfo: TestInfo, label: string, title: string, openAction: string, cancelAction: string) {
  const dialog = page.getByRole('alertdialog', { name: title })
  await dialog.getByRole('button', { name: cancelAction, exact: true }).click()
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    for (const viewport of [reviewViewports[0], reviewViewports[4]]) {
      await page.setViewportSize(viewport)
      await page.getByRole('button', { name: openAction, exact: true }).click()
      await expect(dialog).toBeVisible()
      await page.evaluate(async () => { await document.fonts.ready })
      expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth))).toBeLessThanOrEqual(viewport.width + 1)
      await page.screenshot({ path: testInfo.outputPath(`learner-practice-${label}-${theme}-${viewport.width}.png`), fullPage: true, animations: 'disabled' })
      await dialog.getByRole('button', { name: cancelAction, exact: true }).click()
    }
  }
  await page.getByRole('button', { name: openAction, exact: true }).click()
  await expect(dialog).toBeVisible()
}

test('private learner practice stays opt-in and advances only on explicit actions at 320–1280px', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One synthetic browser journey checks all review widths.')
  const nonce = randomUUID()
  const email = `practice-ui-${nonce}@example.test`
  const password = `PracticeUiA1!${nonce}`
  const registered = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name: 'Practice UI Learner', email, password } })
  expect(registered.status(), await registered.text()).toBe(201)
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)

  const pending = { reservationId: 'reservation-1', ordinal: 1, item: { itemId: 'item-1', itemRevision: 1,
    objectiveTitle: 'Kursbegriffe', prompt: 'Welche Aussage stimmt?', options: ['Erste Aussage', 'Zweite Aussage'] } }
  let state: Record<string, unknown> = { status: 'available', dueCount: 1, publicationId: 'publication-1', snapshotId: 'snapshot-1' }
  const writes: Array<{ path: string; body: Record<string, unknown> }> = []
  let readFailure = false
  let pendingRead: Promise<void> | null = null
  await page.route(`**${endpoint}**`, async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (method === 'GET' && path === endpoint) {
      if (pendingRead) await pendingRead
      return route.fulfill({ status: readFailure ? 500 : 200, json: readFailure ? { error: 'Die Übung konnte nicht geladen werden.' } : state })
    }
    const body = route.request().postDataJSON() as Record<string, unknown>
    writes.push({ path, body })
    if (path.endsWith('/opt-in')) state = { status: 'ready', dueCount: 1 }
    if (path.endsWith('/start')) state = { status: 'active', dueCount: 1, session: { id: 'session-1', answeredCount: 0, pending } }
    if (path.endsWith('/answer')) return route.fulfill({ status: 200, json: { correct: false, correctIndex: 1,
      explanation: 'Die zweite Aussage passt zum Kurs.', nextDueAt: null, canContinue: true, answeredCount: 1 } })
    if (path.endsWith('/next')) state = { status: 'active', dueCount: 1, session: { id: 'session-1', answeredCount: 1,
      pending: { ...pending, reservationId: 'reservation-2', ordinal: 2 } } }
    if (path.endsWith('/pause')) state = { status: 'paused', dueCount: 1, session: { id: 'session-1', answeredCount: 1 } }
    if (path.endsWith('/opt-out')) state = { status: 'available', dueCount: 0 }
    if (path.endsWith('/reset/prepare')) return route.fulfill({ status: 200, json: { token: 'one-use-token' } })
    if (path.endsWith('/reset')) state = { status: 'available', dueCount: 1 }
    return route.fulfill({ status: 200, json: {} })
  })

  await page.goto(`/courses/${courseId}/practice/learn`)
  await expect(page.getByRole('heading', { level: 1, name: 'Privat üben' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(writes).toHaveLength(0)
  await expect(page.getByText('Standardmäßig ausgeschaltet. Du öffnest jede Frage selbst.')).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await captureState(page, testInfo, 'opt-in', 'Privates Üben einschalten', true)
  expect(writes).toHaveLength(0)
  await setTheme(page, 'light')
  await page.setViewportSize({ width: 320, height: 700 })
  await page.screenshot({ path: testInfo.outputPath('learner-practice-opt-in-320.png'), fullPage: true, animations: 'disabled' })

  await page.getByRole('button', { name: 'Privates Üben einschalten' }).click()
  await expect(page.getByRole('button', { name: 'Erste Frage öffnen' })).toBeVisible()
  expect(writes.map(write => write.path)).toEqual([`${endpoint}/opt-in`])
  await page.getByRole('button', { name: 'Erste Frage öffnen' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('group', { name: 'Welche Aussage stimmt?' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Wie sicher bist du dir?' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Antwort prüfen' })).toBeDisabled()
  expect(writes.map(write => write.path)).toEqual([`${endpoint}/opt-in`, `${endpoint}/start`])
  await captureState(page, testInfo, 'question')
  await page.getByRole('radio', { name: 'Erste Aussage' }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('radio', { name: 'Unsicher' }).check()
  await page.getByRole('button', { name: 'Antwort prüfen' }).click()
  await expect(page.getByRole('heading', { name: 'Eine andere Antwort war vorgesehen.' })).toBeVisible()
  await expect(page.getByText('Vorgesehene Antwort: Zweite Aussage')).toBeVisible()
  expect(writes[2]).toMatchObject({ path: `${endpoint}/answer`, body: { sessionId: 'session-1', reservationId: 'reservation-1', optionIndex: 0, confidence: 'UNSURE' } })
  expect(writes).toHaveLength(3)
  await captureState(page, testInfo, 'feedback')
  await page.getByRole('button', { name: 'Weitere Frage öffnen' }).click()
  await expect(page.getByRole('group', { name: 'Welche Aussage stimmt?' })).toBeVisible()
  expect(writes[3]).toEqual({ path: `${endpoint}/next`, body: { sessionId: 'session-1' } })

  await page.getByText('Übung verwalten').click()
  await page.getByRole('button', { name: 'Üben pausieren' }).click()
  const pause = page.getByRole('alertdialog', { name: 'Privates Üben pausieren?' })
  await expect(pause).toBeVisible()
  await captureConfirmation(page, testInfo, 'pause-confirmation', 'Privates Üben pausieren?', 'Üben pausieren', 'Weiter üben')
  expect(writes).toHaveLength(4)
  await pause.getByRole('button', { name: 'Üben pausieren' }).click()
  await expect(page.getByRole('heading', { name: 'Privates Üben ist pausiert' })).toBeVisible()
  expect(writes.at(-1)?.path).toBe(`${endpoint}/pause`)
  const pausedWrites = writes.length
  await captureState(page, testInfo, 'paused', 'Üben wieder einschalten')
  expect(writes).toHaveLength(pausedWrites)

  await page.getByRole('button', { name: 'Privates Üben ausschalten' }).click()
  const optOut = page.getByRole('alertdialog', { name: 'Privates Üben ausschalten?' })
  await expect(optOut).toContainText('Übungsdaten bleiben gespeichert')
  await captureConfirmation(page, testInfo, 'opt-out-confirmation', 'Privates Üben ausschalten?', 'Privates Üben ausschalten', 'Abbrechen')
  expect(writes).toHaveLength(pausedWrites)
  await optOut.getByRole('button', { name: 'Privates Üben ausschalten' }).click()
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(writes.at(-1)?.path).toBe(`${endpoint}/opt-out`)
  await checkDecision(page, 'Privates Üben einschalten')

  await page.getByRole('button', { name: 'Übungsdaten zurücksetzen' }).click()
  const reset = page.getByRole('alertdialog', { name: 'Übungsdaten endgültig löschen?' })
  await expect(reset.getByRole('button', { name: 'Übungsdaten endgültig löschen' })).toBeDisabled()
  const beforeReset = writes.length
  await captureConfirmation(page, testInfo, 'reset-confirmation', 'Übungsdaten endgültig löschen?', 'Übungsdaten zurücksetzen', 'Abbrechen')
  expect(writes).toHaveLength(beforeReset)
  await reset.getByRole('textbox', { name: 'Zur Bestätigung RESET eingeben' }).fill('RESET')
  await reset.getByRole('button', { name: 'Übungsdaten endgültig löschen' }).click()
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(writes.slice(-2)).toEqual([
    { path: `${endpoint}/reset/prepare`, body: {} },
    { path: `${endpoint}/reset`, body: { token: 'one-use-token', confirmation: 'RESET_MY_PRACTICE' } },
  ])
  const finalWrites = writes.length
  readFailure = true
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Übung konnte nicht geladen werden' })).toBeVisible()
  await captureState(page, testInfo, 'error')
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toHaveCount(0)
  readFailure = false
  let releaseRead!: () => void
  pendingRead = new Promise<void>(resolve => { releaseRead = resolve })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Übungen werden geladen' })).toBeVisible()
  await captureState(page, testInfo, 'loading')
  releaseRead()
  pendingRead = null
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(writes).toHaveLength(finalWrites)
})
