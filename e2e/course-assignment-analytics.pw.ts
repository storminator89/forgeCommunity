import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Page } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const candidateSha = /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA! : 'local-unverified-sha'

function disposableDatabasePath() {
  const browserOrigin = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Assignment browser QA requires a loopback origin and the explicitly disposable SQLite fixture.')
  }
  return path
}

function assignmentEvidence(courseId: string, contentId: string) {
  const db = new DatabaseSync(disposableDatabasePath(), { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const publication = db.prepare('SELECT "activePublicationId" AS id FROM "Course" WHERE "id" = ?')
      .get(courseId) as { id: string | null } | undefined
    const submissions = db.prepare('SELECT COUNT(*) AS count FROM "AssignmentSubmission" WHERE "courseId" = ? AND "contentId" = ?')
      .get(courseId, contentId) as { count: number }
    const decisions = db.prepare('SELECT COUNT(*) AS count FROM "AssignmentGradeDecision" g JOIN "AssignmentSubmission" s ON s."id" = g."submissionId" WHERE s."courseId" = ? AND s."contentId" = ?')
      .get(courseId, contentId) as { count: number }
    const progress = db.prepare('SELECT COUNT(*) AS count FROM "CourseContentProgress" WHERE "courseId" = ? AND "contentId" = ?')
      .get(courseId, contentId) as { count: number }
    return { publicationId: publication?.id ?? null, submissions: submissions.count, decisions: decisions.count, progress: progress.count }
  } finally {
    db.close()
  }
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}

test('author grades a real learner assignment and sees current analytics with a bounded CSV export', async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop publication with a 320px resize covers this author workflow without duplicating disposable data.')
  test.setTimeout(240_000)
  disposableDatabasePath()

  const id = randomUUID()
  const title = 'Synthetic assignment ' + id.slice(0, 8)
  const assignmentTitle = 'Reflection task'
  const learnerName = 'Synthetic Learner ' + id.slice(0, 8)
  const answer = 'Synthetic reflection answer for browser QA.'
  const feedback = 'Synthetic feedback: clear and complete.'
  const authorEmail = 'assignment-author-' + id + '@example.test'
  const authorPassword = 'AssignmentAuthorA1!' + id
  const registeredAuthor = await request.post(origin + '/api/register', {
    headers: { origin }, data: { name: 'Synthetic Assignment Author', email: authorEmail, password: authorPassword },
  })
  expect(registeredAuthor.status()).toBe(201)
  await login(page, authorEmail, authorPassword)

  await page.goto('/courses/new')
  await page.getByRole('textbox', { name: 'Kurstitel' }).fill(title)
  await page.getByRole('textbox', { name: 'Kurskategorie' }).fill('Synthetische Browserprüfung')
  await page.getByRole('spinbutton', { name: 'Preis' }).fill('0')
  await page.getByRole('spinbutton', { name: 'Maximale Teilnehmerzahl' }).fill('10')
  const creation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Kursentwurf anlegen', exact: true }).click()
  const created = await creation
  expect(created.status()).toBe(201)
  const { id: courseId } = await created.json() as { id: string }
  await expect(page).toHaveURL(origin + '/courses/' + courseId + '/contents')
  await expect(page.getByRole('button', { name: 'Kursanalyse' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abgaben bewerten' })).toBeDisabled()

  await page.locator('#course-authoring-add').click()
  const dialog = page.getByRole('dialog', { name: 'Inhalt hinzufügen', exact: true })
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill(assignmentTitle)
  await dialog.getByRole('group', { name: 'Inhaltstyp' }).getByRole('button', { name: 'Aufgabe', exact: true }).click()
  const insertion = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses/' + courseId + '/authoring' && response.request().method() === 'PATCH')
  await dialog.getByRole('button', { name: 'Im Entwurf anlegen' }).click()
  const inserted = await insertion
  expect(inserted.status()).toBe(200)
  const insertedBody = await inserted.json() as { draft: { payload: { contents: Array<{ id: string; title: string; type: string }> } } }
  const assignment = insertedBody.draft.payload.contents.find(row => row.title === assignmentTitle && row.type === 'ASSIGNMENT')
  expect(assignment).toBeDefined()
  const contentId = assignment!.id
  const editor = page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true })
  await editor.getByRole('textbox', { name: 'Aufgabentext' }).fill('Write a short synthetic reflection.')
  await editor.getByRole('spinbutton', { name: 'Bestehensgrenze in Prozent' }).fill('70')
  const saving = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses/' + courseId + '/authoring' && response.request().method() === 'PATCH')
  await editor.getByRole('button', { name: 'Entwurf speichern' }).click()
  expect((await saving).status()).toBe(200)
  await expect(editor.getByRole('status').filter({ hasText: /^Gespeicherter Inhalt$/ })).toBeVisible()

  const review = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses/' + courseId + '/authoring/review')
  await page.getByRole('button', { name: 'Änderungen veröffentlichen', exact: true }).first().click()
  expect((await review).status()).toBe(200)
  const publicationDialog = page.getByRole('dialog', { name: 'Veröffentlichung prüfen' })
  await expect(publicationDialog.getByText('Bereit zur Veröffentlichung', { exact: true })).toBeVisible()
  const publication = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses/' + courseId + '/authoring/publish' && response.request().method() === 'POST')
  await publicationDialog.getByRole('button', { name: 'Änderungen veröffentlichen' }).click()
  expect((await publication).status()).toBe(200)
  await expect(page.getByText('Veröffentlicht · Version 1', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abgaben bewerten' })).toBeEnabled()
  expect(assignmentEvidence(courseId, contentId)).toMatchObject({ submissions: 0, decisions: 0, progress: 0 })
  expect(assignmentEvidence(courseId, contentId).publicationId).not.toBeNull()

  const learnerEmail = 'assignment-learner-' + id + '@example.test'
  const learnerPassword = 'AssignmentLearnerA1!' + id
  const registeredLearner = await request.post(origin + '/api/register', {
    headers: { origin }, data: { name: learnerName, email: learnerEmail, password: learnerPassword },
  })
  expect(registeredLearner.status()).toBe(201)
  const learnerContext = await browser.newContext({ baseURL: origin })
  try {
    const learner = await learnerContext.newPage()
    await login(learner, learnerEmail, learnerPassword)
    const enrollment = await learnerContext.request.post(origin + '/api/courses/' + courseId + '/enrollment', { headers: { origin } })
    expect(enrollment.status()).toBe(201)
    expect((await learnerContext.request.get(origin + '/api/courses/' + courseId + '/assignments')).status()).toBe(403)
    expect((await learnerContext.request.get(origin + '/api/courses/' + courseId + '/analytics')).status()).toBe(403)
    expect((await learnerContext.request.get(origin + '/api/courses/' + courseId + '/analytics/export')).status()).toBe(403)

    await learner.goto('/courses/' + courseId + '/contents?content=' + contentId)
    await expect(learner.getByRole('textbox', { name: 'Deine Antwort' })).toBeVisible()
    await expect(learner.getByRole('button', { name: 'Abgaben bewerten' })).toHaveCount(0)
    await expect(learner.getByRole('button', { name: 'Kursanalyse' })).toHaveCount(0)
    await learner.getByRole('textbox', { name: 'Deine Antwort' }).fill(answer)
    const submission = learner.waitForResponse(response => new URL(response.url()).pathname === '/api/courses/' + courseId + '/contents/' + contentId + '/assignment' && response.request().method() === 'POST')
    await learner.getByRole('button', { name: 'Antwort abgeben' }).click()
    expect((await submission).status()).toBe(201)
    await expect(learner.getByRole('status').filter({ hasText: 'Bewertung ausstehend' })).toBeVisible()
    expect(assignmentEvidence(courseId, contentId)).toMatchObject({ submissions: 1, decisions: 0, progress: 0 })

    await page.getByRole('button', { name: 'Kursanalyse' }).click()
    await expect(page.getByRole('heading', { name: 'Kursanalyse' })).toBeVisible()
    const analyticsBefore = await page.request.get(origin + '/api/courses/' + courseId + '/analytics')
    expect(analyticsBefore.status()).toBe(200)
    const before = await analyticsBefore.json() as { summary: { inProgress: number; currentComplete: number }; learners: Array<{ currentStatus: string; completedLeaves: number }> }
    expect(before.summary).toMatchObject({ inProgress: 1, currentComplete: 0 })
    expect(before.learners[0]).toMatchObject({ currentStatus: 'in-progress', completedLeaves: 0 })

    await page.getByRole('link', { name: 'Zum Autorenarbeitsplatz' }).click()
    await expect(page.getByRole('button', { name: 'Abgaben bewerten' })).toBeEnabled()
    await page.getByRole('button', { name: 'Abgaben bewerten' }).click()
    await expect(page.getByRole('heading', { name: 'Abgaben und Bewertungen' })).toBeVisible()
    const gradeRow = page.locator('main ol > li').filter({ hasText: answer }).first()
    await expect(gradeRow).toBeVisible()
    await expect(gradeRow.getByText('Offen', { exact: true })).toBeVisible()
    await gradeRow.getByRole('spinbutton', { name: 'Punkte (0–100)' }).fill('85')
    await gradeRow.getByRole('textbox', { name: 'Rückmeldung (optional)' }).fill(feedback)
    const grading = page.waitForResponse(response => new URL(response.url()).pathname.startsWith('/api/courses/' + courseId + '/assignments/') && new URL(response.url()).pathname.endsWith('/grade') && response.request().method() === 'POST')
    await gradeRow.getByRole('button', { name: 'Bewertung speichern' }).click()
    expect((await grading).status()).toBe(200)
    await expect(page.getByText('Keine offenen Bewertungen', { exact: true })).toBeVisible()
    expect(assignmentEvidence(courseId, contentId)).toMatchObject({ submissions: 1, decisions: 1, progress: 1 })

    await page.getByRole('button', { name: 'Alle Abgaben' }).click()
    const gradedRow = page.locator('main ol > li').filter({ hasText: answer }).first()
    await expect(gradedRow.getByText('Bestanden', { exact: true })).toBeVisible()
    await gradedRow.getByText('Bewertungsverlauf (1)').click()
    await expect(gradedRow.getByText(feedback, { exact: true })).toBeVisible()
    await page.evaluate(async () => { await document.fonts.ready })
    await gradedRow.screenshot({ path: testInfo.outputPath('assignment-grading-populated-desktop-' + candidateSha + '.png'), animations: 'disabled' })

    await learner.reload()
    await expect(learner.getByRole('status').filter({ hasText: 'Bestanden · 85 von 100 Punkten' })).toBeVisible()
    const learnerProgress = await learnerContext.request.get(origin + '/api/courses/' + courseId + '/progress')
    expect(learnerProgress.status()).toBe(200)
    const progressBody = await learnerProgress.json() as { completedContentIds: string[] }
    expect(progressBody.completedContentIds).toContain(contentId)

    await page.goto('/courses/' + courseId + '/analytics')
    const learnerList = page.getByRole('list', { name: 'Lernende im Kurs' })
    const analyticsRow = learnerList.getByRole('listitem').filter({ hasText: learnerName })
    await expect(analyticsRow).toBeVisible()
    await expect(analyticsRow).toContainText('Aktuelle Fassung abgeschlossen')
    await expect(analyticsRow).toContainText('1 von 1 aktuellen Inhalten erledigt')
    const analyticsAfter = await page.request.get(origin + '/api/courses/' + courseId + '/analytics')
    expect(analyticsAfter.status()).toBe(200)
    const after = await analyticsAfter.json() as { summary: { enrolled: number; currentComplete: number }; learners: Array<{ currentStatus: string; completedLeaves: number; totalLeaves: number }> }
    expect(after.summary).toMatchObject({ enrolled: 1, currentComplete: 1 })
    expect(after.learners[0]).toMatchObject({ currentStatus: 'current-complete', completedLeaves: 1, totalLeaves: 1 })

    await page.getByLabel('Status', { exact: true }).selectOption('current-complete')
    await page.getByRole('button', { name: 'Anwenden' }).click()
    await expect(page.getByRole('status').filter({ hasText: '1 Treffer · Seite 1 von 1' })).toBeVisible()
    const exportResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses/' + courseId + '/analytics/export')
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV exportieren' }).click()
    const exported = await exportResponse
    expect(exported.status()).toBe(200)
    expect(exported.headers()['content-type']).toContain('text/csv')
    const csv = await exported.text()
    expect(csv).toContain(learnerName)
    expect(csv).toContain('current-complete')
    expect(csv.trim().split('\n')).toHaveLength(2)
    expect((await download).suggestedFilename()).toBe('kursanalyse.csv')

    await page.setViewportSize({ width: 320, height: 700 })
    await expect(analyticsRow).toBeVisible()
    await page.getByLabel('Status', { exact: true }).focus()
    await expect(page.getByLabel('Status', { exact: true })).toBeFocused()
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.evaluate(async () => { await document.fonts.ready })
    await analyticsRow.screenshot({ path: testInfo.outputPath('course-analytics-populated-320-' + candidateSha + '.png'), animations: 'disabled' })
  } finally {
    await learnerContext.close()
  }
})
