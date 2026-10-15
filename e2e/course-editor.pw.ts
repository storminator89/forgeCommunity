import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Locator, type Page } from '@playwright/test'

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
    throw new Error('Course publication QA requires a loopback origin and the explicitly disposable SQLite fixture.')
  }
  return path
}

function courseEvidence(courseId: string) {
  const db = new DatabaseSync(disposableDatabasePath(), { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const course = db.prepare('SELECT "activePublicationId" FROM "Course" WHERE "id" = ?').get(courseId) as { activePublicationId: string | null } | undefined
    const live = db.prepare('SELECT COUNT(*) AS count FROM "CourseContent" WHERE "courseId" = ? AND "archivedAt" IS NULL').get(courseId) as { count: number }
    const attempts = db.prepare('SELECT COUNT(*) AS count FROM "QuizAttempt" WHERE "courseId" = ?').get(courseId) as { count: number }
    const progress = db.prepare('SELECT COUNT(*) AS count FROM "CourseContentProgress" WHERE "courseId" = ?').get(courseId) as { count: number }
    return { activePublicationId: course?.activePublicationId ?? null, liveNodes: live.count, attempts: attempts.count, progress: progress.count }
  } finally {
    db.close()
  }
}

async function keyboardActivate(page: Page, target: Locator) {
  await target.focus()
  await expect(target).toBeFocused()
  await page.keyboard.press('Enter')
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}

async function createNode(page: Page, courseId: string, title: string, type: 'TEXT' | 'QUIZ') {
  await keyboardActivate(page, page.locator('#course-authoring-add'))
  const dialog = page.getByRole('dialog', { name: 'Inhalt hinzufügen', exact: true })
  await expect(dialog.getByRole('textbox', { name: 'Titel', exact: true })).toBeFocused()
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill(title)
  if (type === 'QUIZ') await keyboardActivate(page, dialog.getByRole('group', { name: 'Inhaltstyp' }).getByRole('button', { name: 'Quiz', exact: true }))
  await expect(dialog).toContainText('nur im privaten Entwurf gespeichert')
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/courses/' + courseId + '/authoring' && entry.request().method() === 'PATCH')
  await keyboardActivate(page, dialog.getByRole('button', { name: 'Im Entwurf anlegen', exact: true }))
  const saved = await response
  expect(saved.status()).toBe(200)
  const body = await saved.json() as { draft: { payload: { contents: Array<{ id: string; title: string; type: string }> } } }
  const node = body.draft.payload.contents.find(row => row.title === title && row.type === type)
  expect(node).toBeDefined()
  await expect(dialog).toHaveCount(0)
  return node!.id
}

async function saveNode(page: Page, courseId: string) {
  const form = page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true })
  const response = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/courses/' + courseId + '/authoring' && entry.request().method() === 'PATCH')
  await keyboardActivate(page, form.getByRole('button', { name: 'Entwurf speichern', exact: true }))
  expect((await response).status()).toBe(200)
  await expect(form.getByRole('status').filter({ hasText: /^Gespeicherter Inhalt$/ })).toBeVisible()
}

async function reviewAndPublish(page: Page, courseId: string, sequence: number, onReady?: () => Promise<void>) {
  const reviewResponse = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/courses/' + courseId + '/authoring/review')
  await keyboardActivate(page, page.getByRole('button', { name: 'Änderungen veröffentlichen', exact: true }).first())
  expect((await reviewResponse).status()).toBe(200)
  const dialog = page.getByRole('dialog', { name: 'Veröffentlichung prüfen', exact: true })
  await expect(dialog.getByText('Bereit zur Veröffentlichung', { exact: true })).toBeVisible()
  await expect(dialog).toContainText('Bereits ausgestellte Zertifikate bleiben gültig')
  await onReady?.()
  const publishResponse = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/courses/' + courseId + '/authoring/publish' && entry.request().method() === 'POST')
  await keyboardActivate(page, dialog.getByRole('button', { name: 'Änderungen veröffentlichen', exact: true }))
  expect((await publishResponse).status()).toBe(200)
  await expect(page.getByText('Veröffentlicht · Version ' + sequence, { exact: true }).first()).toBeVisible()
}

// Replace the pre-cutover live-save test: every browser mutation now goes
// through a private CAS draft, and publishing requires a separate review.
test('private course authoring, publication and latest learner content use real disposable data', async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-390-chromium', 'Desktop and 320px cover the author workspace breakpoints without a third synthetic publication.')
  test.setTimeout(240_000)
  disposableDatabasePath()

  const id = randomUUID()
  const courseTitle = 'Private publication ' + id.slice(0, 8)
  const email = 'course-author-' + id + '@example.test'
  const password = 'CourseAuthorA1!' + id
  const registration = await request.post(origin + '/api/register', {
    headers: { origin }, data: { name: 'Publication Author Fixture', email, password },
  })
  expect(registration.status()).toBe(201)
  await login(page, email, password)

  await page.goto('/courses/new')
  await page.getByRole('textbox', { name: 'Kurstitel' }).fill(courseTitle)
  await page.getByRole('textbox', { name: 'Kurskategorie' }).fill('Synthetische Browserprüfung')
  await page.getByRole('spinbutton', { name: 'Preis' }).fill('0')
  await page.getByRole('spinbutton', { name: 'Maximale Teilnehmerzahl' }).fill('20')
  const creation = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/courses' && entry.request().method() === 'POST')
  await keyboardActivate(page, page.getByRole('button', { name: 'Kursentwurf anlegen', exact: true }))
  const created = await creation
  expect(created.status()).toBe(201)
  const { id: courseId } = await created.json() as { id: string }
  await expect(page).toHaveURL(origin + '/courses/' + courseId + '/contents')
  await expect(page.getByText('Noch nicht veröffentlicht', { exact: true })).toBeVisible()
  expect(courseEvidence(courseId)).toMatchObject({ activePublicationId: null, liveNodes: 0, attempts: 0, progress: 0 })

  // A saved draft must be rediscoverable by its owner, while the ordinary
  // course catalogue remains publication-only.
  await page.goto('/courses')
  await expect(page.getByRole('link', { name: 'Meine Kursentwürfe' })).toBeVisible()
  await expect(page.getByText(courseTitle, { exact: true })).toHaveCount(0)
  const publicBefore = await page.request.get(origin + '/api/courses')
  expect(publicBefore.status()).toBe(200)
  expect((await publicBefore.json() as Array<{ id: string }>).some(row => row.id === courseId)).toBe(false)
  await page.getByRole('link', { name: 'Meine Kursentwürfe' }).click()
  const listItem = page.getByRole('listitem').filter({ hasText: courseTitle })
  await expect(listItem.getByText('Privater Entwurf', { exact: true })).toBeVisible()
  await listItem.getByRole('link', { name: 'Im Autorenarbeitsplatz öffnen' }).click()
  await expect(page.getByRole('heading', { level: 1, name: courseTitle })).toBeVisible()

  const textId = await createNode(page, courseId, 'Erste Lektion', 'TEXT')
  let form = page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true })
  await form.getByRole('switch', { name: 'HTML' }).focus()
  await page.keyboard.press('Space')
  const firstText = 'Synthetischer Lerntext der ersten Veröffentlichung.'
  await form.getByRole('textbox', { name: 'Inhalt' }).fill('<p>' + firstText + '</p>')
  await expect(page.getByText('Ungespeicherte Änderungen', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Änderungen veröffentlichen', exact: true }).first()).toBeDisabled()
  await saveNode(page, courseId)
  if (testInfo.project.name === 'desktop-chromium') {
    await page.evaluate(async () => { await document.fonts.ready })
    await page.screenshot({ path: testInfo.outputPath('private-author-outline-editor-desktop-' + candidateSha + '.png'), animations: 'disabled' })
  }

  const quizId = await createNode(page, courseId, 'Wissenscheck', 'QUIZ')
  form = page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true })
  await expect(form.getByLabel('Neue Frage als')).toBeVisible()
  await form.getByLabel('Neue Frage als').selectOption('TEXT_INPUT')
  await keyboardActivate(page, form.getByRole('button', { name: 'Neue Frage', exact: true }))
  await form.getByRole('textbox', { name: 'Frage', exact: true }).fill('Welches Testwort gehört zum Kurs?')
  await form.getByRole('textbox', { name: 'Richtige Antwort für Frage 1' }).fill('Lernpfad')

  const learnerWrites: string[] = []
  page.on('request', entry => {
    const url = new URL(entry.url())
    if (url.origin === origin && url.pathname.startsWith('/api/courses/' + courseId) &&
        (url.pathname.endsWith('/progress') || url.pathname.endsWith('/attempts')) &&
        !['GET', 'HEAD'].includes(entry.method())) learnerWrites.push(entry.method() + ' ' + url.pathname)
  })
  const beforePreview = courseEvidence(courseId)
  await keyboardActivate(page, page.getByRole('button', { name: 'Vorschau', exact: true }))
  const preview = page.getByRole('dialog', { name: 'Kursvorschau', exact: true })
  await expect(preview).toContainText('Entwurfsvorschau. Antworten und Abschlüsse werden nicht gespeichert.')
  await expect(preview).toContainText('Welches Testwort gehört zum Kurs?')
  await preview.getByRole('textbox', { name: 'Vorschauantwort zu Frage 1' }).fill('Probeantwort')
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  // Wait for dialog focus restoration before moving focus to the save button.
  // Otherwise the restoration can race and steal focus after keyboardActivate().
  await expect(page.getByRole('button', { name: 'Vorschau', exact: true })).toBeFocused()
  expect(learnerWrites).toEqual([])
  expect(courseEvidence(courseId)).toEqual(beforePreview)

  await saveNode(page, courseId)
  const prerequisite = page.getByRole('checkbox', { name: /Erste Lektion/ })
  await prerequisite.focus()
  await expect(prerequisite).toBeFocused()
  const prerequisiteSave = page.waitForResponse(entry => new URL(entry.url()).pathname === '/api/courses/' + courseId + '/authoring' && entry.request().method() === 'PATCH')
  await page.keyboard.press('Space')
  expect((await prerequisiteSave).status()).toBe(200)
  await expect(prerequisite).toBeChecked()
  await expect(page.getByText('1 Voraussetzung im Entwurf', { exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: 'Kursstruktur bearbeiten' }).getByTitle('Erste Lektion', { exact: true }).click()
  await reviewAndPublish(page, courseId, 1, async () => {
    const dialog = page.getByRole('dialog', { name: 'Veröffentlichung prüfen' })
    await expect(dialog.getByText('Neu', { exact: true }).locator('..').getByText('2', { exact: true })).toBeVisible()
    await expect(dialog).toContainText('Neue oder geänderte Lerninhalte können einen erneuten Abschluss in der aktuellen Fassung erfordern.')
    await expect(dialog).toContainText('Änderungen am Lernpfad oder an Bewertungen können bisherige Freigaben und Belohnungen beeinflussen.')
    if (testInfo.project.name === 'desktop-chromium') {
      await page.evaluate(async () => { await document.fonts.ready })
      await page.screenshot({ path: testInfo.outputPath('publication-review-desktop-' + candidateSha + '.png'), animations: 'disabled' })
    }
  })
  expect(courseEvidence(courseId)).toMatchObject({ liveNodes: 2, attempts: 0, progress: 0 })
  expect(courseEvidence(courseId).activePublicationId).not.toBeNull()
  const publicAfter = await page.request.get(origin + '/api/courses')
  expect((await publicAfter.json() as Array<{ id: string }>).some(row => row.id === courseId)).toBe(true)

  // Capture one real post-publication mobile viewport only. The selected text
  // lesson has no quiz answer key and all content/account data are synthetic.
  await page.goto('/courses/' + courseId + '/contents?content=' + textId)
  await expect(page.getByRole('form', { name: 'Inhalt bearbeiten' })).toBeVisible()
  if (testInfo.project.name === 'mobile-320-chromium') {
    await keyboardActivate(page, page.getByRole('button', { name: 'Kursstruktur schließen' }))
    await page.evaluate(() => document.getElementById('page-content')?.scrollTo(0, 0))
    await page.evaluate(async () => { await document.fonts.ready })
    const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('published-author-workspace-320-' + candidateSha + '.png'), animations: 'disabled' })
  }

  // A real learner follows the newest publication and a changed lesson needs
  // a fresh current completion; no historical mark is fabricated or erased.
  const learnerEmail = 'course-learner-' + id + '@example.test'
  const learnerPassword = 'CourseLearnerA1!' + id
  const learnerRegistration = await request.post(origin + '/api/register', {
    headers: { origin }, data: { name: 'Publication Learner Fixture', email: learnerEmail, password: learnerPassword },
  })
  expect(learnerRegistration.status()).toBe(201)
  const learnerContext = await browser.newContext({ baseURL: origin })
  try {
    const learner = await learnerContext.newPage()
    await login(learner, learnerEmail, learnerPassword)
    const enrollment = await learnerContext.request.post(origin + '/api/courses/' + courseId + '/enrollment', { headers: { origin } })
    expect(enrollment.status()).toBe(201)
    await learner.goto('/courses/' + courseId + '/contents?content=' + quizId)
    await expect(learner.getByText('Inhalt gesperrt', { exact: true })).toBeVisible()
    await expect(learner.getByRole('button', { name: 'Erste Lektion öffnen' })).toBeVisible()
    await expect(learner.getByText('Welches Testwort gehört zum Kurs?')).toHaveCount(0)
    if (testInfo.project.name === 'mobile-320-chromium') {
      const missingLink = learner.getByRole('button', { name: 'Erste Lektion öffnen' })
      await missingLink.focus()
      await expect(missingLink).toBeFocused()
      await learner.evaluate(async () => { await document.fonts.ready })
      const overflow = await learner.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)
      expect(overflow).toBeLessThanOrEqual(1)
      await learner.screenshot({ path: testInfo.outputPath('learner-locked-path-320-' + candidateSha + '.png'), animations: 'disabled' })
      await learner.keyboard.press('Enter')
    } else await keyboardActivate(learner, learner.getByRole('button', { name: 'Erste Lektion öffnen' }))
    await expect(learner.getByText(firstText, { exact: true })).toBeVisible()
    await keyboardActivate(learner, learner.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true }))
    await expect(learner.getByRole('button', { name: 'Abschlussmarkierung entfernen', exact: true })).toBeVisible()
    await learner.goto('/courses/' + courseId + '/contents?content=' + quizId)
    await expect(learner.getByText('Inhalt gesperrt', { exact: true })).toHaveCount(0)
    await expect(learner.getByText('Welches Testwort gehört zum Kurs?')).toBeVisible()
    if (testInfo.project.name === 'mobile-320-chromium') {
      await learner.evaluate(async () => { await document.fonts.ready })
      await learner.screenshot({ path: testInfo.outputPath('learner-unlocked-path-320-' + candidateSha + '.png'), animations: 'disabled' })
      return
    }
    await learner.goto('/courses/' + courseId + '/contents?content=' + textId)
    await expect(learner.getByText(firstText, { exact: true })).toBeVisible()

    form = page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true })
    await form.getByRole('switch', { name: 'HTML' }).focus()
    await page.keyboard.press('Space')
    const updatedText = 'Synthetischer Lerntext der zweiten Veröffentlichung.'
    await form.getByRole('textbox', { name: 'Inhalt' }).fill('<p>' + updatedText + '</p>')
    await saveNode(page, courseId)
    await reviewAndPublish(page, courseId, 2)
    await learner.reload()
    await expect(learner.getByText(updatedText, { exact: true })).toBeVisible()
    await expect(learner.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true })).toBeVisible()
  } finally {
    await learnerContext.close()
  }
})
