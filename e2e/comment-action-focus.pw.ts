import { randomUUID } from 'node:crypto'
import { basename, isAbsolute } from 'node:path'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import type { CommunityPost } from '../lib/community-feed'

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013'
const postId = 'comment-focus-question'
const peer = { id: 'comment-focus-peer', authorId: 'fixture-peer', author: { name: 'Bea Sommer', image: null },
  content: 'Wir fragen nach dem nächsten gemeinsamen Lernschritt.', createdAt: '2026-10-10T10:00:00Z', votes: 0, isLiked: false }
const question: CommunityPost = { id: postId, title: 'Welche Frage hilft eurer Lerngruppe weiter?',
  content: '<p>Wir sammeln Beobachtungen und probieren den nächsten kleinen Schritt gemeinsam aus.</p>',
  published: true, authorId: 'fixture-peer', author: { id: 'fixture-peer', name: 'Bea Sommer', image: null },
  createdAt: '2026-10-10T09:00:00Z', votes: 0, isLiked: false, comments: [peer], commentCount: 1, tags: [] }

async function login(page: Page) {
  const database = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : ''
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(database) || basename(database) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Comment focus checks require a loopback server and its explicitly disposable SQLite fixture database.')
  }
  const id = randomUUID(); const email = `comment-focus-${id}@example.test`; const password = `CommentFocusA1!${id}`
  const response = await page.request.post(`${origin}/api/register`, { headers: { origin }, data: { name: 'Ada Winter', email, password } })
  expect(response.status(), await response.text()).toBe(201)
  const { userId } = await response.json()
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email)
  await page.getByLabel('Passwort', { exact: true }).fill(password)
  await page.getByLabel('Passwort', { exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/community$/)
  return userId as string
}

async function capture(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' })
}

test('comment actions restore only their own pending-disabled focus across repeated outcomes and slow external navigation', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-390-chromium', 'Desktop and 320px exercise this focus boundary.')
  const userId = await login(page)
  // These feed/mutation responses are synthetic UI fixtures. Registration and
  // sign-in are real HTTP; this test makes no persistence/auth/reward claim.
  const preceding = Array.from({ length: 6 }, (_, index) => ({ ...question, id: `focus-earlier-${index}`,
    title: `Beobachtung ${index + 1}`, content: question.content.repeat(3), comments: [], commentCount: 0 }))
  await page.route(/\/api\/posts\?/, route => route.fulfill({ json: { posts: [...preceding, question], nextCursor: null } }))
  await page.route(/\/api\/posts\/topics\?/, route => route.fulfill({ json: { topics: [] } }))
  type Reply = { status: number; isLiked?: boolean }
  type Pending = { kind: 'comment' | 'like'; content?: string; release: (reply: Reply) => void }
  const mutations: Pending[] = []
  await page.route(new RegExp(`/api/posts/${postId}/comments(?:/${peer.id}/like)?$`), async route => {
    const kind = route.request().url().endsWith('/like') ? 'like' : 'comment'
    expect(route.request().method()).toBe('POST')
    const content = kind === 'comment' ? route.request().postDataJSON().content as string : undefined
    const reply = await new Promise<Reply>(release => { mutations.push({ kind, content, release }) })
    await route.fulfill({ status: reply.status, json: reply.status !== 200 ? { error: 'Synthetic action unavailable' }
      : kind === 'like' ? { isLiked: reply.isLiked }
        : { ...peer, id: `comment-focus-own-${mutations.length}`, authorId: userId, author: { name: 'Ada Winter', image: null }, content } })
  })

  const card = page.locator(`#post-${postId}`)
  const input = card.getByRole('textbox', { name: 'Kommentar schreiben', exact: true })
  const like = card.locator(`#comment-${peer.id}`).getByRole('button', { name: /^Kommentar(?: liken|-Like entfernen)$/ })
  const toggle = card.getByRole('button', { name: /^\d+ Kommentare? (?:anzeigen|ausblenden)$/ })
  async function begin(kind: 'comment' | 'like', pointer: boolean) {
    const before = mutations.length
    let target: Locator
    if (kind === 'comment') {
      target = input
      await input.fill(`Unser nächster Schritt ${before + 1}`)
      if (pointer) await card.getByRole('button', { name: 'Kommentar senden', exact: true }).click()
      else await input.press('Enter')
    } else {
      target = like
      if (pointer) await like.click()
      else { await like.focus(); await page.keyboard.press('Enter') }
    }
    await expect(target).toBeDisabled()
    await expect.poll(() => mutations.length).toBe(before + 1)
    expect(mutations[before].kind).toBe(kind)
    // Native pending disabling must still block a second keyboard activation.
    await page.keyboard.press('Enter')
    expect(mutations).toHaveLength(before + 1)
    return { target, pending: mutations[before], count: before + 1 }
  }
  async function complete(action: Awaited<ReturnType<typeof begin>>, reply: Reply, restore = true) {
    action.pending.release(reply)
    await expect(action.target).toBeEnabled()
    if (restore) await expect(action.target).toBeFocused()
    expect(mutations).toHaveLength(action.count)
  }

  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => localStorage.setItem('theme', value), theme)
    await page.goto('/community')
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`))
    await toggle.click()
    await input.scrollIntoViewIfNeeded()

    const comment = await begin('comment', false)
    await complete(comment, { status: 200 })
    await expect(input).toHaveValue('')
    await expect(card).toContainText(comment.pending.content!)
    await capture(page, info, `comment-action-synthetic-success-${theme}`)
    // This pointer action is the immediate next real interaction after submit.
    await complete(await begin('like', true), { status: 503 })
    await expect(page.locator('main').getByRole('alert').filter({ hasText: 'Fehler beim Liken des Kommentars.' })).toBeVisible()
    await capture(page, info, `comment-action-synthetic-like-error-${theme}`)
    await complete(await begin('like', false), { status: 200, isLiked: true })
    await expect(like).toHaveAttribute('aria-label', 'Kommentar-Like entfernen')
    await complete(await begin('like', true), { status: 200, isLiked: false })
    await expect(like).toHaveAttribute('aria-label', 'Kommentar liken')
    await complete(await begin('like', false), { status: 503 })
    const failed = await begin('comment', true)
    await complete(failed, { status: 503 })
    await expect(input).toHaveValue(failed.pending.content!)
    await capture(page, info, `comment-action-synthetic-comment-error-${theme}`)
    await complete(await begin('comment', false), { status: 200 })
    await expect(input).toHaveValue('')
    await complete(await begin('comment', true), { status: 200 })
    await expect(input).toHaveValue('')

    for (const kind of ['comment', 'like'] as const) {
      for (const movement of ['tab', 'pointer-control', 'pointer-text']) {
        const action = await begin(kind, false)
        if (movement === 'tab') await page.keyboard.press('Tab')
        if (movement === 'pointer-control') await page.getByRole('searchbox', { name: 'Thema suchen', exact: true }).click()
        if (movement === 'pointer-text') await card.getByText(peer.content, { exact: true }).click()
        const outside = await page.evaluateHandle(() => document.activeElement)
        expect(await action.target.evaluate(element => element === document.activeElement)).toBe(false)
        action.pending.release({ status: 503 })
        await expect(action.target).toBeEnabled()
        await expect.poll(() => outside.evaluate(element => element === document.activeElement)).toBe(true)
        expect(mutations).toHaveLength(action.count)
        await outside.dispose()
      }
    }
    await capture(page, info, `comment-action-synthetic-external-navigation-${theme}`)

    for (const kind of ['comment', 'like'] as const) {
      const action = await begin(kind, false)
      await toggle.click()
      await expect(input).toHaveCount(0)
      await toggle.click()
      await expect(input).toBeVisible()
      await expect(toggle).toBeFocused()
      // The newly mounted section must not inherit the old action's intent.
      action.pending.release({ status: 200, isLiked: true })
      await expect(input).toBeEnabled()
      await expect(toggle).toBeFocused()
      expect(mutations).toHaveLength(action.count)
    }
    await capture(page, info, `comment-action-synthetic-remount-${theme}`)
  }
})
