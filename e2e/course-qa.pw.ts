import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Locator, type Page } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'

// This journey writes only to CI's explicit, disposable, local SQLite fixture.
function disposableDatabasePath() {
  const browserOrigin = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Course Q&A browser QA requires the loopback, disposable SQLite fixture.')
  }
  return path
}

function withDatabase<T>(path: string, work: (db: DatabaseSync) => T, readOnly = false): T {
  const db = new DatabaseSync(path, { readOnly })
  try { db.exec('PRAGMA busy_timeout = 5000'); return work(db) }
  finally { db.close() }
}

function seedCourse(path: string, instructorId: string, learnerIds: string[], nonce: string) {
  const courseId = `course-qa-${nonce}`
  const contentId = `lesson-${nonce}`
  const publicationId = `publication-${nonce}`
  const content = '<p>Disposable Q&A fixture lesson.</p>'
  const payload = JSON.stringify({ schemaVersion: 1, contents: [{ id: contentId, parentId: null,
    title: 'Synthetic lesson', order: 1, type: 'TEXT', content }] })
  withDatabase(path, db => {
    db.exec('PRAGMA foreign_keys = ON; BEGIN')
    try {
      db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "price", "updatedAt")
        VALUES (?, 'Synthetic private Q&A course', 'Disposable browser fixture', ?, 0, CURRENT_TIMESTAMP)`)
        .run(courseId, instructorId)
      db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "type", "updatedAt")
        VALUES (?, 'Synthetic lesson', ?, 1, ?, 'TEXT', CURRENT_TIMESTAMP)`).run(contentId, content, courseId)
      db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
        VALUES (?, ?, 1, 'AUTHOR', ?, ?, 1)`).run(publicationId, courseId, payload, `qa-${nonce}`)
      db.prepare(`INSERT INTO "CourseDraft" ("courseId", "basePublicationId", "payload", "digest", "updatedAt")
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(courseId, publicationId, payload, `qa-${nonce}`)
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(publicationId, courseId)
      for (const learnerId of learnerIds) db.prepare('INSERT INTO "Enrollment" ("id", "userId", "courseId") VALUES (?, ?, ?)')
        .run(randomUUID(), learnerId, courseId)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
  return courseId
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}

async function keyboardActivate(page: Page, control: Locator) {
  await control.focus()
  await expect(control).toBeFocused()
  await page.keyboard.press('Enter')
}

test('course Q&A stays private through learner, peer and instructor browser flows', async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One bounded fixture also opens a real 320px mobile browser context.')
  test.setTimeout(240_000)
  const databasePath = disposableDatabasePath()
  const nonce = randomUUID()
  const password = `CourseQaA1!${nonce}`
  const people = [
    { email: `qa-instructor-${nonce}@example.test`, name: 'Synthetic Q&A Instructor' },
    { email: `qa-learner-${nonce}@example.test`, name: 'Synthetic Q&A Learner' },
    { email: `qa-peer-${nonce}@example.test`, name: 'Synthetic Q&A Peer' },
    { email: `qa-outsider-${nonce}@example.test`, name: 'Synthetic Q&A Outsider' },
  ]
  const ids: string[] = []
  for (const person of people) {
    const registered = await request.post(`${origin}/api/register`, { headers: { origin }, data: { ...person, password } })
    expect(registered.status(), await registered.text()).toBe(201)
    ids.push((await registered.json() as { userId: string }).userId)
  }
  const courseId = seedCourse(databasePath, ids[0], [ids[1], ids[2]], nonce)
  const api = `/api/courses/${courseId}/qa`
  const questionTitle = `Synthetic course question ${nonce}`
  const questionBody = `Where does this private course answer live? ${nonce}`
  const replyBody = `It lives only inside the enrolled course. ${nonce} ` +
    'This synthetic answer is long enough to check vertical scrolling on a narrow screen. '.repeat(18)

  await login(page, people[1].email, password)
  await page.goto(`/courses/${courseId}/contents`)
  await expect(page.getByRole('button', { name: 'Fragen', exact: true })).toBeVisible()
  await keyboardActivate(page, page.getByRole('button', { name: 'Fragen', exact: true }))
  await expect(page).toHaveURL(new RegExp(`/courses/${courseId}/qa$`))
  await keyboardActivate(page, page.getByRole('button', { name: 'Frage stellen' }))
  const composer = page.getByRole('form', { name: 'Neue Frage' })
  await composer.getByRole('textbox', { name: 'Titel' }).fill(questionTitle)
  await composer.getByRole('textbox', { name: 'Frage', exact: true }).fill(questionBody)
  const questionResponse = page.waitForResponse(entry => new URL(entry.url()).pathname === api && entry.request().method() === 'POST')
  await keyboardActivate(page, composer.getByRole('button', { name: 'Frage veröffentlichen' }))
  const questionWrite = await questionResponse
  expect(questionWrite.status(), await questionWrite.text()).toBe(201)
  const questionId = (await questionWrite.json() as { question: { id: string } }).question.id
  await expect(page.getByRole('heading', { level: 2, name: questionTitle })).toBeVisible()

  const mobileContext = await browser.newContext({ baseURL: origin, viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true })
  const instructorContext = await browser.newContext({ baseURL: origin })
  const outsiderContext = await browser.newContext({ baseURL: origin })
  try {
    const peer = await mobileContext.newPage()
    await login(peer, people[2].email, password)
    await peer.goto(`/courses/${courseId}/qa`)
    await expect(peer.getByRole('heading', { name: 'Fragen zum Kurs' })).toBeVisible()
    const list = peer.getByRole('region', { name: 'Fragenliste' })
    await keyboardActivate(peer, list.getByRole('button').filter({ hasText: questionTitle }))
    await expect(peer.getByRole('heading', { level: 2, name: questionTitle })).toBeVisible()
    await peer.getByRole('textbox', { name: 'Deine Antwort' }).fill(replyBody)
    const answerResponse = peer.waitForResponse(entry => new URL(entry.url()).pathname === `${api}/${questionId}/answers` && entry.request().method() === 'POST')
    await keyboardActivate(peer, peer.getByRole('button', { name: 'Antwort veröffentlichen' }))
    const answerWrite = await answerResponse
    expect(answerWrite.status(), await answerWrite.text()).toBe(201)
    const answerId = (await answerWrite.json() as { answer: { id: string } }).answer.id
    await expect(peer.getByText(replyBody, { exact: true })).toBeVisible()
    const mobileMain = peer.locator('main#page-content')
    const scroll = await mobileMain.evaluate(element => ({ height: element.clientHeight, content: element.scrollHeight,
      overflow: getComputedStyle(element).overflowY }))
    expect(scroll.overflow).toBe('auto')
    expect(scroll.content).toBeGreaterThan(scroll.height)
    await peer.getByText(replyBody, { exact: true }).scrollIntoViewIfNeeded()
    await expect(peer.getByText(replyBody, { exact: true })).toBeInViewport()
    await mobileMain.evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(peer.getByRole('button', { name: 'Antwort veröffentlichen' })).toBeInViewport()
    const overflow = await peer.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    const instructor = await instructorContext.newPage()
    await login(instructor, people[0].email, password)
    await instructor.goto(`/courses/${courseId}/qa`)
    await expect(instructor.getByRole('button', { name: 'Frage stellen' })).toHaveCount(0)
    await keyboardActivate(instructor, instructor.getByRole('button', { name: 'Offen', exact: true }))
    await keyboardActivate(instructor, instructor.getByRole('region', { name: 'Fragenliste' }).getByRole('button').filter({ hasText: questionTitle }))
    await expect(instructor.getByText(replyBody, { exact: true })).toBeVisible()
    const solutionResponse = instructor.waitForResponse(entry => new URL(entry.url()).pathname === `${api}/${questionId}/solution` && entry.request().method() === 'PUT')
    await keyboardActivate(instructor, instructor.getByRole('button', { name: 'Als Lösung markieren' }))
    expect((await solutionResponse).status()).toBe(200)
    await expect(instructor.getByText('Lösung', { exact: true })).toBeVisible()
    await keyboardActivate(instructor, instructor.getByRole('button', { name: 'Beantwortet', exact: true }))
    await expect(instructor.getByRole('region', { name: 'Fragenliste' })).toContainText(questionTitle)

    await keyboardActivate(instructor, instructor.getByRole('button', { name: 'Antwort ausblenden' }))
    const answerDialog = instructor.getByRole('alertdialog', { name: 'Antwort ausblenden?' })
    await expect(answerDialog).toBeVisible()
    const hideAnswer = instructor.waitForResponse(entry => new URL(entry.url()).pathname === `${api}/${questionId}/answers/${answerId}` && entry.request().method() === 'PATCH')
    await keyboardActivate(instructor, answerDialog.getByRole('button', { name: 'Ausblenden', exact: true }))
    expect((await hideAnswer).status()).toBe(200)
    await expect(instructor.getByRole('button', { name: 'Antwort wieder anzeigen' })).toBeVisible()
    await peer.reload()
    await peer.getByRole('region', { name: 'Fragenliste' }).getByRole('button').filter({ hasText: questionTitle }).click()
    await expect(peer.getByText(replyBody, { exact: true })).toHaveCount(0)

    await keyboardActivate(instructor, instructor.getByRole('button', { name: 'Frage ausblenden' }))
    const questionDialog = instructor.getByRole('alertdialog', { name: 'Frage ausblenden?' })
    await expect(questionDialog).toBeVisible()
    const hideQuestion = instructor.waitForResponse(entry => new URL(entry.url()).pathname === `${api}/${questionId}` && entry.request().method() === 'PATCH')
    await keyboardActivate(instructor, questionDialog.getByRole('button', { name: 'Ausblenden', exact: true }))
    expect((await hideQuestion).status()).toBe(200)
    await keyboardActivate(instructor, instructor.getByRole('button', { name: 'Ausgeblendet', exact: true }))
    await keyboardActivate(instructor, instructor.getByRole('region', { name: 'Fragenliste' }).getByRole('button').filter({ hasText: questionTitle }))
    await expect(instructor.getByRole('button', { name: 'Frage wieder anzeigen' })).toBeVisible()
    const hiddenRead = await peer.request.get(`${api}/${questionId}`)
    expect(hiddenRead.status()).toBe(404)

    const outsider = await outsiderContext.newPage()
    await login(outsider, people[3].email, password)
    expect((await outsider.request.get(api)).status()).toBe(403)
    expect((await outsider.request.post(api, { headers: { origin }, data: { title: questionTitle, body: questionBody, requestId: randomUUID() } })).status()).toBe(403)

    const withdrawal = await page.request.delete(`/api/courses/${courseId}/enrollment`, { headers: { origin } })
    expect(withdrawal.status(), await withdrawal.text()).toBe(200)
    expect((await page.request.get(api)).status()).toBe(403)
    expect((await page.request.post(`${api}/${questionId}/answers`, { headers: { origin }, data: { body: replyBody, requestId: randomUUID() } })).status()).toBe(403)

    // A course question/answer must never create ordinary community records.
    const publicRecords = withDatabase(databasePath, db => ({
      posts: (db.prepare('SELECT COUNT(*) AS count FROM "Post" WHERE "title" LIKE ? OR "content" LIKE ?').get(`%${nonce}%`, `%${nonce}%`) as { count: number }).count,
      comments: (db.prepare('SELECT COUNT(*) AS count FROM "Comment" WHERE "content" LIKE ?').get(`%${nonce}%`) as { count: number }).count,
    }), true)
    expect(publicRecords).toEqual({ posts: 0, comments: 0 })
  } finally {
    await Promise.all([mobileContext.close(), instructorContext.close(), outsiderContext.close()])
  }
})
