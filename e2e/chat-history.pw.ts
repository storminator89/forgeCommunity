import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, test } from '@playwright/test'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'

function disposableDatabasePath() {
  const browserOrigin = new URL(origin)
  const path = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (browserOrigin.protocol !== 'http:' || browserOrigin.origin !== origin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(browserOrigin.hostname) ||
      process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(path) || basename(path) !== 'forge-browser-qa.db' ||
      !lstatSync(path).isFile() || realpathSync(path) !== resolve(path)) {
    throw new Error('Chat history browser QA requires the explicitly disposable local SQLite fixture.')
  }
  return path
}

function seedChat(path: string, authorId: string, nonce: string) {
  const channelId = `chat-history-${nonce}`
  const channelName = `History QA ${nonce}`
  const db = new DatabaseSync(path)
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN')
    db.prepare(`INSERT INTO "ChatChannel" ("id", "name", "isPrivate", "createdAt", "updatedAt")
      VALUES (?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(channelId, channelName)
    const insert = db.prepare(`INSERT INTO "ChatMessage" ("id", "channelId", "authorId", "content", "createdAt", "updatedAt")
      VALUES (?, ?, ?, ?, '2020-01-01T12:00:00.000Z', '2020-01-01T12:00:00.000Z')`)
    for (let index = 0; index < 120; index++) {
      const order = String(index).padStart(3, '0')
      insert.run(`m-${nonce}-${order}`, channelId, authorId, `History QA message ${order} ${nonce}`)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
  return { channelId, channelName }
}

test('chat history stays bounded and loads both older pages before a new message', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'One disposable desktop journey covers pagination and sending.')
  const databasePath = disposableDatabasePath()
  const nonce = randomUUID()
  const email = `chat-history-${nonce}@example.test`
  const password = `ChatHistoryQa1!${nonce}`
  const registered = await request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Chat History QA', email, password },
  })
  expect(registered.status(), await registered.text()).toBe(201)
  const authorId = (await registered.json() as { userId: string }).userId
  const { channelId, channelName } = seedChat(databasePath, authorId, nonce)

  expect((await request.get(`${origin}/api/chat/messages?channelId=${channelId}`)).status()).toBe(401)
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
  await page.goto('/chat')
  await expect(page.getByRole('heading', { name: `# ${channelName}`, exact: true })).toBeVisible()
  const log = page.getByRole('log', { name: 'Nachrichten' })
  await expect(log.locator('article')).toHaveCount(50)
  await expect(log.getByText(`History QA message 070 ${nonce}`, { exact: true })).toBeVisible()
  await expect(log.getByText(`History QA message 069 ${nonce}`, { exact: true })).toHaveCount(0)

  const older = log.getByRole('button', { name: 'Ältere Nachrichten laden' })
  await older.click()
  await expect(log.locator('article')).toHaveCount(100)
  await expect(log.getByText(`History QA message 020 ${nonce}`, { exact: true })).toBeVisible()
  await older.click()
  await expect(log.locator('article')).toHaveCount(120)
  await expect(log.getByText(`History QA message 000 ${nonce}`, { exact: true })).toBeVisible()
  await expect(older).toHaveCount(0)

  const composer = page.getByRole('textbox', { name: 'Nachricht', exact: true })
  const newMessage = `Chat History QA new ${nonce}`
  await composer.fill(newMessage)
  const sent = page.waitForResponse(response => new URL(response.url()).pathname === '/api/chat/messages' &&
    response.request().method() === 'POST')
  await composer.press('Enter')
  expect((await sent).status()).toBe(200)
  await expect(composer).toHaveValue('')
  await expect(log.getByText(newMessage, { exact: true })).toBeVisible()
  await expect(log.locator('article')).toHaveCount(121)
})
