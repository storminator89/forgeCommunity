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
    throw new Error('Question-bank QA requires a loopback origin and the explicitly disposable SQLite fixture.')
  }
  return path
}

function storedBankEvidence(path: string, courseId: string, itemId: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const course = db.prepare('SELECT "activePublicationId" FROM "Course" WHERE "id" = ?').get(courseId) as { activePublicationId: string | null }
    const live = db.prepare('SELECT COUNT(*) AS count FROM "CourseContent" WHERE "courseId" = ? AND "archivedAt" IS NULL').get(courseId) as { count: number }
    const revisions = db.prepare('SELECT COUNT(*) AS count FROM "QuestionBankRevision" WHERE "itemId" = ?').get(itemId) as { count: number }
    return { publicationId: course.activePublicationId, liveNodes: live.count, revisions: revisions.count }
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

test('author versions a private bank question and copies a historical revision into a draft quiz', async ({ page, request, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One desktop journey covers the bounded question-bank flow.')
  const dbPath = disposableDatabasePath()
  const id = randomUUID()
  const email = `bank-author-${id}@example.test`
  const password = `BankAuthorA1!${id}`
  const courseTitle = `Private bank fixture ${id.slice(0, 8)}`
  const firstQuestion = 'Welches Wort gehört zur ersten Version?'
  const revisedQuestion = 'Welches Wort gehört zur zweiten Version?'

  const anonymousList = await request.get(`${origin}/api/courses/questions`)
  expect(anonymousList.status()).toBe(401)
  const registration = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Question Bank Author Fixture', email, password },
  })
  expect(registration.status()).toBe(201)
  await login(page, email, password)

  await page.goto('/courses/new')
  await page.getByRole('textbox', { name: 'Kurstitel' }).fill(courseTitle)
  await page.getByRole('textbox', { name: 'Kurskategorie' }).fill('Synthetische Browserprüfung')
  await page.getByRole('spinbutton', { name: 'Preis' }).fill('0')
  await page.getByRole('spinbutton', { name: 'Maximale Teilnehmerzahl' }).fill('20')
  const courseResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses' && response.request().method() === 'POST')
  await keyboardActivate(page, page.getByRole('button', { name: 'Kursentwurf anlegen', exact: true }))
  const created = await courseResponse
  expect(created.status()).toBe(201)
  const { id: courseId } = await created.json() as { id: string }
  await expect(page).toHaveURL(`${origin}/courses/${courseId}/contents`)

  await keyboardActivate(page, page.locator('#course-authoring-add'))
  const dialog = page.getByRole('dialog', { name: 'Inhalt hinzufügen', exact: true })
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill('Privater Wissenstest')
  await keyboardActivate(page, dialog.getByRole('group', { name: 'Inhaltstyp' }).getByRole('button', { name: 'Quiz', exact: true }))
  const nodeResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/courses/${courseId}/authoring` && response.request().method() === 'PATCH')
  await keyboardActivate(page, dialog.getByRole('button', { name: 'Im Entwurf anlegen', exact: true }))
  const nodeCreated = await nodeResponse
  expect(nodeCreated.status()).toBe(200)
  const nodeBody = await nodeCreated.json() as { draft: { payload: { contents: Array<{ id: string; title: string; type: string }> } } }
  const nodeId = nodeBody.draft.payload.contents.find(node => node.title === 'Privater Wissenstest' && node.type === 'QUIZ')?.id
  expect(nodeId).toBeTruthy()

  const form = page.getByRole('form', { name: 'Inhalt bearbeiten', exact: true })
  await form.getByLabel('Neue Frage als').selectOption('TEXT_INPUT')
  await keyboardActivate(page, form.getByRole('button', { name: 'Neue Frage', exact: true }))
  await form.getByRole('textbox', { name: 'Frage', exact: true }).fill(firstQuestion)
  await form.getByRole('textbox', { name: 'Richtige Antwort für Frage 1' }).fill('Erstes Testwort')

  const panel = form.locator('section[aria-label="Eigener Fragenpool"]')
  await expect(panel.getByRole('button', { name: 'Fragenpool öffnen' })).toBeVisible()
  await keyboardActivate(page, panel.getByRole('button', { name: 'Fragenpool öffnen' }))
  await expect(panel.getByText('Noch keine gespeicherten Fragen.', { exact: false })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Als Pool-Frage speichern' })).toBeEnabled()
  const newBankResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/courses/questions' && response.request().method() === 'POST')
  await keyboardActivate(page, panel.getByRole('button', { name: 'Als Pool-Frage speichern' }))
  const bankCreated = await newBankResponse
  expect(bankCreated.status()).toBe(201)
  const { id: itemId } = await bankCreated.json() as { id: string }
  await expect(panel.getByRole('status').filter({ hasText: 'Das Quiz bleibt unverändert.' })).toBeVisible()
  await expect(panel.getByLabel('Pool-Frage')).toContainText(firstQuestion)
  await expect(panel.getByLabel('Version')).toHaveValue('1')
  await expect(panel.getByRole('button', { name: 'Version als Kopie einfügen' })).toBeEnabled()

  if (testInfo.project.name === 'desktop-chromium') {
    await page.evaluate(async () => { await document.fonts.ready })
    await panel.screenshot({ path: testInfo.outputPath(`question-bank-populated-desktop-${candidateSha}.png`), animations: 'disabled' })
  }

  await form.getByRole('textbox', { name: 'Frage', exact: true }).fill(revisedQuestion)
  await form.getByRole('textbox', { name: 'Richtige Antwort für Frage 1' }).fill('Zweites Testwort')
  const revisionResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/courses/questions/${itemId}` && response.request().method() === 'PATCH')
  await keyboardActivate(page, panel.getByRole('button', { name: 'Neue Version speichern' }))
  expect((await revisionResponse).status()).toBe(200)
  await expect(panel.getByRole('status').filter({ hasText: 'Vorhandene Quizfragen bleiben unverändert.' })).toBeVisible()
  await expect(panel.getByLabel('Version')).toHaveValue('2')
  await expect(panel.getByLabel('Version').locator('option')).toHaveText(['Version 2', 'Version 1'])
  await expect(panel.getByLabel('Pool-Frage')).toContainText(revisedQuestion)
  expect(storedBankEvidence(dbPath, courseId, itemId)).toEqual({ publicationId: null, liveNodes: 0, revisions: 2 })

  await panel.getByLabel('Version').selectOption('1')
  const oldRevisionResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/courses/questions/${itemId}/revisions/1` && response.request().method() === 'GET')
  await keyboardActivate(page, panel.getByRole('button', { name: 'Version als Kopie einfügen' }))
  expect((await oldRevisionResponse).status()).toBe(200)
  await expect(panel.getByRole('status').filter({ hasText: 'als Kopie in dieses Quiz eingefügt' })).toBeVisible()
  await expect(form.getByRole('textbox', { name: 'Frage', exact: true })).toHaveCount(2)
  await expect(form.getByRole('textbox', { name: 'Frage', exact: true }).nth(0)).toHaveValue(revisedQuestion)
  await expect(form.getByRole('textbox', { name: 'Frage', exact: true }).nth(1)).toHaveValue(firstQuestion)
  await expect(form.getByRole('textbox', { name: 'Richtige Antwort für Frage 2' })).toHaveValue('Erstes Testwort')

  const draftResponse = page.waitForResponse(response => new URL(response.url()).pathname === `/api/courses/${courseId}/authoring` && response.request().method() === 'PATCH')
  await keyboardActivate(page, form.getByRole('button', { name: 'Entwurf speichern', exact: true }))
  const draftSaved = await draftResponse
  expect(draftSaved.status()).toBe(200)
  const draftBody = await draftSaved.json() as { draft: { payload: { contents: Array<{ id: string; content: string }> } } }
  const savedNode = draftBody.draft.payload.contents.find(node => node.id === nodeId)
  expect(savedNode).toBeDefined()
  const savedQuiz = JSON.parse(savedNode!.content) as { questions: Array<{ id: string; question: string; correctAnswer: string }> }
  expect(savedQuiz.questions.map(question => question.question)).toEqual([revisedQuestion, firstQuestion])
  expect(savedQuiz.questions.map(question => question.correctAnswer)).toEqual(['Zweites Testwort', 'Erstes Testwort'])
  expect(savedQuiz.questions[0].id).not.toBe(savedQuiz.questions[1].id)
  expect(storedBankEvidence(dbPath, courseId, itemId)).toEqual({ publicationId: null, liveNodes: 0, revisions: 2 })

  const list = await page.request.get(`${origin}/api/courses/questions`)
  expect(list.status()).toBe(200)
  const listing = await list.json() as { questions: Array<{ id: string; latestRevision: number; question: string }> }
  expect(listing.questions.find(question => question.id === itemId)).toMatchObject({ latestRevision: 2, question: revisedQuestion })
  expect(JSON.stringify(listing)).not.toContain('Zweites Testwort')

  const learnerEmail = `bank-learner-${id}@example.test`
  const learnerPassword = `BankLearnerA1!${id}`
  const learnerRegistration = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Question Bank Learner Fixture', email: learnerEmail, password: learnerPassword },
  })
  expect(learnerRegistration.status()).toBe(201)
  const learnerContext = await browser.newContext({ baseURL: origin })
  try {
    const learner = await learnerContext.newPage()
    await login(learner, learnerEmail, learnerPassword)
    const learnerList = await learnerContext.request.get(`${origin}/api/courses/questions`)
    expect(learnerList.status()).toBe(200)
    expect(await learnerList.json()).toEqual({ questions: [], nextCursor: null })
    expect((await learnerContext.request.get(`${origin}/api/courses/questions/${itemId}`)).status()).toBe(404)
    expect((await learnerContext.request.get(`${origin}/api/courses/questions/${itemId}/revisions/1`)).status()).toBe(404)
    expect((await learnerContext.request.get(`${origin}/api/courses/${courseId}/contents`)).status()).toBe(404)
  } finally {
    await learnerContext.close()
  }
})
