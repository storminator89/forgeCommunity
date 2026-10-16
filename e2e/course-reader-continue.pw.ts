import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const candidateSha = /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA! : 'local-unverified-sha'
type Node = { id: string; parentId: string | null; title: string; content: string; order: number; type: 'TEXT'; prerequisiteIds?: string[]; releaseOn?: string }
type LearnerNode = Node & { locked: boolean; contentVersionToken: string | null; missingPrerequisites: Array<{ id: string }>; subContents: LearnerNode[] }
type Progress = { completedContentIds: string[]; complete: boolean }

function disposableDatabasePath() {
  const browserOrigin = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Reader continue browser QA requires a loopback origin and the explicitly disposable SQLite fixture.')
  }
  return path
}

function seedReaders(path: string, instructorId: string, nonce: string) {
  const chapter = { id: `chapter-${nonce}`, parentId: null, title: 'Ein Projekt beginnen', content: '', order: 1, type: 'TEXT' as const }
  const group = { ...chapter, id: `group-${nonce}`, parentId: chapter.id, title: 'Gemeinsam weiterlernen' }
  // IDs and insertion order deliberately disagree with the nested lesson order.
  const first = { ...chapter, id: `z-first-${nonce}`, parentId: group.id, title: 'Ein Lernziel festhalten', content: '<p>Synthetischer Lerntext zum ersten Lernziel.</p>' }
  const next = { ...first, id: `a-next-${nonce}`, title: 'Den nächsten Schritt planen', content: '<p>Synthetischer Lerntext zum nächsten Schritt.</p>', order: 2, prerequisiteIds: [first.id] }
  const locked = { ...chapter, id: `future-${nonce}`, title: 'Ein späteres Kapitel', content: '<p>Synthetischer gesperrter Lerntext.</p>', releaseOn: '2099-11-01' }
  const fixtures: Array<{ courseId: string; title: string; nodes: Node[] }> = [
    { courseId: `reader-${nonce}`, title: 'Synthetischer Kurs zum Weiterlernen', nodes: [chapter, group, next, first] },
    { courseId: `reader-empty-${nonce}`, title: 'Synthetischer leerer Kurs', nodes: [] },
    { courseId: `reader-locked-${nonce}`, title: 'Synthetischer Kurs vor Freigabe', nodes: [locked] },
  ]
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN')
    for (const fixture of fixtures) {
      const publicationId = `publication-${fixture.courseId}`
      const payload = JSON.stringify({ schemaVersion: 1, title: fixture.title, description: 'Browser-Fixture', startDate: null, endDate: null, imageUrl: null, contents: fixture.nodes })
      db.prepare(`INSERT INTO "Course" ("id", "title", "description", "instructorId", "price", "updatedAt")
        VALUES (?, ?, 'Browser-Fixture', ?, 0, CURRENT_TIMESTAMP)`).run(fixture.courseId, fixture.title, instructorId)
      for (const node of fixture.nodes) db.prepare(`INSERT INTO "CourseContent" ("id", "title", "content", "order", "courseId", "parentId", "type", "updatedAt")
        VALUES (?, ?, ?, ?, ?, ?, 'TEXT', CURRENT_TIMESTAMP)`).run(node.id, node.title, node.content, node.order, fixture.courseId, node.parentId)
      db.prepare(`INSERT INTO "CoursePublication" ("id", "courseId", "sequence", "source", "payload", "digest", "contentCount")
        VALUES (?, ?, 1, 'AUTHOR', ?, ?, ?)`).run(publicationId, fixture.courseId, payload, `qa-${fixture.courseId}`, fixture.nodes.length)
      db.prepare(`INSERT INTO "CourseDraft" ("courseId", "basePublicationId", "payload", "digest", "updatedAt")
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(fixture.courseId, publicationId, payload, `qa-${fixture.courseId}`)
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(publicationId, fixture.courseId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally { db.close() }
  return { fixtures, courseId: fixtures[0].courseId, first, next, locked }
}

function storedCompleted(path: string, courseId: string, userId: string) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    return (db.prepare('SELECT "contentId" FROM "CourseContentProgress" WHERE "courseId" = ? AND "userId" = ? ORDER BY "contentId"')
      .all(courseId, userId) as Array<{ contentId: string }>).map(row => row.contentId)
  } finally { db.close() }
}

function flatten(nodes: LearnerNode[]): LearnerNode[] {
  return nodes.flatMap(node => [node, ...flatten(node.subContents)])
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}

async function keyboardActivate(page: Page, action: Locator) {
  await page.keyboard.press('Tab')
  await action.focus()
  await expect(action).toBeFocused()
  expect(await action.evaluate(element => element.matches(':focus-visible'))).toBe(true)
  await page.keyboard.press('Enter')
}

async function captureReaderTextZoom(page: Page, info: TestInfo, state: string, mode: 'light' | 'dark') {
  const reader = page.getByRole('region', { name: 'Ausgewählter Kursinhalt' })
  const refresh = reader.getByRole('button', { name: 'Lernfortschritt aktualisieren', exact: true })
  const originalRootSize = await page.locator('html').evaluate(element => element.style.fontSize)
  const rootPixels = await page.locator('html').evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  const originalLabelPixels = await refresh.evaluate(element => parseFloat(getComputedStyle(element).fontSize))
  try {
    // Actual text enlargement changes computed font size and layout. Do not use
    // a screenshot transform, device scale factor, or an overflow-hiding rule.
    await page.locator('html').evaluate((element, pixels) => { element.style.fontSize = `${pixels * 2}px` }, rootPixels)
    await expect.poll(() => refresh.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(originalLabelPixels * 1.99)
    await page.keyboard.press('Tab')
    await refresh.focus()
    await expect(refresh).toBeFocused()
    await expect(refresh).toBeInViewport({ ratio: 1 })
    expect(await refresh.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth), `${state} ${mode} 320px text200 document overflow`).toBeLessThanOrEqual(1)
    expect(await page.locator('#page-content').evaluate(element => element.scrollWidth - element.clientWidth), `${state} text200 main overflow`).toBeLessThanOrEqual(1)
    expect(await reader.evaluate(element => element.scrollWidth - element.clientWidth), `${state} text200 reader overflow`).toBeLessThanOrEqual(1)
    for (const action of await reader.getByRole('button', { name: /^(Kurs starten|Nächste Lektion öffnen|Lernfortschritt aktualisieren)$/ }).all()) {
      const bounds = await action.evaluate(element => {
        const rect = element.getBoundingClientRect()
        const parent = element.parentElement!.getBoundingClientRect()
        return { height: rect.height, fits: rect.left >= parent.left - 1 && rect.right <= parent.right + 1,
          overflowX: element.scrollWidth - element.clientWidth, overflowY: element.scrollHeight - element.clientHeight }
      })
      expect(bounds.height).toBeGreaterThanOrEqual(44)
      expect(bounds.fits).toBe(true)
      expect(bounds.overflowX).toBeLessThanOrEqual(1)
      expect(bounds.overflowY).toBeLessThanOrEqual(1)
    }
    await page.screenshot({ path: info.outputPath(`reader-${state}-refresh-text200-${mode}-320-${candidateSha}.png`), fullPage: true, animations: 'disabled' })
    const checking = page.waitForResponse(response => /\/api\/courses\/[^/]+\/progress$/.test(new URL(response.url()).pathname) && response.request().method() === 'GET')
    await page.keyboard.press('Enter')
    expect((await checking).status()).toBe(200)
    await expect(refresh).toBeEnabled()
  } finally {
    await page.locator('html').evaluate((element, previous) => { element.style.fontSize = previous }, originalRootSize)
  }
}

async function capture(page: Page, info: TestInfo, state: string, focus?: Locator) {
  for (const mode of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Farbschema auswählen' }).click()
    await page.getByRole('menuitem', { name: mode === 'light' ? 'Hell' : 'Dunkel', exact: true }).click()
    if (mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 700 }]) {
      await page.setViewportSize(viewport)
      await page.evaluate(async () => { await document.fonts.ready })
      if (!focus) await page.getByRole('region', { name: 'Ausgewählter Kursinhalt' }).getByRole('heading').first().scrollIntoViewIfNeeded()
      if (focus) {
        await page.keyboard.press('Tab')
        await focus.focus()
        await expect(focus).toBeFocused()
        await expect(focus).toBeInViewport({ ratio: 1 })
        expect(await focus.evaluate(element => element.matches(':focus-visible'))).toBe(true)
      }
      expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth), `${state} ${mode} ${viewport.width}px document overflow`).toBeLessThanOrEqual(1)
      expect(await page.locator('#page-content').evaluate(element => element.scrollWidth - element.clientWidth), `${state} main overflow`).toBeLessThanOrEqual(1)
      expect(await page.getByRole('region', { name: 'Ausgewählter Kursinhalt' }).evaluate(element => element.scrollWidth - element.clientWidth), `${state} reader overflow`).toBeLessThanOrEqual(1)
      await page.screenshot({ path: info.outputPath(`reader-${state}-${mode}-${viewport.width}-${candidateSha}.png`), fullPage: true, animations: 'disabled' })
      if (viewport.width === 320 && (state === 'entry' || state === 'completed-with-next')) await captureReaderTextZoom(page, info, state, mode)
    }
  }
}

test('reader opens and continues only on explicit learner actions with current server-unlocked progress', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'One disposable real-reader journey captures desktop and 320px in both themes.')
  test.setTimeout(300_000)
  const path = disposableDatabasePath()
  const nonce = randomUUID()
  const password = `ReaderContinueQA1!${nonce}`
  const authorEmail = `reader-author-${nonce}@example.test`
  const learnerEmail = `reader-learner-${nonce}@example.test`
  const author = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name: 'Reader QA Author', email: authorEmail, password } })
  const learner = await request.post(`${origin}/api/register`, { headers: { origin }, data: { name: 'Reader QA Learner', email: learnerEmail, password } })
  expect(author.status()).toBe(201)
  expect(learner.status()).toBe(201)
  const instructorId = (await author.json() as { userId: string }).userId
  const learnerId = (await learner.json() as { userId: string }).userId
  const fixture = seedReaders(path, instructorId, nonce)
  const base = `/courses/${fixture.courseId}/contents`
  const progressPath = `/api/courses/${fixture.courseId}/progress`
  const contentsPath = `/api/courses/${fixture.courseId}/contents`
  const reader = page.getByRole('region', { name: 'Ausgewählter Kursinhalt' })
  const firstHeading = reader.getByRole('heading', { name: fixture.first.title, level: 2, exact: true })
  const nextHeading = reader.getByRole('heading', { name: fixture.next.title, level: 2, exact: true })
  const saved = () => storedCompleted(path, fixture.courseId, learnerId)
  const progressPaths = new Set(fixture.fixtures.map(course => `/api/courses/${course.courseId}/progress`))
  const patches: Array<{ contentId: string; completed: boolean }> = []
  page.on('request', incoming => {
    if (progressPaths.has(new URL(incoming.url()).pathname) && incoming.method() === 'PATCH') {
      const body = incoming.postDataJSON() as { contentId: string; completed: boolean }
      // Retain no opaque content-version token in browser evidence or reports.
      patches.push({ contentId: body.contentId, completed: body.completed })
    }
  })
  await login(page, learnerEmail, password)
  for (const course of fixture.fixtures) expect((await page.request.post(`${origin}/api/courses/${course.courseId}/enrollment`, { headers: { origin } })).status()).toBe(201)
  const contents = await page.request.get(`${origin}${contentsPath}`)
  expect(contents.status()).toBe(200)
  const before = flatten(await contents.json() as LearnerNode[])
  expect(before.find(node => node.id === fixture.first.id)?.locked).toBe(false)
  expect(before.find(node => node.id === fixture.next.id)).toMatchObject({ locked: true, content: '', contentVersionToken: null, missingPrerequisites: [{ id: fixture.first.id }] })

  await page.goto(base)
  await expect(reader.getByRole('heading', { name: 'Dein nächster Lernschritt', exact: true })).toBeVisible()
  await expect(reader).toContainText(fixture.first.title)
  const start = reader.getByRole('button', { name: 'Kurs starten', exact: true })
  await expect(start).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true })).toHaveCount(0)
  await expect(page.locator('#course-contents-navigation [aria-current="page"]')).toHaveCount(0)
  await capture(page, info, 'entry', start)
  expect(new URL(page.url()).searchParams.has('content')).toBe(false)
  expect(saved()).toEqual([])
  expect(patches).toEqual([])

  await keyboardActivate(page, start)
  await expect(page).toHaveURL(url => url.pathname === base && url.searchParams.get('content') === fixture.first.id)
  await expect(firstHeading).toBeFocused()
  await expect(reader.getByText('Synthetischer Lerntext zum ersten Lernziel.', { exact: true })).toBeVisible()
  await capture(page, info, 'first-open', firstHeading)
  expect(saved()).toEqual([])
  expect(patches).toEqual([])

  async function complete(contentId: string, expectedIds: string[], allComplete: boolean) {
    const saving = page.waitForResponse(response => new URL(response.url()).pathname === progressPath && response.request().method() === 'PATCH')
    const refreshing = page.waitForResponse(response => new URL(response.url()).pathname === contentsPath && response.request().method() === 'GET')
    await keyboardActivate(page, reader.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true }))
    const changed = await saving
    expect(changed.status()).toBe(200)
    const progress = await changed.json() as Progress
    expect(progress.completedContentIds.sort()).toEqual([...expectedIds].sort())
    expect(progress.complete).toBe(allComplete)
    const refreshed = await refreshing
    expect(refreshed.status()).toBe(200)
    expect(saved()).toEqual([...expectedIds].sort())
    expect(patches.at(-1)).toEqual({ contentId, completed: true })
    await expect(reader.getByRole('button', { name: 'Abschlussmarkierung entfernen', exact: true })).toBeEnabled()
    return flatten(await refreshed.json() as LearnerNode[])
  }

  const unlocked = await complete(fixture.first.id, [fixture.first.id], false)
  expect(unlocked.find(node => node.id === fixture.next.id)?.locked).toBe(false)
  await expect(firstHeading).toBeVisible()
  await expect(page).toHaveURL(url => url.searchParams.get('content') === fixture.first.id)
  const next = reader.getByRole('button', { name: 'Nächste Lektion öffnen', exact: true })
  await expect(next).toBeEnabled()
  await expect(reader).toContainText(fixture.next.title)
  await capture(page, info, 'completed-with-next', next)
  expect(patches).toHaveLength(1)
  expect(saved()).toEqual([fixture.first.id])
  await page.reload()
  await expect(firstHeading).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Abschlussmarkierung entfernen', exact: true })).toBeVisible()
  await expect(next).toBeVisible()

  await page.goto(base)
  await expect(reader.getByRole('heading', { name: 'Dein nächster Lernschritt', exact: true })).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Weiterlernen', exact: true })).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Kurs starten', exact: true })).toHaveCount(0)
  await expect(reader).toContainText(fixture.next.title)
  await expect(firstHeading).toHaveCount(0)
  expect(new URL(page.url()).searchParams.has('content')).toBe(false)
  expect(patches).toHaveLength(1)
  await capture(page, info, 'resume', reader.getByRole('button', { name: 'Weiterlernen', exact: true }))
  await page.goto(`${base}?content=${fixture.first.id}`)
  await expect(firstHeading).toBeVisible()
  await keyboardActivate(page, next)
  await expect(page).toHaveURL(url => url.pathname === base && url.searchParams.get('content') === fixture.next.id)
  await expect(nextHeading).toBeFocused()
  await expect(reader.getByText('Synthetischer Lerntext zum nächsten Schritt.', { exact: true })).toBeVisible()
  expect(patches).toHaveLength(1)
  expect(saved()).toEqual([fixture.first.id])
  await capture(page, info, 'next-open', nextHeading)
  await page.reload()
  await expect(nextHeading).toBeVisible()
  await expect(reader.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true })).toBeVisible()
  expect(saved()).toEqual([fixture.first.id])

  await complete(fixture.next.id, [fixture.first.id, fixture.next.id], true)
  await expect(nextHeading).toBeVisible()
  await expect(page).toHaveURL(url => url.searchParams.get('content') === fixture.next.id)
  await expect(next).toHaveCount(0)
  expect(patches).toHaveLength(2)
  await page.goto(base)
  const finished = reader.getByRole('heading', { name: 'Aktuelle Inhalte abgeschlossen', exact: true })
  await expect(finished).toBeVisible()
  await expect(reader.getByRole('button', { name: /^(Kurs starten|Weiterlernen|Nächste Lektion öffnen)$/ })).toHaveCount(0)
  await capture(page, info, 'all-current-complete')
  // Explicitly revisiting a completed lesson must survive reload, too.
  await page.goto(`${base}?content=${fixture.first.id}`)
  await page.reload()
  await expect(firstHeading).toBeVisible()
  await expect(page).toHaveURL(url => url.searchParams.get('content') === fixture.first.id)
  await expect(reader.getByRole('button', { name: 'Abschlussmarkierung entfernen', exact: true })).toBeVisible()
  await expect(next).toHaveCount(0)
  expect(saved()).toEqual([fixture.first.id, fixture.next.id].sort())
  expect(patches).toHaveLength(2)

  for (const [index, state] of ['empty', 'locked'].entries()) {
    const course = fixture.fixtures[index + 1]
    await page.goto(`/courses/${course.courseId}/contents`)
    if (state === 'empty') await expect(reader.getByRole('heading', { name: 'Noch keine Kursinhalte', exact: true })).toBeVisible()
    else await expect(reader.getByRole('heading', { name: 'Weitere Inhalte sind noch gesperrt', exact: true })).toBeVisible()
    await expect(reader.getByRole('heading', { name: 'Aktuelle Inhalte abgeschlossen', exact: true })).toHaveCount(0)
    await expect(reader.getByRole('button', { name: /^(Kurs starten|Weiterlernen|Nächste Lektion öffnen|Als abgeschlossen markieren)$/ })).toHaveCount(0)
    expect(new URL(page.url()).searchParams.has('content')).toBe(false)
    expect(storedCompleted(path, course.courseId, learnerId)).toEqual([])
    await capture(page, info, state)
  }
  await page.goto(`/courses/${fixture.fixtures[2].courseId}/contents?content=${fixture.locked.id}`)
  await expect(reader.getByText('Inhalt gesperrt', { exact: true })).toBeVisible()
  await expect(reader.getByText('Synthetischer gesperrter Lerntext.', { exact: true })).toHaveCount(0)
  await expect(reader.getByRole('button', { name: 'Als abgeschlossen markieren', exact: true })).toHaveCount(0)
  expect(patches).toHaveLength(2)
})
