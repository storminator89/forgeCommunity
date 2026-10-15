import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Locator, type Page } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const testedHead = /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '')
  ? process.env.GITHUB_SHA!.slice(0, 12) : 'local-unverified-head'

// Never seed a normal development database: this test uses only CI's loopback fixture.
function disposableDatabasePath() {
  const browserOrigin = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      browserOrigin.port !== '3013' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Real learner browser QA requires the loopback, disposable SQLite fixture.')
  }
  return path
}

function withDatabase<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path)
  try { db.exec('PRAGMA busy_timeout = 5000'); return work(db) }
  finally { db.close() }
}

function seedPublishedCourse(path: string, instructorId: string, learnerId: string, nonce: string) {
  const courseId = `practice-qa-${nonce}`
  const contentId = `lesson-${nonce}`
  const publicationId = `publication-${nonce}`
  const content = '<p>Disposable synthetic lesson with no credential quiz.</p>'
  const payload = JSON.stringify({ schemaVersion: 1, contents: [{ id: contentId, parentId: null,
    title: 'Synthetic lesson', order: 1, type: 'TEXT', content }] })
  withDatabase(path, db => {
    db.exec('PRAGMA foreign_keys = ON; BEGIN')
    try {
      db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "price", "updatedAt")
        VALUES (?, 'Synthetic private practice course', 'Disposable browser fixture', ?, 0, CURRENT_TIMESTAMP)`)
        .run(courseId, instructorId)
      db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "type", "updatedAt")
        VALUES (?, 'Synthetic lesson', ?, 1, ?, 'TEXT', CURRENT_TIMESTAMP)`).run(contentId, content, courseId)
      db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
        VALUES (?, ?, 1, 'AUTHOR', ?, ?, 1)`).run(publicationId, courseId, payload, `qa-${nonce}`)
      db.prepare(`INSERT INTO "CourseDraft" ("courseId", "basePublicationId", "payload", "digest", "updatedAt")
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(courseId, publicationId, payload, `qa-${nonce}`)
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(publicationId, courseId)
      db.prepare('INSERT INTO "Enrollment" ("id", "userId", "courseId") VALUES (?, ?, ?)')
        .run(randomUUID(), learnerId, courseId)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
  return { courseId, publicationId }
}

function evidence(path: string, learnerId: string, courseId: string) {
  return withDatabase(path, db => {
    const count = (table: string, clause: string, ...values: string[]) =>
      (db.prepare(`SELECT COUNT(*) AS count FROM "${table}" WHERE ${clause}`).get(...values) as { count: number }).count
    return {
      settings: count('PracticeLearnerSetting', '"userId" = ? AND "courseId" = ?', learnerId, courseId),
      sessions: count('PracticeLearnerSession', '"userId" = ? AND "courseId" = ?', learnerId, courseId),
      reservations: count('PracticeLearnerReservation', '"sessionId" IN (SELECT "id" FROM "PracticeLearnerSession" WHERE "userId" = ? AND "courseId" = ?)', learnerId, courseId),
      answers: count('PracticeLearnerAnswer', '"reservationId" IN (SELECT r."id" FROM "PracticeLearnerReservation" r JOIN "PracticeLearnerSession" s ON s."id" = r."sessionId" WHERE s."userId" = ? AND s."courseId" = ?)', learnerId, courseId),
      receipts: count('PracticeLearnerSubmissionReceipt', '"sessionId" IN (SELECT "id" FROM "PracticeLearnerSession" WHERE "userId" = ? AND "courseId" = ?)', learnerId, courseId),
      schedules: count('PracticeLearnerSchedule', '"userId" = ? AND "courseId" = ?', learnerId, courseId),
      quizAttempts: count('QuizAttempt', '"userId" = ? AND "courseId" = ?', learnerId, courseId),
      progress: count('CourseContentProgress', '"userId" = ? AND "courseId" = ?', learnerId, courseId),
      rewards: count('RewardLedger', '"userId" = ?', learnerId),
      certificates: count('Certificate', '"userId" = ? AND "courseId" = ?', learnerId, courseId),
      completions: count('CourseCompletionRecord', '"userId" = ? AND "courseId" = ?', learnerId, courseId),
      submissions: count('AssignmentSubmission', '"userId" = ? AND "courseId" = ?', learnerId, courseId),
    }
  })
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}

async function keyboardActivate(page: Page, target: Locator) {
  await target.focus()
  await expect(target).toBeFocused()
  await page.keyboard.press('Enter')
}

async function assertNoHorizontalLoss(page: Page) {
  const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth,
    document.body.scrollWidth) - innerWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

test('real private learner practice keeps separate authoring, explicit progression, and private evidence', async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One disposable journey resizes its real learner page to 320px.')
  test.setTimeout(240_000)
  const databasePath = disposableDatabasePath()
  const nonce = randomUUID()
  const password = `PracticeQaA1!${nonce}`
  const instructorEmail = `practice-instructor-${nonce}@example.test`
  const learnerEmail = `practice-learner-${nonce}@example.test`
  const ids: string[] = []
  for (const [email, name] of [[instructorEmail, 'Synthetic Practice Instructor'],
    [learnerEmail, 'Synthetic Practice Learner']]) {
    const registration = await request.post(`${origin}/api/register`, {
      headers: { origin }, data: { name, email, password },
    })
    expect(registration.status(), await registration.text()).toBe(201)
    ids.push((await registration.json() as { userId: string }).userId)
  }
  const [instructorId, learnerId] = ids
  expect(instructorId).toBeTruthy()
  expect(learnerId).toBeTruthy()
  withDatabase(databasePath, db => db.prepare('UPDATE "User" SET "role" = ? WHERE "id" = ?').run('INSTRUCTOR', instructorId))
  const { courseId, publicationId } = seedPublishedCourse(databasePath, instructorId, learnerId, nonce)
  const authorPath = `/api/courses/${courseId}/practice/authoring`
  const learnerPath = `/api/courses/${courseId}/practice/learner`
  const poolPath = '/api/courses/practice'
  const credentialFree = { quizAttempts: 0, progress: 0, rewards: 0, certificates: 0, completions: 0, submissions: 0 }
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ settings: 0, sessions: 0,
    reservations: 0, answers: 0, receipts: 0, schedules: 0, ...credentialFree })
  expect((await request.get(`${origin}${learnerPath}`)).status()).toBe(401)

  const instructorContext = await browser.newContext({ baseURL: origin })
  try {
    const instructor = await instructorContext.newPage()
    await login(instructor, instructorEmail, password)
    // Course publication alone is not a practice publication.
    expect(await (await instructor.request.get(`${origin}${learnerPath}`)).status()).toBe(403)
    const objectiveResponse = await instructor.request.post(`${origin}${poolPath}/objectives`, {
      headers: { origin }, data: { title: 'Synthetic practice objective', description: 'No assessed question reuse.' },
    })
    expect(objectiveResponse.status(), await objectiveResponse.text()).toBe(201)
    const objective = await objectiveResponse.json() as { id: string; revision: number }
    const publishedItems: Array<{ id: string; latestRevision: number }> = []
    for (const [prompt, firstOption] of [
      ['Which synthetic concept is first?', 'An unrelated guess'],
      ['Which synthetic concept is second?', 'Another unrelated guess'],
    ]) {
      const itemResponse = await instructor.request.post(`${origin}${poolPath}/objectives/${objective.id}/items`, {
        headers: { origin }, data: { choice: { type: 'SINGLE_CHOICE', prompt,
          options: [firstOption, 'The taught concept'], correctIndex: 1,
          explanation: 'The taught concept is the synthetic answer.' } },
      })
      expect(itemResponse.status(), await itemResponse.text()).toBe(201)
      publishedItems.push(await itemResponse.json() as { id: string; latestRevision: number })
    }
    const initial = await instructor.request.get(`${origin}${authorPath}`)
    expect(initial.status(), await initial.text()).toBe(200)
    expect(await initial.json()).toMatchObject({ draft: { revision: 0, payload: { items: [] } },
      activeCoursePublicationId: publicationId, activeSnapshot: null })
    const saved = await instructor.request.patch(`${origin}${authorPath}`, {
      headers: { origin }, data: { expectedRevision: 0, items: publishedItems.map(item => ({
        objectiveId: objective.id, objectiveRevision: objective.revision,
        itemId: item.id, itemRevision: item.latestRevision,
      })) },
    })
    expect(saved.status(), await saved.text()).toBe(200)
    expect(await saved.json()).toMatchObject({ draft: { revision: 1 } })
    const publication = await instructor.request.post(`${origin}${authorPath}/publish`, {
      headers: { origin }, data: { expectedRevision: 1, expectedActivePublicationId: publicationId, requestId: randomUUID() },
    })
    expect(publication.status(), await publication.text()).toBe(200)
    expect(await publication.json()).toMatchObject({ snapshot: { coursePublicationId: publicationId,
      itemCount: 2, sequence: 1 }, unchanged: false })
  } finally { await instructorContext.close() }

  await login(page, learnerEmail, password)
  expect((await page.request.get(`${origin}${authorPath}`)).status()).toBe(403)
  expect((await page.request.get(`${origin}${poolPath}/objectives`)).status()).toBe(403)
  const beforeOptIn = await page.request.get(`${origin}${learnerPath}`)
  expect(beforeOptIn.status()).toBe(200)
  expect(beforeOptIn.headers()['cache-control']).toContain('private, no-store')
  const available = await beforeOptIn.json() as { status: string; dueCount: number; publicationId: string }
  expect(available).toMatchObject({ status: 'available', dueCount: 0, publicationId })
  expect(JSON.stringify(available)).not.toMatch(/correctIndex|explanation|pending/)
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ settings: 0, sessions: 0,
    reservations: 0, answers: 0, receipts: 0, schedules: 0, ...credentialFree })

  await page.goto(`/courses/${courseId}/practice/learn`)
  await expect(page.getByRole('heading', { level: 1, name: 'Privat üben' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  await keyboardActivate(page, page.getByRole('button', { name: 'Privates Üben einschalten' }))
  await expect(page.getByRole('button', { name: 'Erste Frage öffnen' })).toBeVisible()
  expect(await (await page.request.get(`${origin}${learnerPath}`)).json()).toMatchObject({ status: 'ready', dueCount: 2 })
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ settings: 1, sessions: 0, reservations: 0,
    answers: 0, receipts: 0, schedules: 0, ...credentialFree })

  await keyboardActivate(page, page.getByRole('button', { name: 'Erste Frage öffnen' }))
  const questionGroup = page.getByRole('group', { name: /Which synthetic concept is (first|second)\?/ })
  await expect(questionGroup).toBeVisible()
  const activeResponse = await page.request.get(`${origin}${learnerPath}`)
  const active = await activeResponse.json() as { status: string; dueCount: number; session: { id: string;
    pending: { reservationId: string; item: { prompt: string; options: string[] } } } }
  expect(active.status).toBe('active')
  expect(active.session.pending.item.options).toHaveLength(2)
  expect(JSON.stringify(active)).not.toMatch(/correctIndex|explanation/)
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ sessions: 1, reservations: 1,
    answers: 0, receipts: 0, schedules: 0, ...credentialFree })
  await expect(page.getByRole('button', { name: 'Antwort prüfen' })).toBeDisabled()
  await assertNoHorizontalLoss(page)
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: testInfo.outputPath(`real-learner-question-desktop-${testedHead}.png`),
    fullPage: true, animations: 'disabled' })

  await page.setViewportSize({ width: 320, height: 700 })
  await assertNoHorizontalLoss(page)
  const firstChoice = page.getByRole('radio', { name: active.session.pending.item.options[0] })
  await firstChoice.focus()
  await expect(firstChoice).toBeFocused()
  await page.keyboard.press('Space')
  await page.getByRole('radio', { name: 'Unsicher' }).check()
  const answerRequest = page.waitForRequest(entry => new URL(entry.url()).pathname === `${learnerPath}/answer`
    && entry.method() === 'POST')
  await keyboardActivate(page, page.getByRole('button', { name: 'Antwort prüfen' }))
  const submitted = (await answerRequest).postDataJSON() as { sessionId: string; reservationId: string;
    submissionId: string; optionIndex: number; confidence: string }
  expect(submitted).toMatchObject({ sessionId: active.session.id,
    reservationId: active.session.pending.reservationId, optionIndex: 0, confidence: 'UNSURE' })
  await expect(page.getByRole('heading', { name: 'Eine andere Antwort war vorgesehen.' })).toBeVisible()
  await expect(page.getByText('Vorgesehene Antwort: The taught concept')).toBeVisible()
  await assertNoHorizontalLoss(page)
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: testInfo.outputPath(`real-learner-feedback-320-${testedHead}.png`),
    fullPage: true, animations: 'disabled' })
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ settings: 1, sessions: 1,
    reservations: 1, answers: 1, receipts: 1, schedules: 1, ...credentialFree })
  const replay = await page.request.post(`${origin}${learnerPath}/answer`, { headers: { origin }, data: submitted })
  expect(replay.status(), await replay.text()).toBe(200)
  expect(await replay.json()).toMatchObject({ correct: false, correctIndex: 1, answeredCount: 1, replay: true })
  const conflict = await page.request.post(`${origin}${learnerPath}/answer`, { headers: { origin },
    data: { ...submitted, optionIndex: 1 } })
  expect(conflict.status()).toBe(409)
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ reservations: 1, answers: 1,
    receipts: 1, schedules: 1, ...credentialFree })

  await keyboardActivate(page, page.getByRole('button', { name: 'Weitere Frage öffnen' }))
  await expect(page.getByRole('group', { name: /Which synthetic concept is (first|second)\?/ })).toBeVisible()
  const afterNext = await (await page.request.get(`${origin}${learnerPath}`)).json() as typeof active
  expect(afterNext.session.pending.reservationId).not.toBe(active.session.pending.reservationId)
  expect(afterNext.session.pending.item.prompt).not.toBe(active.session.pending.item.prompt)
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ reservations: 2, answers: 1,
    receipts: 1, schedules: 1, ...credentialFree })

  // A newer course publication cannot silently inherit the older practice pool.
  const newerPublicationId = `new-publication-${nonce}`
  withDatabase(databasePath, db => {
    db.exec('PRAGMA foreign_keys = ON; BEGIN')
    try {
      db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount", "previousPublicationId")
        SELECT ?, "courseId", 2, "source", "payload", "digest", "contentCount", "id"
        FROM "CoursePublication" WHERE "id" = ?`).run(newerPublicationId, publicationId)
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(newerPublicationId, courseId)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
  expect(await (await page.request.get(`${origin}${learnerPath}`)).json()).toMatchObject({ status: 'archived', dueCount: 0 })
  const staleNext = await page.request.post(`${origin}${learnerPath}/next`, { headers: { origin },
    data: { sessionId: active.session.id } })
  expect(staleNext.status()).toBe(409)
  withDatabase(databasePath, db => db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?')
    .run(publicationId, courseId))
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ reservations: 2, answers: 1,
    receipts: 1, schedules: 1, ...credentialFree })

  await page.getByText('Übung verwalten').click()
  await keyboardActivate(page, page.getByRole('button', { name: 'Üben pausieren' }))
  const pause = page.getByRole('alertdialog', { name: 'Privates Üben pausieren?' })
  await expect(pause).toBeVisible()
  await keyboardActivate(page, pause.getByRole('button', { name: 'Üben pausieren' }))
  await expect(page.getByRole('heading', { name: 'Privates Üben ist pausiert' })).toBeVisible()
  expect(await (await page.request.get(`${origin}${learnerPath}`)).json()).toMatchObject({ status: 'paused' })
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ settings: 1, sessions: 1,
    reservations: 2, answers: 1, receipts: 1, schedules: 1, ...credentialFree })

  await keyboardActivate(page, page.getByRole('button', { name: 'Privates Üben ausschalten' }))
  const optOut = page.getByRole('alertdialog', { name: 'Privates Üben ausschalten?' })
  await expect(optOut).toContainText('Übungsdaten bleiben gespeichert')
  await keyboardActivate(page, optOut.getByRole('button', { name: 'Privates Üben ausschalten' }))
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(await (await page.request.get(`${origin}${learnerPath}`)).json()).toMatchObject({ status: 'available' })
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ settings: 1, sessions: 1,
    reservations: 2, answers: 1, receipts: 1, schedules: 1, ...credentialFree })

  await keyboardActivate(page, page.getByRole('button', { name: 'Übungsdaten zurücksetzen' }))
  const reset = page.getByRole('alertdialog', { name: 'Übungsdaten endgültig löschen?' })
  await expect(reset.getByRole('button', { name: 'Übungsdaten endgültig löschen' })).toBeDisabled()
  await reset.getByRole('textbox', { name: 'Zur Bestätigung RESET eingeben' }).fill('RESET')
  await keyboardActivate(page, reset.getByRole('button', { name: 'Übungsdaten endgültig löschen' }))
  await expect(page.getByRole('button', { name: 'Privates Üben einschalten' })).toBeVisible()
  expect(evidence(databasePath, learnerId, courseId)).toMatchObject({ settings: 0, sessions: 0,
    reservations: 0, answers: 0, receipts: 0, schedules: 0, ...credentialFree })
})
