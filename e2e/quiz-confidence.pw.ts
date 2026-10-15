import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Page } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'

type AttemptPost = {
  submissionId: string
  publicationId: string
  contentVersionToken: string
  answers: Record<string, unknown>
  confidenceByQuestion?: Record<string, string>
}

type StoredAttempt = {
  submissionId: string
  publicationId: string
  confidenceDigest: string | null
  evidence: Array<{ questionId: string; confidence: string | null }>
}

function disposableDatabasePath() {
  const browserOrigin = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Quiz confidence browser QA requires a loopback origin and the explicitly disposable SQLite fixture.')
  }
  return path
}

function seedQuiz(path: string, instructorId: string, nonce: string) {
  const courseId = `confidence-qa-${nonce}`
  const contentId = `quiz-${nonce}`
  const publicationId = `publication-${nonce}-1`
  const quiz = JSON.stringify({ passingScore: 100, shuffleQuestions: false, questions: [
    { id: 'confidence-q1', type: 'TEXT_INPUT', question: 'Welche Antwort gehört zum ersten synthetischen Lernschritt?', correctAnswer: 'Erste Testantwort' },
    { id: 'confidence-q2', type: 'TEXT_INPUT', question: 'Welche Antwort gehört zum zweiten synthetischen Lernschritt?', correctAnswer: 'Zweite Testantwort' },
  ] })
  const payload = JSON.stringify({ schemaVersion: 1, contents: [{ id: contentId, parentId: null,
    title: 'Synthetischer Wissenstest', order: 1, type: 'TEXT', content: quiz }] })
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN')
    db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "price", "updatedAt")
      VALUES (?, 'Synthetischer Konfidenz-Kurs', 'Browser-Fixture', ?, 0, CURRENT_TIMESTAMP)`).run(courseId, instructorId)
    db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "type", "updatedAt")
      VALUES (?, 'Synthetischer Wissenstest', ?, 1, ?, 'TEXT', CURRENT_TIMESTAMP)`).run(contentId, quiz, courseId)
    db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
      VALUES (?, ?, 1, 'AUTHOR', ?, ?, 1)`).run(publicationId, courseId, payload, `qa-${nonce}-1`)
    db.prepare(`INSERT INTO "CourseDraft" ("courseId", "basePublicationId", "payload", "digest", "updatedAt")
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(courseId, publicationId, payload, `qa-${nonce}-1`)
    db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(publicationId, courseId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally { db.close() }
  return { courseId, contentId, publicationId, payload }
}

function republish(path: string, fixture: ReturnType<typeof seedQuiz>) {
  const nextPublicationId = `${fixture.publicationId.slice(0, -1)}2`
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN')
    db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount", "previousPublicationId")
      VALUES (?, ?, 2, 'AUTHOR', ?, ?, 1, ?)`).run(nextPublicationId, fixture.courseId, fixture.payload, `qa-${nextPublicationId}`, fixture.publicationId)
    db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(nextPublicationId, fixture.courseId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally { db.close() }
  return nextPublicationId
}

function storedAttempts(path: string, courseId: string): StoredAttempt[] {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const attempts = db.prepare(`SELECT "id", "submissionId", "publicationId", "confidenceDigest"
      FROM "QuizAttempt" WHERE "courseId" = ? ORDER BY "submittedAt", "id"`).all(courseId) as Array<{
      id: string; submissionId: string; publicationId: string; confidenceDigest: string | null
    }>
    return attempts.map(attempt => ({ submissionId: attempt.submissionId, publicationId: attempt.publicationId,
      confidenceDigest: attempt.confidenceDigest,
      evidence: db.prepare(`SELECT "questionId", "confidence" FROM "QuizAttemptItemEvidence"
        WHERE "attemptId" = ? ORDER BY "questionId"`).all(attempt.id) as StoredAttempt['evidence'] }))
  } finally { db.close() }
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}

async function fillAnswers(page: Page) {
  await page.getByRole('textbox', { name: 'Antwort zu Frage 1' }).fill('Unbekannt A')
  await page.getByRole('textbox', { name: 'Antwort zu Frage 2' }).fill('Unbekannt B')
}

test('learner confidence is optional, retries are stable, and republishing invalidates a stale form', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One disposable journey checks desktop and 320px without duplicate fixtures.')
  test.setTimeout(240_000)
  const databasePath = disposableDatabasePath()
  const nonce = randomUUID()
  const instructorEmail = `confidence-author-${nonce}@example.test`
  const learnerEmail = `confidence-learner-${nonce}@example.test`
  const password = `ConfidenceQA1!${nonce}`
  const instructor = await request.post(`${origin}/api/register`, { headers: { origin },
    data: { name: 'Confidence QA Author', email: instructorEmail, password } })
  const learner = await request.post(`${origin}/api/register`, { headers: { origin },
    data: { name: 'Confidence QA Learner', email: learnerEmail, password } })
  expect(instructor.status()).toBe(201)
  expect(learner.status()).toBe(201)
  const instructorId = (await instructor.json() as { userId: string }).userId
  const fixture = seedQuiz(databasePath, instructorId, nonce)
  const attemptPath = `/api/courses/${fixture.courseId}/contents/${fixture.contentId}/attempts`
  const evidenceUrl = (submissionId: string) => `${origin}${attemptPath}/${submissionId}/evidence`
  expect((await request.get(evidenceUrl('missing-attempt'))).status()).toBe(401)

  await login(page, learnerEmail, password)
  expect((await page.request.post(`${origin}/api/courses/${fixture.courseId}/enrollment`, { headers: { origin } })).status()).toBe(201)
  const learnerContents = await page.request.get(`${origin}/api/courses/${fixture.courseId}/contents`)
  expect(learnerContents.status()).toBe(200)
  const publicContent = await learnerContents.text()
  expect(publicContent.includes('correctAnswer')).toBe(false)
  expect(publicContent.includes('Erste Testantwort')).toBe(false)
  await page.goto(`/courses/${fixture.courseId}/contents?content=${fixture.contentId}`)
  await expect(page.getByText('Welche Antwort gehört zum ersten synthetischen Lernschritt?')).toBeVisible()
  const confidenceGroups = page.getByRole('group', { name: 'Wie sicher bist du dir? (freiwillig)' })
  await expect(confidenceGroups).toHaveCount(2)
  await expect(confidenceGroups.nth(0).getByRole('radio')).toHaveCount(5)
  await expect(confidenceGroups.nth(1).getByRole('radio')).toHaveCount(5)
  const sure = confidenceGroups.nth(0).getByRole('radio', { name: 'Sicher', exact: true })
  const omit = confidenceGroups.nth(1).getByRole('radio', { name: 'Keine Angabe', exact: true })
  await sure.focus()
  await expect(sure).toBeFocused()
  await page.keyboard.press('Space')
  await expect(sure).toBeChecked()
  await omit.focus()
  await expect(omit).toBeFocused()
  await page.keyboard.press('Space')
  await expect(omit).toBeChecked()
  await expect(page.getByRole('button', { name: 'Antworten abgeben' })).toBeDisabled()
  await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1)
  await expect(sure).toBeVisible()
  await expect(omit).toBeVisible()
  expect(await confidenceGroups.first().locator('label').evaluateAll(labels => labels.every(label => {
    const box = label.getBoundingClientRect()
    return box.left >= -1 && box.right <= innerWidth + 1
  }))).toBe(true)
  await page.evaluate(async () => { await document.fonts.ready })
  await page.screenshot({ path: testInfo.outputPath('quiz-confidence-320.png'), fullPage: true, animations: 'disabled' })
  await fillAnswers(page)

  const posts: AttemptPost[] = []
  let simulateLostResponse = true
  await page.route(`**${attemptPath}`, async route => {
    posts.push(route.request().postDataJSON() as AttemptPost)
    if (simulateLostResponse) {
      simulateLostResponse = false
      const committed = await route.fetch()
      expect(committed.status()).toBe(200)
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic lost response"}' })
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Antworten abgeben' }).click()
  await expect(page.getByRole('alert')).toContainText('Deine Antworten konnten nicht geprüft werden')
  await expect(page.getByRole('button', { name: 'Abgabe erneut prüfen' })).toBeEnabled()
  await expect(sure).toBeDisabled()
  await expect(omit).toBeDisabled()
  expect(posts.length).toBe(1)
  expect(posts[0].confidenceByQuestion).toEqual({ 'confidence-q1': 'SURE' })
  expect(storedAttempts(databasePath, fixture.courseId).length).toBe(1)
  await page.getByRole('button', { name: 'Abgabe erneut prüfen' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Noch nicht bestanden.' })).toBeVisible()
  expect(posts.length).toBe(2)
  // Compare opaque values as booleans so a failed CI assertion cannot print
  // the content-version token or submission ID into its report.
  expect(posts[1].submissionId === posts[0].submissionId).toBe(true)
  expect(posts[1].contentVersionToken === posts[0].contentVersionToken).toBe(true)
  expect(JSON.stringify(posts[1].answers) === JSON.stringify(posts[0].answers)).toBe(true)
  expect(JSON.stringify(posts[1].confidenceByQuestion) === JSON.stringify(posts[0].confidenceByQuestion)).toBe(true)
  let attempts = storedAttempts(databasePath, fixture.courseId)
  expect(attempts.length).toBe(1)
  expect(attempts[0].submissionId === posts[0].submissionId).toBe(true)
  expect(attempts[0].publicationId).toBe(fixture.publicationId)
  expect(attempts[0].evidence).toEqual([
    { questionId: 'confidence-q1', confidence: 'SURE' }, { questionId: 'confidence-q2', confidence: null },
  ])
  expect(Boolean(attempts[0].confidenceDigest?.match(/^[a-f0-9]{64}$/))).toBe(true)
  const firstEvidence = await page.request.get(evidenceUrl(posts[0].submissionId))
  expect(firstEvidence.status()).toBe(200)
  expect(firstEvidence.headers()['cache-control']).toContain('no-store')
  const firstEvidenceBody = await firstEvidence.json() as Record<string, unknown>
  expect(Object.keys(firstEvidenceBody).sort()).toEqual(['confidenceRecorded', 'evidenceRecorded', 'reviewPrompt'])
  expect(firstEvidenceBody.evidenceRecorded).toBe(true)
  expect(firstEvidenceBody.confidenceRecorded).toBe(true)
  expect(/confidence-q1|correct|score|answer|Testantwort/i.test(JSON.stringify(firstEvidenceBody))).toBe(false)

  await page.getByRole('button', { name: 'Quiz wiederholen' }).click()
  await expect(confidenceGroups.nth(0).getByRole('radio', { name: 'Sicher', exact: true })).not.toBeChecked()
  await expect(confidenceGroups.nth(1).getByRole('radio', { name: 'Keine Angabe', exact: true })).not.toBeChecked()
  await expect(page.getByRole('textbox', { name: 'Antwort zu Frage 1' })).toHaveValue('')
  await fillAnswers(page)
  await page.getByRole('button', { name: 'Antworten abgeben' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Noch nicht bestanden.' })).toBeVisible()
  expect(posts.length).toBe(3)
  expect('confidenceByQuestion' in posts[2]).toBe(false)
  attempts = storedAttempts(databasePath, fixture.courseId)
  expect(attempts.length).toBe(2)
  const skippedAttempt = attempts.find(attempt => attempt.submissionId === posts[2].submissionId)
  expect(Boolean(skippedAttempt)).toBe(true)
  expect(skippedAttempt?.confidenceDigest).toBeNull()
  expect(skippedAttempt?.evidence).toEqual([
    { questionId: 'confidence-q1', confidence: null }, { questionId: 'confidence-q2', confidence: null },
  ])
  const omittedEvidence = await page.request.get(evidenceUrl(posts[2].submissionId))
  expect(omittedEvidence.status()).toBe(200)
  const omittedEvidenceBody = await omittedEvidence.json() as Record<string, unknown>
  expect(Object.keys(omittedEvidenceBody).sort()).toEqual(['confidenceRecorded', 'evidenceRecorded', 'reviewPrompt'])
  expect(omittedEvidenceBody.evidenceRecorded).toBe(true)
  expect(omittedEvidenceBody.confidenceRecorded).toBe(false)
  expect(omittedEvidenceBody.reviewPrompt).toBe(firstEvidenceBody.reviewPrompt)
  expect(/confidence-q1|correct|score|answer|Testantwort/i.test(JSON.stringify(omittedEvidenceBody))).toBe(false)

  await page.getByRole('button', { name: 'Quiz wiederholen' }).click()
  await fillAnswers(page)
  const guessed = confidenceGroups.nth(0).getByRole('radio', { name: 'Geraten' })
  await guessed.focus()
  await page.keyboard.press('Space')
  await expect(guessed).toBeChecked()
  const nextPublicationId = republish(databasePath, fixture)
  expect((await page.request.get(evidenceUrl(posts[0].submissionId))).status()).toBe(404)
  await page.getByRole('button', { name: 'Antworten abgeben' }).click()
  await expect(page.getByRole('alert')).toContainText('Dieses Quiz wurde geändert')
  await expect(page.getByRole('button', { name: 'Antworten abgeben' })).toBeDisabled()
  await expect(guessed).toBeChecked()
  expect(posts.length).toBe(4)
  expect(posts[3].publicationId).toBe(fixture.publicationId)
  expect(storedAttempts(databasePath, fixture.courseId).length).toBe(2)

  await page.reload()
  await expect(page.getByText('Welche Antwort gehört zum ersten synthetischen Lernschritt?')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Antwort zu Frage 1' })).toHaveValue('')
  await expect(confidenceGroups.nth(0).getByRole('radio', { name: 'Geraten' })).not.toBeChecked()
  await fillAnswers(page)
  await page.getByRole('button', { name: 'Antworten abgeben' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Noch nicht bestanden.' })).toBeVisible()
  expect(posts.length).toBe(5)
  expect(posts[4].publicationId).toBe(nextPublicationId)
  expect(posts[4].contentVersionToken !== posts[0].contentVersionToken).toBe(true)
  expect(storedAttempts(databasePath, fixture.courseId).length).toBe(3)
})
