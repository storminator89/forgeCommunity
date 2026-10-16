import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Page, type TestInfo } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'

function disposablePath() {
  const url = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (url.protocol !== 'http:' || url.origin !== origin || url.port !== '3013' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' || !isAbsolute(path) ||
    basename(path) !== 'forge-browser-qa.db' || !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Practice return QA requires the loopback disposable SQLite fixture.')
  }
  return path
}
function database<T>(path: string, action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path)
  try { db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000'); return action(db) } finally { db.close() }
}
async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}
async function capture(page: Page, testInfo: TestInfo, label: string, controls: string[] = []) {
  for (const theme of ['light', 'dark'] as const) {
    await page.getByRole('button', { name: 'Farbschema auswählen' }).click()
    await page.getByRole('menuitem', { name: theme === 'light' ? 'Hell' : 'Dunkel', exact: true }).click()
    if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
    else await expect(page.locator('html')).not.toHaveClass(/dark/)
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 800 })
      await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0) })
      expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1)
      for (const name of controls) {
        const control = page.getByRole('button', { name, exact: true })
        const box = await control.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.height).toBeGreaterThanOrEqual(44)
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
        expect(await control.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      }
      await page.screenshot({ path: testInfo.outputPath(`practice-availability-${label}-${theme}-${width}.png`), fullPage: true, animations: 'disabled' })
    }
  }
}

async function captureEnlargedControls(page: Page, testInfo: TestInfo, label: string, names: string[]) {
  for (const theme of ['light', 'dark'] as const) {
    await page.getByRole('button', { name: 'Farbschema auswählen' }).click()
    await page.getByRole('menuitem', { name: theme === 'light' ? 'Hell' : 'Dunkel', exact: true }).click()
    await page.setViewportSize({ width: 320, height: 800 })
    try {
      await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
      await expect(page.locator('html')).toHaveCSS('font-size', '32px')
      await page.evaluate(async () => { await document.fonts.ready })
      for (const name of names) {
        const control = page.getByRole('button', { name, exact: true })
        await expect(control).toBeVisible()
        await expect(control).toHaveCSS('white-space', 'normal')
        const box = await control.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.height).toBeGreaterThanOrEqual(44)
        expect(box!.x).toBeGreaterThanOrEqual(0)
        expect(box!.x + box!.width).toBeLessThanOrEqual(321)
        expect(await control.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
        await control.focus()
        await expect(control).toBeFocused()
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({ path: testInfo.outputPath(`practice-availability-${label}-${theme}-320-text-200.png`), fullPage: true, animations: 'disabled' })
    } finally {
      await page.evaluate(() => { document.documentElement.style.fontSize = '' })
    }
  }
}

test('real private return window stays read-only until explicit refresh and reopen', async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One real disposable journey captures desktop and 320px in both themes.')
  test.setTimeout(240_000)
  const path = disposablePath()
  const nonce = randomUUID()
  const password = `AvailabilityA1!${nonce}`
  const authorEmail = `practice-return-author-${nonce}@example.test`
  const learnerEmail = `practice-return-learner-${nonce}@example.test`
  const ids: string[] = []
  for (const email of [authorEmail, learnerEmail]) {
    const result = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name: 'Synthetic private return fixture', email, password } })
    expect(result.status(), await result.text()).toBe(201)
    ids.push((await result.json() as { userId: string }).userId)
  }
  const [authorId, learnerId] = ids
  const courseId = `practice-return-${nonce}`
  const publicationId = `return-publication-${nonce}`
  const contentId = `return-content-${nonce}`
  const payload = JSON.stringify({ schemaVersion: 1, contents: [{ id: contentId, parentId: null, title: 'Synthetic lesson', order: 1, type: 'TEXT', content: '<p>Private return fixture.</p>' }] })
  database(path, db => {
    db.exec('BEGIN')
    try {
      db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('INSTRUCTOR', authorId)
      db.prepare('INSERT INTO "Course" ("id", "title", "description", "instructorId", "price", "updatedAt") VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)')
        .run(courseId, 'Synthetic return practice', 'Disposable private practice', authorId)
      db.prepare('INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "type", "updatedAt") VALUES (?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP)')
        .run(contentId, 'Synthetic lesson', '<p>Private return fixture.</p>', courseId, 'TEXT')
      db.prepare('INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount") VALUES (?, ?, 1, ?, ?, ?, 1)')
        .run(publicationId, courseId, 'AUTHOR', payload, nonce)
      db.prepare('INSERT INTO "CourseDraft" ("courseId", "basePublicationId", "payload", "digest", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
        .run(courseId, publicationId, payload, nonce)
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(publicationId, courseId)
      db.prepare('INSERT INTO "Enrollment" ("id", "userId", "courseId") VALUES (?, ?, ?)').run(randomUUID(), learnerId, courseId)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
  const learnerPath = `/api/courses/${courseId}/practice/learner`
  const workspace = `/courses/${courseId}/practice/learn`
  const reader = `/courses/${courseId}/contents`
  const author = await browser.newContext({ baseURL: origin })
  try {
    await login(await author.newPage(), authorEmail, password)
    const objectiveResponse = await author.request.post(`${origin}/api/courses/practice/objectives`, { headers: { origin }, data: { title: 'Synthetic return window' } })
    expect(objectiveResponse.status()).toBe(201)
    const objective = await objectiveResponse.json() as { id: string; revision: number }
    const itemResponse = await author.request.post(`${origin}/api/courses/practice/objectives/${objective.id}/items`, { headers: { origin }, data: { choice: { type: 'SINGLE_CHOICE', prompt: 'Which return fixture answer fits?', options: ['Synthetic wrong answer', 'Synthetic taught answer'], correctIndex: 1, explanation: 'The second synthetic option fits.' } } })
    expect(itemResponse.status()).toBe(201)
    const item = await itemResponse.json() as { id: string; latestRevision: number }
    const saved = await author.request.patch(`${origin}/api/courses/${courseId}/practice/authoring`, { headers: { origin }, data: { expectedRevision: 0, items: [{ objectiveId: objective.id, objectiveRevision: objective.revision, itemId: item.id, itemRevision: item.latestRevision }] } })
    expect(saved.status()).toBe(200)
    const published = await author.request.post(`${origin}/api/courses/${courseId}/practice/authoring/publish`, { headers: { origin }, data: { expectedRevision: 1, expectedActivePublicationId: publicationId, requestId: randomUUID() } })
    expect(published.status()).toBe(200)
  } finally { await author.close() }

  await login(page, learnerEmail, password)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const evidence = () => database(path, db => ({
    setting: db.prepare('SELECT * FROM "PracticeLearnerSetting" WHERE "userId" = ? AND "courseId" = ?').all(learnerId, courseId),
    sessions: db.prepare('SELECT * FROM "PracticeLearnerSession" WHERE "userId" = ? AND "courseId" = ?').all(learnerId, courseId),
    reservations: db.prepare('SELECT r.* FROM "PracticeLearnerReservation" r JOIN "PracticeLearnerSession" s ON s."id" = r."sessionId" WHERE s."userId" = ? AND s."courseId" = ?').all(learnerId, courseId),
  }))
  const practiceRequests: Array<{ method: string; pathname: string }> = []
  page.on('request', request => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith(learnerPath)) practiceRequests.push({ method: request.method(), pathname })
  })
  const before = evidence()
  await page.goto(reader)
  const readerLink = page.getByRole('link', { name: 'Privat üben', exact: true })
  await expect(readerLink).toHaveAttribute('href', workspace)
  await expect(page.getByText('Freiwillige Fragen ohne Einfluss auf den Kursabschluss.', { exact: true })).toBeVisible()
  expect(evidence()).toEqual(before)
  await readerLink.click()
  await expect(page).toHaveURL(`${origin}${workspace}`)
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(evidence()).toEqual(before)
  await page.getByRole('button', { name: 'Privates Üben einschalten' }).click()
  await page.getByRole('button', { name: 'Erste Frage öffnen' }).click()
  await page.getByRole('radio', { name: 'Synthetic wrong answer' }).check()
  await page.getByRole('radio', { name: 'Sicher', exact: true }).check()
  await page.getByRole('button', { name: 'Antwort prüfen' }).click()
  await expect(page.getByRole('heading', { name: 'Eine andere Antwort war vorgesehen.' })).toBeVisible()
  await expect(page.getByText(/Voraussichtlich wieder ab/)).toBeVisible()
  const state = await (await page.request.get(`${origin}${learnerPath}`)).json() as { availability: string; nextAvailableAt: string; dueCount: number }
  expect(state).toMatchObject({ availability: 'waiting', dueCount: 0 })
  expect(new Date(state.nextAvailableAt).getTime() - Date.now()).toBeGreaterThan(23 * 3600_000)
  await page.getByRole('button', { name: 'Für jetzt beenden' }).click()
  await expect(page.getByRole('button', { name: 'Stand aktualisieren' })).toBeVisible()
  const waitingEvidence = evidence()
  const refresh = page.getByRole('button', { name: 'Stand aktualisieren' })
  await refresh.focus()
  await expect(refresh).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Voraussichtlich wieder ab/)).toBeVisible()
  await page.reload()
  await expect(page.getByText(/Voraussichtlich wieder ab/)).toBeVisible()
  expect(evidence()).toEqual(waitingEvidence)
  await capture(page, testInfo, 'waiting', ['Stand aktualisieren'])
  await captureEnlargedControls(page, testInfo, 'waiting-refresh', ['Stand aktualisieren'])
  await page.getByRole('link', { name: 'Zum Kursinhalt', exact: true }).click()
  await expect(page).toHaveURL(`${origin}${reader}`)
  // Scope assertions to the real existing reader entry, rather than another
  // date or refresh control elsewhere in the course reader.
  const readerEntry = readerLink.locator('..').locator('..')
  await expect(readerEntry.locator('time')).toHaveAttribute('datetime', state.nextAvailableAt)
  await expect(readerEntry.getByText(/Voraussichtlich wieder ab/)).toBeVisible()
  const beforeEntryRefresh = evidence()
  const requestsBeforeEntryRefresh = practiceRequests.length
  const waitingRefresh = page.waitForResponse(response => new URL(response.url()).pathname === learnerPath && response.request().method() === 'GET')
  await readerEntry.getByRole('button', { name: 'Stand aktualisieren', exact: true }).click()
  const waitingResponse = await waitingRefresh
  expect(waitingResponse.status()).toBe(200)
  expect(await waitingResponse.json()).toMatchObject({ availability: 'waiting', dueCount: 0, nextAvailableAt: state.nextAvailableAt })
  await expect(readerEntry.getByRole('button', { name: 'Stand aktualisieren', exact: true })).toBeEnabled()
  expect(practiceRequests.slice(requestsBeforeEntryRefresh).every(request => request.method === 'GET')).toBe(true)
  expect(evidence()).toEqual(beforeEntryRefresh)
  await capture(page, testInfo, 'reader-waiting', ['Stand aktualisieren'])
  await readerLink.click()
  await expect(page).toHaveURL(`${origin}${workspace}`)
  await expect(page.getByRole('button', { name: 'Stand aktualisieren', exact: true })).toBeVisible()
  // Existing legacy ACTIVE/no-pending session fixture: exercise the real close
  // endpoint and its controls without selecting another private question.
  database(path, db => db.prepare('UPDATE "PracticeLearnerSession" SET "status" = ? WHERE "userId" = ? AND "courseId" = ?').run('ACTIVE', learnerId, courseId))
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sitzung abschließen', exact: true })).toBeVisible()
  await capture(page, testInfo, 'close', ['Sitzung abschließen', 'Stand aktualisieren'])
  await captureEnlargedControls(page, testInfo, 'close-refresh', ['Sitzung abschließen', 'Stand aktualisieren'])
  const beforeClose = evidence()
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  const close = page.getByRole('button', { name: 'Sitzung abschließen', exact: true })
  await close.focus()
  await expect(close).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(close).toHaveCount(0)
  expect(evidence().reservations).toEqual(beforeClose.reservations)
  expect(evidence().setting).toEqual(beforeClose.setting)
  await page.getByRole('button', { name: 'Stand aktualisieren' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText(/Voraussichtlich wieder ab/)).toBeVisible()
  expect(evidence().reservations).toEqual(beforeClose.reservations)
  await page.evaluate(() => { document.documentElement.style.fontSize = '' })
  await page.getByRole('link', { name: 'Zum Kursinhalt', exact: true }).click()
  await expect(readerEntry.locator('time')).toHaveAttribute('datetime', state.nextAvailableAt)

  // Existing real-practice fixture pattern: advance only this disposable row's
  // shown/due windows. No production clock bypass, waiting loop or GET write.
  const earlier = Date.now() - 25 * 3600_000
  database(path, db => {
    db.prepare('UPDATE "PracticeLearnerReservation" SET "shownAt" = ? WHERE "sessionId" IN (SELECT "id" FROM "PracticeLearnerSession" WHERE "userId" = ? AND "courseId" = ?)').run(earlier, learnerId, courseId)
    db.prepare('UPDATE "PracticeLearnerSchedule" SET "dueAt" = ? WHERE "userId" = ? AND "courseId" = ?').run(earlier, learnerId, courseId)
  })
  const beforeReadyRead = evidence()
  const requestsBeforeReadyRefresh = practiceRequests.length
  const readyRefresh = page.waitForResponse(response => new URL(response.url()).pathname === learnerPath && response.request().method() === 'GET')
  await readerEntry.getByRole('button', { name: 'Stand aktualisieren', exact: true }).click()
  const readyResponse = await readyRefresh
  expect(readyResponse.status()).toBe(200)
  expect(await readyResponse.json()).toMatchObject({ availability: 'ready', dueCount: 1, nextAvailableAt: null })
  await expect(readerEntry.getByText('1 Frage ist jetzt verfügbar.', { exact: true })).toBeVisible()
  await expect(readerEntry.locator('time')).toHaveCount(0)
  expect(practiceRequests.slice(requestsBeforeReadyRefresh).every(request => request.method === 'GET')).toBe(true)
  expect(evidence()).toEqual(beforeReadyRead)
  await capture(page, testInfo, 'reader-ready')
  await readerLink.click()
  await expect(page).toHaveURL(`${origin}${workspace}`)
  await expect(page.getByRole('button', { name: 'Erste Frage öffnen' })).toBeVisible()
  expect(evidence()).toEqual(beforeReadyRead)
  await page.getByRole('button', { name: 'Erste Frage öffnen' }).click()
  await expect(page.getByRole('group', { name: 'Which return fixture answer fits?' })).toBeVisible()
  expect(evidence().reservations).toHaveLength(2)

  const health = database(path, db => db.prepare('SELECT "lastSuccessAt" FROM "PracticeRetentionHealth" WHERE "id" = ?').get('learner')) as { lastSuccessAt: number }
  try {
    database(path, db => db.prepare('UPDATE "PracticeRetentionHealth" SET "lastSuccessAt" = ? WHERE "id" = ?').run(Date.now() - 46 * 60_000, 'learner'))
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Privates Üben gerade nicht verfügbar' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Which return fixture answer fits?' })).toHaveCount(0)
    await capture(page, testInfo, 'unavailable')
  } finally {
    database(path, db => db.prepare('UPDATE "PracticeRetentionHealth" SET "lastSuccessAt" = ? WHERE "id" = ?').run(health.lastSuccessAt, 'learner'))
  }
  await page.getByRole('button', { name: 'Stand aktualisieren' }).click()
  await expect(page.getByRole('group', { name: 'Which return fixture answer fits?' })).toBeVisible()
  expect(evidence().reservations).toHaveLength(2)
  database(path, db => db.prepare('DELETE FROM "Enrollment" WHERE "userId" = ? AND "courseId" = ?').run(learnerId, courseId))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Kein Zugang zu dieser Übung' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Which return fixture answer fits?' })).toHaveCount(0)
})
