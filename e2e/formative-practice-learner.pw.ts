import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const courseId = 'qa-learner-practice'
const endpoint = `/api/courses/${courseId}/practice/learner`

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
  await page.route(`**${endpoint}**`, async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (method === 'GET' && path === endpoint) return route.fulfill({ status: 200, json: state })
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
  for (const width of [320, 375, 414, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 })
    const actual = await page.evaluate(() => ({ html: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
    expect(actual.html, `${width}px html overflow`).toBeLessThanOrEqual(width + 1)
    expect(actual.body, `${width}px body overflow`).toBeLessThanOrEqual(width + 1)
    await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  }
  await page.setViewportSize({ width: 320, height: 700 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(async () => { await document.fonts.ready })
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
  await page.getByRole('radio', { name: 'Erste Aussage' }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('radio', { name: 'Unsicher' }).check()
  await page.getByRole('button', { name: 'Antwort prüfen' }).click()
  await expect(page.getByRole('heading', { name: 'Eine andere Antwort war vorgesehen.' })).toBeVisible()
  await expect(page.getByText('Vorgesehene Antwort: Zweite Aussage')).toBeVisible()
  expect(writes[2]).toMatchObject({ path: `${endpoint}/answer`, body: { sessionId: 'session-1', reservationId: 'reservation-1', optionIndex: 0, confidence: 'UNSURE' } })
  expect(writes).toHaveLength(3)
  await page.getByRole('button', { name: 'Weitere Frage öffnen' }).click()
  await expect(page.getByRole('group', { name: 'Welche Aussage stimmt?' })).toBeVisible()
  expect(writes[3]).toEqual({ path: `${endpoint}/next`, body: { sessionId: 'session-1' } })

  await page.getByText('Übung verwalten').click()
  await page.getByRole('button', { name: 'Üben pausieren' }).click()
  const pause = page.getByRole('alertdialog', { name: 'Privates Üben pausieren?' })
  await expect(pause).toBeVisible()
  await pause.getByRole('button', { name: 'Üben pausieren' }).click()
  await expect(page.getByRole('heading', { name: 'Privates Üben ist pausiert' })).toBeVisible()
  expect(writes.at(-1)?.path).toBe(`${endpoint}/pause`)

  await page.getByRole('button', { name: 'Privates Üben ausschalten' }).click()
  const optOut = page.getByRole('alertdialog', { name: 'Privates Üben ausschalten?' })
  await expect(optOut).toContainText('Übungsdaten bleiben gespeichert')
  await optOut.getByRole('button', { name: 'Privates Üben ausschalten' }).click()
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(writes.at(-1)?.path).toBe(`${endpoint}/opt-out`)

  await page.getByRole('button', { name: 'Übungsdaten zurücksetzen' }).click()
  const reset = page.getByRole('alertdialog', { name: 'Übungsdaten endgültig löschen?' })
  await expect(reset.getByRole('button', { name: 'Übungsdaten endgültig löschen' })).toBeDisabled()
  await reset.getByRole('textbox', { name: 'Zur Bestätigung RESET eingeben' }).fill('RESET')
  await reset.getByRole('button', { name: 'Übungsdaten endgültig löschen' }).click()
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(writes.slice(-2)).toEqual([
    { path: `${endpoint}/reset/prepare`, body: {} },
    { path: `${endpoint}/reset`, body: { token: 'one-use-token', confirmation: 'RESET_MY_PRACTICE' } },
  ])
})
