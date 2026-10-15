import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Locator, type Page } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const testedHead = /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')
  ? process.env.GITHUB_SHA!.slice(0, 12) : 'local-unverified-head'

// This journey may write only to the existing browser-qa job's disposable DB.
function disposableDatabasePath() {
  const browserOrigin = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Formative author browser QA requires the loopback, disposable SQLite fixture.')
  }
  return path
}

function seedPublishedCourse(path: string, instructorId: string, nonce: string) {
  const courseId = `formative-qa-${nonce}`
  const contentId = `lesson-${nonce}`
  const publicationId = `publication-${nonce}`
  const content = '<p>Synthetic lesson for formative author browser QA.</p>'
  const payload = JSON.stringify({ schemaVersion: 1, contents: [{ id: contentId, parentId: null,
    title: 'Synthetic lesson', order: 1, type: 'TEXT', content }] })
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN')
    db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "price", "updatedAt")
      VALUES (?, 'Synthetic formative author course', 'Disposable browser fixture', ?, 0, CURRENT_TIMESTAMP)`)
      .run(courseId, instructorId)
    db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "type", "updatedAt")
      VALUES (?, 'Synthetic lesson', ?, 1, ?, 'TEXT', CURRENT_TIMESTAMP)`).run(contentId, content, courseId)
    db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
      VALUES (?, ?, 1, 'AUTHOR', ?, ?, 1)`).run(publicationId, courseId, payload, `qa-${nonce}`)
    db.prepare(`INSERT INTO "CourseDraft" ("courseId", "basePublicationId", "payload", "digest", "updatedAt")
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(courseId, publicationId, payload, `qa-${nonce}`)
    db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(publicationId, courseId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally { db.close() }
  return { courseId, publicationId }
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}

async function assertNoHorizontalLoss(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth,
    document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1)
  const actions = page.getByRole('button', { name: /^(Vorschau|Veröffentlichung prüfen|Diese Übungsfassung veröffentlichen)$/ })
  expect(await actions.evaluateAll(buttons => buttons.every(button => {
    const box = button.getBoundingClientRect()
    return box.left >= -1 && box.right <= innerWidth + 1
  }))).toBe(true)
}

async function assertTextPaintFits(locator: Locator) {
  const bounds = await locator.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const lines = Array.from(range.getClientRects())
    return { lineCount: lines.length, fits: lines.every(line => line.left >= -1 && line.right <= innerWidth + 1) }
  })
  expect(bounds.lineCount).toBeGreaterThan(0)
  expect(bounds.fits).toBe(true)
}

test('instructor pins an immutable practice version, previews, publishes and reviews history; learner is isolated', async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One disposable journey resizes the populated author view to 320px.')
  test.setTimeout(240_000)
  const databasePath = disposableDatabasePath()
  const nonce = randomUUID()
  const instructorEmail = `formative-instructor-${nonce}@example.test`
  const learnerEmail = `formative-learner-${nonce}@example.test`
  const password = `FormativeQA1!${nonce}`
  let instructorId = ''
  for (const [email, name] of [[instructorEmail, 'Synthetic Formative Instructor'],
    [learnerEmail, 'Synthetic Formative Learner']]) {
    const registration = await request.post(`${origin}/api/register`, {
      headers: { origin }, data: { name, email, password },
    })
    expect(registration.status(), await registration.text()).toBe(201)
    if (email === instructorEmail) {
      instructorId = (await registration.json() as { userId: string }).userId
      const db = new DatabaseSync(databasePath)
      try { db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('INSTRUCTOR', instructorId) }
      finally { db.close() }
    }
  }
  expect(instructorId).toBeTruthy()
  const { courseId, publicationId } = seedPublishedCourse(databasePath, instructorId, nonce)
  const authorPath = `/api/courses/${courseId}/practice/authoring`
  const poolPath = '/api/courses/practice'
  expect((await request.get(`${origin}${authorPath}`)).status()).toBe(401)

  await login(page, instructorEmail, password)
  const initial = await page.request.get(`${origin}${authorPath}`)
  expect(initial.status()).toBe(200)
  expect(await initial.json()).toMatchObject({ draft: { revision: 0, payload: { items: [] } },
    activeCoursePublicationId: publicationId, activeSnapshot: null })

  const objectiveTitle = `SyntheticObjective${'UnbrokenMobileTitle'.repeat(6)}`
  const longOption = `SyntheticAnswer${'UnbrokenMobileOption'.repeat(6)}`
  const promptV1 = 'Which synthetic step comes first?'
  const promptV2 = 'Which synthetic step comes first, revised?'
  const explanation = 'Synthetic answer key for this disposable author-only test.'
  const objectiveCreated = await page.request.post(`${origin}${poolPath}/objectives`, {
    headers: { origin }, data: { title: objectiveTitle, description: 'A synthetic learning goal.' },
  })
  expect(objectiveCreated.status(), await objectiveCreated.text()).toBe(201)
  const objective = await objectiveCreated.json() as { id: string; revision: number }
  const choice = { type: 'SINGLE_CHOICE', prompt: promptV1, options: [longOption, 'First'],
    correctIndex: 1, explanation }
  const itemCreated = await page.request.post(`${origin}${poolPath}/objectives/${objective.id}/items`, {
    headers: { origin }, data: { choice },
  })
  expect(itemCreated.status(), await itemCreated.text()).toBe(201)
  const item = await itemCreated.json() as { id: string; latestRevision: number }
  expect(item.latestRevision).toBe(1)
  const itemRevised = await page.request.patch(`${origin}${poolPath}/items/${item.id}`, {
    headers: { origin }, data: { expectedRevision: 1, choice: { ...choice, prompt: promptV2 } },
  })
  expect(itemRevised.status(), await itemRevised.text()).toBe(200)
  expect((await itemRevised.json() as { latestRevision: number }).latestRevision).toBe(2)
  const listing = await page.request.get(`${origin}${poolPath}/objectives/${objective.id}/items`)
  expect(listing.status()).toBe(200)
  const listingText = await listing.text()
  expect(listingText).toContain(promptV2)
  expect(listingText).not.toContain(explanation)
  expect(listingText).not.toContain('correctIndex')

  await page.goto(`/courses/${courseId}/practice`)
  await expect(page.getByRole('heading', { name: 'Formative Übungen' })).toBeVisible()
  const itemButton = page.getByRole('group', { name: 'Eigene Übungsfragen' }).getByRole('button').filter({ hasText: promptV2 })
  await expect(itemButton).toBeVisible()
  await itemButton.focus()
  await expect(itemButton).toBeFocused()
  await page.keyboard.press('Enter')
  const editor = page.getByRole('form', { name: 'Übungsfrage bearbeiten' })
  await expect(editor.getByRole('textbox', { name: 'Fragetext' })).toHaveValue(promptV2)
  await page.getByLabel('Fragenversion ansehen').selectOption('1')
  await expect(editor.getByRole('textbox', { name: 'Fragetext' })).toHaveValue(promptV1)
  await expect(editor.getByRole('textbox', { name: 'Fragetext' })).toBeDisabled()
  const pin = editor.getByRole('button', { name: 'Version anheften' })
  await pin.focus()
  await expect(pin).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('Ungespeicherte Zusammenstellung')).toBeVisible()
  const draftSave = page.waitForResponse(response => new URL(response.url()).pathname === authorPath && response.request().method() === 'PATCH')
  const saveButton = page.getByRole('button', { name: 'Zusammenstellung speichern' })
  await saveButton.focus()
  await expect(saveButton).toBeFocused()
  await page.keyboard.press('Enter')
  expect((await draftSave).status()).toBe(200)
  await expect(page.getByText('Entwurf gespeichert · Revision 1')).toBeVisible()
  const stored = await page.request.get(`${origin}${authorPath}`)
  expect((await stored.json() as { draft: { payload: { items: unknown[] } } }).draft.payload.items).toEqual([{
    objectiveId: objective.id, objectiveRevision: objective.revision, itemId: item.id, itemRevision: 1,
  }])

  const preview = page.getByRole('button', { name: 'Vorschau', exact: true })
  await preview.focus()
  await expect(preview).toBeFocused()
  await page.keyboard.press('Enter')
  const authorPreview = page.getByRole('region', { name: 'Autorenvorschau' })
  await expect(authorPreview).toContainText(promptV1)
  await expect(authorPreview).not.toContainText(promptV2)
  await expect(authorPreview).toContainText('B. First · Richtig')
  await assertNoHorizontalLoss(page)
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: testInfo.outputPath(`formative-author-preview-desktop-${testedHead}.png`),
    fullPage: true, animations: 'disabled' })

  const reviewButton = page.getByRole('button', { name: 'Veröffentlichung prüfen', exact: true })
  await reviewButton.focus()
  await expect(reviewButton).toBeFocused()
  await page.keyboard.press('Enter')
  const review = page.getByRole('region', { name: 'Veröffentlichung prüfen' })
  await expect(review).toContainText(promptV1)
  await expect(review).toContainText('Gespeicherte Fassung prüfen')
  await page.setViewportSize({ width: 320, height: 700 })
  await assertNoHorizontalLoss(page)
  await assertTextPaintFits(review.getByText(objectiveTitle))
  await assertTextPaintFits(review.getByText(longOption))
  await expect(review.getByRole('button', { name: 'Diese Übungsfassung veröffentlichen' })).toBeVisible()
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: testInfo.outputPath(`formative-author-review-320-${testedHead}.png`),
    fullPage: true, animations: 'disabled' })

  const published = page.waitForResponse(response => new URL(response.url()).pathname === `${authorPath}/publish` && response.request().method() === 'POST')
  const publishButton = review.getByRole('button', { name: 'Diese Übungsfassung veröffentlichen' })
  await publishButton.focus()
  await expect(publishButton).toBeFocused()
  await page.keyboard.press('Enter')
  const publication = await published
  expect(publication.status(), await publication.text()).toBe(200)
  const result = await publication.json() as { snapshot: { id: string; sequence: number; itemCount: number; coursePublicationId: string }; unchanged: boolean }
  expect(result).toMatchObject({ snapshot: { sequence: 1, itemCount: 1, coursePublicationId: publicationId }, unchanged: false })
  await expect(page.getByText('Veröffentlichungsbeleg · Version 1')).toBeVisible()
  await page.getByRole('button', { name: 'Verlauf' }).click()
  const history = page.locator('section[aria-labelledby="history-heading"]')
  await expect(history).toContainText('Version 1')
  const historyRead = await page.request.get(`${origin}${authorPath}/history`)
  expect(historyRead.status()).toBe(200)
  expect(await historyRead.json()).toMatchObject({ activeCoursePublicationId: publicationId,
    snapshots: [{ id: result.snapshot.id, sequence: 1, itemCount: 1 }] })
  await assertNoHorizontalLoss(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: testInfo.outputPath(`formative-author-history-desktop-${testedHead}.png`),
    fullPage: true, animations: 'disabled' })

  const learnerContext = await browser.newContext({ baseURL: origin })
  try {
    const learner = await learnerContext.newPage()
    await login(learner, learnerEmail, password)
    expect((await learner.request.get(`${origin}${poolPath}/objectives`)).status()).toBe(403)
    expect((await learner.request.get(`${origin}${poolPath}/items/${item.id}/revisions/1`)).status()).toBe(403)
    expect((await learner.request.get(`${origin}${authorPath}`)).status()).toBe(403)
    expect((await learner.request.get(`${origin}${authorPath}/history`)).status()).toBe(403)
    const deniedPublish = await learner.request.post(`${origin}${authorPath}/publish`, {
      headers: { origin }, data: { expectedRevision: 1, expectedActivePublicationId: publicationId, requestId: randomUUID() },
    })
    expect(deniedPublish.status()).toBe(403)
    await learner.goto(`/courses/${courseId}/practice`)
    await expect(learner.getByRole('heading', { name: 'Kein Zugriff auf diesen Übungsentwurf' })).toBeVisible()
    await expect(learner.getByText(promptV1)).toHaveCount(0)
    await expect(learner.getByText(explanation)).toHaveCount(0)
  } finally { await learnerContext.close() }
})
