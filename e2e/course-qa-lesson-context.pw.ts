import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test, type Locator, type Page, type Route } from '@playwright/test'
import { createDeferredCaptureErrors } from './deferred-capture-errors'
import { installReaderLayoutGuard, type ReaderLayoutWindow } from './reader-layout-readiness'
import { serializeReaderEvidence } from './reader-evidence-budget'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const candidateSha = /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? '') ? process.env.GITHUB_SHA! : 'local-unverified-sha'
function disposableDatabasePath() {
  const url = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (url.protocol !== 'http:' || url.origin !== origin || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' || !isAbsolute(path) ||
      basename(path) !== 'forge-browser-qa.db' || !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Lesson Q&A requires the loopback, explicitly disposable SQLite browser fixture.')
  }
  return path
}
function withDb<T>(path: string, work: (db: DatabaseSync) => T, readOnly = false): T {
  const db = new DatabaseSync(path, { readOnly })
  try { db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON'); return work(db) } finally { db.close() }
}
type Fixture = { courseId: string; contentId: string; publicationId: string; lessonTitle: string; instructorId: string; learnerId: string; peerId: string }
function payload(fixture: Fixture, title: string, releaseOn?: string) {
  return JSON.stringify({ schemaVersion: 1, title: 'Synthetic lesson conversation course', description: 'Disposable browser fixture', startDate: null, endDate: null, imageUrl: null,
    contents: [{ id: fixture.contentId, parentId: null, title, order: 1, type: 'TEXT', content: '<p>Isolated authored lesson material.</p>', ...(releaseOn ? { releaseOn } : {}) }] })
}
function seed(path: string, instructorId: string, learnerId: string, peerId: string, nonce: string): Fixture {
  const fixture = { courseId: `lesson-qa-${nonce}`, contentId: `lesson-${nonce}`, publicationId: `publication-${nonce}`, lessonTitle: `Private lesson provenance ${nonce}`, instructorId, learnerId, peerId }
  const serialized = payload(fixture, fixture.lessonTitle)
  withDb(path, db => {
    db.exec('BEGIN')
    try {
      db.prepare('INSERT INTO "Course" ("id","title","description","instructorId","price","updatedAt") VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP)')
        .run(fixture.courseId, 'Synthetic lesson conversation course', 'Disposable browser fixture', instructorId)
      db.prepare('INSERT INTO "CourseContent" ("id","courseId","title","content","order","type","updatedAt") VALUES (?, ?, ?, ?, 1, \'TEXT\', CURRENT_TIMESTAMP)')
        .run(fixture.contentId, fixture.courseId, fixture.lessonTitle, '<p>Isolated authored lesson material.</p>')
      db.prepare('INSERT INTO "CoursePublication" ("id","courseId","sequence","source","payload","digest","contentCount") VALUES (?, ?, 1, \'AUTHOR\', ?, ?, 1)')
        .run(fixture.publicationId, fixture.courseId, serialized, `initial-${nonce}`)
      // Readiness requires draft and publication to be a coherent pair before startup's next request.
      db.prepare('INSERT INTO "CourseDraft" ("courseId","basePublicationId","payload","digest","updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
        .run(fixture.courseId, fixture.publicationId, serialized, `initial-${nonce}`)
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(fixture.publicationId, fixture.courseId)
      for (const userId of [learnerId, peerId]) db.prepare('INSERT INTO "Enrollment" ("id","userId","courseId") VALUES (?, ?, ?)').run(randomUUID(), userId, fixture.courseId)
      // Older retained pages are a clearly isolated fixture, not 20 rate-limit-bypassing HTTP creates.
      for (let index = 0; index < 20; index++) db.prepare('INSERT INTO "CourseQuestion" ("id","courseId","authorId","requestId","title","body","createdAt","updatedAt","contextPublicationId","contextContentId") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(`retained-${nonce}-${index}`, fixture.courseId, learnerId, `fixture-${nonce}-${index}`, `Retained question ${index}`, 'Learner-authored retained discussion.', Date.parse('2000-01-01T00:00:00.000Z'), Date.parse('2000-01-01T00:00:00.000Z'), fixture.publicationId, fixture.contentId)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
  return fixture
}
// Only this guarded fixture is republished; no production database or startup bypass.
function republish(path: string, fixture: Fixture, sequence: number, previous: string, releaseOn?: string) {
  const id = `publication-${sequence}-${fixture.courseId}`
  const title = `Revised current lesson ${sequence}`
  const serialized = payload(fixture, title, releaseOn)
  withDb(path, db => {
    db.exec('BEGIN')
    try {
      db.prepare('UPDATE "CourseContent" SET "title" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ? AND "courseId" = ?').run(title, fixture.contentId, fixture.courseId)
      db.prepare('INSERT INTO "CoursePublication" ("id","courseId","sequence","source","payload","digest","contentCount","previousPublicationId") VALUES (?, ?, ?, \'AUTHOR\', ?, ?, 1, ?)')
        .run(id, fixture.courseId, sequence, serialized, `version-${sequence}-${fixture.courseId}`, previous)
      db.prepare('UPDATE "CourseDraft" SET "basePublicationId" = ?, "payload" = ?, "digest" = ?, "revision" = "revision" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "courseId" = ?')
        .run(id, serialized, `version-${sequence}-${fixture.courseId}`, fixture.courseId)
      db.prepare('UPDATE "Course" SET "activePublicationId" = ? WHERE "id" = ?').run(id, fixture.courseId)
      db.exec('COMMIT')
    } catch (error) { db.exec('ROLLBACK'); throw error }
  })
  return id
}
async function login(page: Page, email: string, password: string) {
  await page.goto('/login'); await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password); await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
}
async function activate(page: Page, control: Locator) { await expect(control).toBeVisible(); await control.focus(); await expect(control).toBeFocused(); await page.keyboard.press('Enter') }
const lessonQuery = (publicationId: string, contentId: string) => new URLSearchParams({ publicationId, contentId }).toString()

test('lesson provenance survives real creation, retained pages, republish, chosen solution, lost response, and revocation', async ({ page, browser, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The bounded fixture explicitly captures both desktop and 320px in each theme.')
  test.setTimeout(240_000)
  const dbPath = disposableDatabasePath(); const nonce = randomUUID(); const password = `LessonQaA1!${nonce}`
  const people = ['instructor', 'learner', 'peer'].map(role => ({ email: `${role}-lesson-qa-${nonce}@example.test`, name: `Synthetic ${role}` }))
  const ids: string[] = []
  for (const person of people) { const registered = await request.post(`${origin}/api/register`, { headers: { origin }, data: { ...person, password } }); expect(registered.status(), await registered.text()).toBe(201); ids.push((await registered.json()).userId) }
  const fixture = seed(dbPath, ids[0], ids[1], ids[2], nonce)
  const { courseId, contentId, publicationId, lessonTitle } = fixture
  const api = `/api/courses/${courseId}/qa`; const scopedUrl = `/courses/${courseId}/qa?${lessonQuery(publicationId, contentId)}`
  const questionTitle = `Learner-authored question ${nonce}`; const questionBody = 'How can we discuss this learning step together?'
  await login(page, people[1].email, password)
  await page.goto(`/courses/${courseId}/contents?content=${contentId}`)
  await expect(page.getByRole('heading', { level: 2, name: lessonTitle })).toBeVisible()
  await activate(page, page.getByRole('button', { name: 'Zu dieser Lektion fragen' }))
  await expect(page).toHaveURL(`${origin}${scopedUrl}&ask=1`)
  const composer = page.getByRole('form', { name: 'Neue Frage' })
  await expect(composer.getByRole('textbox', { name: 'Titel' })).toHaveValue(''); await expect(composer.getByRole('textbox', { name: 'Frage', exact: true })).toHaveValue('')
  await composer.getByRole('textbox', { name: 'Titel' }).fill(questionTitle); await composer.getByRole('textbox', { name: 'Frage', exact: true }).fill(questionBody)
  const create = page.waitForResponse(r => new URL(r.url()).pathname === api && r.request().method() === 'POST')
  await activate(page, composer.getByRole('button', { name: 'Frage veröffentlichen' })); const created = await create
  expect(created.status(), await created.text()).toBe(201)
  expect(created.request().postDataJSON()).toMatchObject({ title: questionTitle, body: questionBody, lessonContext: { publicationId, contentId } })
  const questionId = (await created.json()).question.id as string
  expect(withDb(dbPath, db => db.prepare('SELECT "contextPublicationId", "contextContentId" FROM "CourseQuestion" WHERE "id" = ?').get(questionId), true)).toEqual({ contextPublicationId: publicationId, contextContentId: contentId })
  await page.reload()
  await activate(page, page.getByRole('region', { name: 'Fragenliste' }).getByRole('button').filter({ hasText: questionTitle }))
  await expect(page.getByRole('heading', { level: 2, name: questionTitle })).toBeVisible()
  const other = await browser.newContext({ baseURL: origin, viewport: { width: 320, height: 700 } })
  const staff = await browser.newContext({ baseURL: origin })
  try {
    const peer = await other.newPage(); await login(peer, people[2].email, password); await peer.goto(scopedUrl)
    await activate(peer, peer.getByRole('region', { name: 'Fragenliste' }).getByRole('button').filter({ hasText: questionTitle }))
    const replyBody = 'An answer to the original learner-authored discussion.'
    await peer.getByRole('textbox', { name: 'Deine Antwort' }).fill(replyBody)
    const answered = peer.waitForResponse(r => new URL(r.url()).pathname === `${api}/${questionId}/answers` && r.request().method() === 'POST')
    await activate(peer, peer.getByRole('button', { name: 'Antwort veröffentlichen' })); expect((await answered).status()).toBe(201)
    const instructor = await staff.newPage(); await login(instructor, people[0].email, password); await instructor.goto(scopedUrl)
    await activate(instructor, instructor.getByRole('region', { name: 'Fragenliste' }).getByRole('button').filter({ hasText: questionTitle }))
    await activate(instructor, instructor.getByRole('button', { name: 'Als Lösung markieren' })); await expect(instructor.getByText('Lösung', { exact: true })).toBeVisible()
    await page.reload(); await activate(page, page.getByRole('region', { name: 'Fragenliste' }).getByRole('button').filter({ hasText: questionTitle }))
    await activate(page, page.getByRole('button', { name: 'Weitere Fragen laden' })); await expect(page.getByText('Retained question 0', { exact: true })).toBeVisible()
    const captureErrors = createDeferredCaptureErrors()
    const captureHeading = page.getByRole('region', { name: 'Frage und Antworten' }).getByRole('heading', { level: 2, name: questionTitle })
    const captureSetup: { viewport?: { width: number; height: number }; baseline?: {
      fontStyle: string; rootFontPixels: number; targetFontPixels: number; scrollTop: number; scrollLeft: number
    } } = {}
    await captureErrors.collect('capture setup', async () => {
      captureSetup.viewport = page.viewportSize() ?? undefined
      if (!captureSetup.viewport) throw new Error('Lesson Q&A capture requires an explicit viewport')
      captureSetup.baseline = await captureHeading.evaluate(element => {
        const root = document.documentElement; const pane = document.getElementById('page-content')!
        return { fontStyle: root.style.fontSize, rootFontPixels: parseFloat(getComputedStyle(root).fontSize),
          targetFontPixels: parseFloat(getComputedStyle(element).fontSize), scrollTop: pane.scrollTop, scrollLeft: pane.scrollLeft }
      })
    }, async () => { /* Setup only reads the original capture state. */ })
    const captureBaseline = captureSetup.baseline; const captureViewport = captureSetup.viewport
    if (captureBaseline && captureViewport) {
      for (const theme of ['light', 'dark']) {
        for (const { width, zoom } of [{ width: 1280, zoom: 100 }, { width: 320, zoom: 100 }, { width: 320, zoom: 200 }]) {
          const captureName = `${candidateSha}-lesson-qa-${theme}-${width}-${zoom}`
          const readinessEvidence: { enlarged?: unknown; guard?: unknown } = {}
          await captureErrors.collect(captureName, async () => {
            try {
              await page.evaluate(value => { localStorage.setItem('theme', value); document.documentElement.classList.toggle('dark', value === 'dark') }, theme)
              await page.evaluate(value => { document.documentElement.style.fontSize = `${value}px` }, captureBaseline.rootFontPixels * zoom / 100)
              await page.setViewportSize({ width, height: 800 }); await page.emulateMedia({ reducedMotion: 'reduce' })
              const discussion = page.getByRole('region', { name: 'Frage und Antworten' })
              const heading = discussion.getByRole('heading', { level: 2, name: questionTitle })
              const context = discussion.getByText(`Zu dieser Lektion: ${lessonTitle}`, { exact: true })
              const solution = discussion.getByText('Lösung', { exact: true })
              // Frame oversized text in the actual content pane using native scrolling only.
              await heading.evaluate(installReaderLayoutGuard, { kind: 'qa-capture' as const,
                expectedRootFontPixels: captureBaseline.rootFontPixels * zoom / 100, expectedTargetFontPixels: captureBaseline.targetFontPixels * zoom / 100 })
              readinessEvidence.enlarged = await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.settle())
              await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.arm())
              await expect(heading).toBeVisible()
              const beforeScrollTop = await heading.evaluate(element => {
                const pane = document.getElementById('page-content')!
                const previous = pane.scrollTop
                element.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' })
                return previous
              })
              const alignment = await heading.evaluate(element => {
                const pane = document.getElementById('page-content')!
                return { heading: element.getBoundingClientRect().toJSON(), pane: pane.getBoundingClientRect().toJSON(),
                  scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, overflowY: getComputedStyle(pane).overflowY }
              })
              console.info('Lesson Q&A capture alignment:', JSON.stringify({ candidateSha, theme, width, zoom, beforeScrollTop, alignment }))
              await expect(heading).toBeInViewport()
              await expect(context).toBeVisible(); await expect(solution).toBeVisible()
              if (width === 1280) {
                await solution.scrollIntoViewIfNeeded()
                await expect(heading).toBeInViewport(); await expect(context).toBeInViewport(); await expect(solution).toBeInViewport()
              }
              const framing = await heading.evaluate(element => {
                const pane = document.getElementById('page-content')!
                const target = element.getBoundingClientRect(); const surface = pane.getBoundingClientRect()
                return { scrollTop: pane.scrollTop, scrollHeight: pane.scrollHeight, clientHeight: pane.clientHeight, overflowY: getComputedStyle(pane).overflowY,
                  heading: { top: target.top, bottom: target.bottom, left: target.left, right: target.right, height: target.height, width: target.width },
                  pane: { top: surface.top, bottom: surface.bottom, left: surface.left, right: surface.right, height: surface.height, width: surface.width },
                  viewport: { width: innerWidth, height: innerHeight },
                  visibleHeight: Math.max(0, Math.min(target.bottom, surface.bottom, innerHeight) - Math.max(target.top, surface.top, 0)),
                  visibleWidth: Math.max(0, Math.min(target.right, surface.right, innerWidth) - Math.max(target.left, surface.left, 0)) }
              })
              const frameEvidence = { candidateSha, theme, width, zoom, beforeScrollTop, framing }
              console.info('Lesson Q&A capture framing:', JSON.stringify(frameEvidence))
              await testInfo.attach(`${candidateSha}-lesson-qa-${theme}-${width}-${zoom}-framing`, { body: Buffer.from(JSON.stringify(frameEvidence)), contentType: 'application/json' })
              expect(framing.visibleHeight).toBeGreaterThan(0); expect(framing.visibleWidth).toBeGreaterThan(0)
              const overflow = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth); expect(overflow).toBeLessThanOrEqual(1)
              const name = `${candidateSha}-lesson-qa-${theme}-${width}-${zoom}`; const path = testInfo.outputPath(`${name}.png`)
              await page.screenshot({ path, fullPage: true }); await testInfo.attach(name, { path, contentType: 'image/png' })
              expect((await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.check())).unsafe).toBe(false)
            } catch (error) {
              console.error('Lesson Q&A capture failed:', captureName, error)
              try { await page.screenshot({ path: testInfo.outputPath(`${captureName}-failed.png`), fullPage: true }) }
              catch (snapshotError) { throw new AggregateError([error, snapshotError], `Capture and failure snapshot failed: ${captureName}`) }
              throw error
            }
          }, async () => {
            const cleanupErrors: unknown[] = []
            const cleanup = async (work: () => Promise<unknown>) => { try { await work() } catch (error) { cleanupErrors.push(error) } }
            await cleanup(async () => {
              readinessEvidence.guard = await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard?.finish())
              const payload = serializeReaderEvidence({ state: 'lesson-qa-capture', candidateSha, theme, width, zoom, readinessEvidence })
              console.info('Lesson Q&A bounded layout evidence:', payload)
              await testInfo.attach(`${captureName}-layout`, { body: Buffer.from(payload), contentType: 'application/json' })
              if (readinessEvidence.guard) expect(readinessEvidence.guard).toMatchObject({ unsafe: false })
            })
            await cleanup(() => page.evaluate(value => { document.documentElement.style.fontSize = value }, captureBaseline.fontStyle))
            await cleanup(() => page.setViewportSize(captureViewport))
            await cleanup(async () => {
              await captureHeading.evaluate(installReaderLayoutGuard, { kind: 'qa-capture' as const, expectedRootFontPixels: captureBaseline.rootFontPixels, expectedTargetFontPixels: captureBaseline.targetFontPixels })
              await page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard!.settle())
            })
            await cleanup(() => page.evaluate(() => (window as ReaderLayoutWindow).__readerLayoutGuard?.finish()))
            await cleanup(() => page.evaluate(({ scrollTop, scrollLeft }) => {
              document.getElementById('page-content')!.scrollTo({ top: scrollTop, left: scrollLeft, behavior: 'instant' })
            }, captureBaseline))
            if (cleanupErrors.length === 1) throw cleanupErrors[0]
            if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, `Capture cleanup failed: ${captureName}`)
          })
        }
      }
    }
    await captureErrors.finishWith(async () => {
      const version2 = republish(dbPath, fixture, 2, publicationId)
      await page.evaluate(() => window.dispatchEvent(new Event('focus')))
      await expect(page.getByText('Für diese frühere Frage ausgewählt')).toBeVisible(); await expect(page.getByText(replyBody, { exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Frage stellen' })).toBeDisabled()
      await expect(page.getByRole('link', { name: 'Lektion öffnen' })).toHaveCount(0)
      const rendered = await page.locator('main').innerHTML(); expect(rendered).not.toContain(lessonTitle); expect(rendered).not.toContain(publicationId); expect(rendered).not.toContain(contentId)
      const historical = await page.request.get(`${api}?${lessonQuery(publicationId, contentId)}`); expect(historical.status()).toBe(200)
      expect(historical.headers()['cache-control']).toBe('private, no-store'); expect((await historical.json()).canAskInScope).toBe(false)
      await activate(page, page.getByRole('link', { name: 'Alle Kursfragen' })); await expect(page).toHaveURL(`${origin}/courses/${courseId}/qa`)
      await page.goto(`/courses/${courseId}/qa?${lessonQuery(version2, contentId)}&ask=1`)
      await expect(page.getByText('Noch keine Fragen', { exact: true })).toBeVisible()
      const lostTitle = `Lost response ${nonce}`; const lostBody = 'The server must recover this exact committed question.'
      await page.getByRole('textbox', { name: 'Titel' }).fill(lostTitle); await page.getByRole('textbox', { name: 'Frage', exact: true }).fill(lostBody)
      let firstPayload: unknown; let version3 = ''; let loseNextPost = true
      const pattern = `**${api}`
      const loseResponse = async (route: Route) => {
        if (route.request().method() !== 'POST' || !loseNextPost) { await route.continue(); return }
        loseNextPost = false
        firstPayload = route.request().postDataJSON(); const actual = await route.fetch(); expect(actual.status()).toBe(201)
        version3 = republish(dbPath, fixture, 3, version2, '2099-11-01')
        await route.abort('failed')
      }
      await page.route(pattern, loseResponse)
      const failed = page.waitForEvent('requestfailed', r => new URL(r.url()).pathname === api && r.method() === 'POST')
      await activate(page, page.getByRole('button', { name: 'Frage veröffentlichen' }))
      expect((await failed).failure()?.errorText).toBe('net::ERR_FAILED')
      expect(firstPayload).toMatchObject({ title: lostTitle, body: lostBody, lessonContext: { publicationId: version2, contentId } })
      await expect(page.getByText('Du kannst den letzten Sendeversuch unverändert wiederholen.')).toBeVisible()
      // Removing the last handler before aborting would continue its still-pending request.
      await page.unroute(pattern, loseResponse)
      const retried = page.waitForResponse(r => new URL(r.url()).pathname === api && r.request().method() === 'POST')
      await activate(page, page.getByRole('button', { name: 'Sendeversuch wiederholen' })); const replay = await retried
      expect(replay.status(), await replay.text()).toBe(200); expect(replay.request().postDataJSON()).toEqual(firstPayload)
      expect((await replay.json()).question.lessonContext).toEqual({ status: 'unavailable' })
      expect(withDb(dbPath, db => (db.prepare('SELECT COUNT(*) AS count FROM "CourseQuestion" WHERE "courseId" = ? AND "title" = ?').get(courseId, lostTitle) as { count: number }).count, true)).toBe(1)
      expect(withDb(dbPath, db => db.prepare('SELECT "contextPublicationId", "contextContentId" FROM "CourseQuestion" WHERE "courseId" = ? AND "title" = ?').get(courseId, lostTitle), true)).toEqual({ contextPublicationId: version2, contextContentId: contentId })
      await page.goto(`/courses/${courseId}/qa?${lessonQuery(version3, contentId)}`); await expect(page.getByRole('button', { name: 'Frage stellen' })).toBeDisabled()
      const withdrawn = await page.request.delete(`/api/courses/${courseId}/enrollment`, { headers: { origin } }); expect(withdrawn.status()).toBe(200)
      await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await expect(page.getByText('Kein Zugriff auf Kursfragen', { exact: true })).toBeVisible()
      expect(withDb(dbPath, db => (db.prepare('SELECT COUNT(*) AS count FROM "Post" WHERE "title" LIKE ? OR "content" LIKE ?').get(`%${nonce}%`, `%${nonce}%`) as { count: number }).count, true)).toBe(0)
    })
  } finally { await Promise.all([other.close(), staff.close()]) }
})
