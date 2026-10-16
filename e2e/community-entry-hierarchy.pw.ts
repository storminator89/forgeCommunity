import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { CommunityPost } from '../lib/community-feed';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const feedEndpoint = /\/api\/posts\?/;
const topicEndpoint = /\/api\/posts\/topics\?/;

// Explicitly synthetic rendering fixtures. Only registration and sign-in use
// real HTTP/storage here. Feed, topic and mutation responses below do not prove
// persistence, permissions, rewards or solution selection. Existing real-HTTP
// journeys and their disposable-database safety guards remain unchanged.
const question: CommunityPost = {
  id: 'entry-question', title: 'Wie sammelt ihr Feedback in eurer Lerngruppe?',
  content: '<p>Wir testen am Freitag unseren ersten Prototyp. Welche Frage bringt euch in einer kurzen Feedbackrunde weiter?</p>',
  published: true, authorId: 'fixture-bea', author: { id: 'fixture-bea', name: 'Bea Sommer', image: null },
  createdAt: '2026-10-10T10:00:00Z', votes: 0, isLiked: false, comments: [], commentCount: 0,
  tags: [{ id: 'design', name: 'Design' }],
};

async function login(page: Page) {
  const databasePath = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Community entry captures require a loopback server and its explicitly disposable SQLite fixture database.');
  }
  const id = randomUUID();
  const email = `community-entry-${id}@example.test`;
  const password = `CommunityEntryA1!${id}`;
  const registered = await page.request.post(`${origin}/api/register`, {
    headers: { origin }, data: { name: 'Ada Winter', email, password },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const { userId } = await registered.json();
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
  return userId as string;
}

async function reflowReport(page: Page, selector: string) {
  await page.evaluate(async () => { await document.fonts.ready; });
  return page.evaluate(rootSelector => {
    const root = document.querySelector<HTMLElement>(rootSelector);
    if (!root) throw new Error(`Missing reflow target: ${rootSelector}`);
    const bounds = root.getBoundingClientRect();
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('*')).map(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(), id: element.id, label: element.getAttribute('aria-label'),
        labelledBy: element.getAttribute('aria-labelledby'), text: element.textContent?.trim().slice(0, 100),
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, left: rect.left, right: rect.right,
        display: style.display, flexBasis: style.flexBasis, gridColumns: style.gridTemplateColumns,
        minWidth: style.minWidth, maxWidth: style.maxWidth, whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap, overflowX: style.overflowX, position: style.position, clipPath: style.clipPath,
        excess: Math.max(element.scrollWidth - element.clientWidth, rect.right - bounds.right, bounds.left - rect.left),
      };
    }).filter(element => element.clientWidth > 0 && element.excess > 0)
      .sort((left, right) => right.excess - left.excess).slice(0, 24);
    return {
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      root: { selector: rootSelector, clientWidth: root.clientWidth, scrollWidth: root.scrollWidth,
        left: bounds.left, right: bounds.right, scrollTop: root.scrollTop },
      // Include clipped/screen-reader-only nodes with their styles rather than
      // silently treating every internal scrollWidth as the page's cause.
      candidates,
    };
  }, selector);
}

async function capture(page: Page, info: TestInfo, name: string) {
  const report = await reflowReport(page, 'main');
  // Save the actual state before a strict failure, including offscreen overflow
  // diagnostics in the CI error text. The existing width gates are unchanged.
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true, animations: 'disabled' });
  expect(report.document.scrollWidth <= report.document.clientWidth, `${name}: document reflow ${JSON.stringify(report)}`).toBe(true);
  expect(report.root.scrollWidth <= report.root.clientWidth, `${name}: main reflow ${JSON.stringify(report)}`).toBe(true);
}

async function theme(page: Page, value: string) {
  await page.evaluate(next => localStorage.setItem('theme', next), value);
  await page.goto('/community');
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${value}\\b`));
}

test('community entry prioritizes composing and reading with compact keyboard-operable filters and local feedback', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-390-chromium', 'Exact 1280x800 and 320x700 captures are covered by the other two projects.');
  const userId = await login(page);
  await page.route(feedEndpoint, route => route.fulfill({ json: { posts: [question], nextCursor: null } }));
  await page.route(topicEndpoint, route => route.fulfill({ json: { topics: [{ id: 'design', name: 'Design' }] } }));
  let finishMutation!: () => void;
  let mutationResponse = Promise.resolve();
  await page.route(/\/api\/posts$/, async route => {
    await mutationResponse;
    await route.fulfill({ json: { ...question, id: 'entry-created', title: 'Unser nächster Lernschritt', authorId: userId,
      author: { id: userId, name: 'Ada Winter', image: null }, tags: [{ id: 'design', name: 'Design' }] } });
  });
  // Exercise each existing motion preference without adding or changing one.
  for (const value of ['light', 'dark']) {
    await page.emulateMedia({ reducedMotion: value === 'light' ? 'reduce' : 'no-preference' });
    await page.evaluate(() => localStorage.setItem('forge-community-motion-off', 'true'));
    await theme(page, value);
    const heading = page.getByRole('heading', { name: 'Aktuelle Beiträge', exact: true });
    const composer = page.getByRole('button', { name: 'Neuen Beitrag erstellen', exact: true });
    const post = page.locator('#post-entry-question');
    await expect(post.getByRole('heading', { name: question.title, exact: true })).toBeInViewport();
    await expect(composer).toBeInViewport();
    await expect(page.getByText('1 Beitrag geladen', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Austausch / Community', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Spaces entdecken', exact: true })).toHaveAttribute('href', '/community/spaces');
    await capture(page, info, `community-entry-synthetic-normal-${value}`);

    const filter = page.getByRole('searchbox', { name: 'Thema suchen', exact: true });
    await filter.focus();
    const design = page.getByRole('region', { name: 'Themenfilter', exact: true }).getByRole('link', { name: 'Design', exact: true });
    await expect(design).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(design).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/community\?tag=Design$/);
    await expect(heading).toBeFocused();
    await expect(page.getByText('Aktives Thema:', { exact: false })).toContainText('Design');
    await capture(page, info, `community-entry-synthetic-filtered-${value}`);

    await composer.focus(); await page.keyboard.press('Enter');
    await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Unser nächster Lernschritt');
    await page.getByRole('textbox', { name: 'Text bearbeiten', exact: true }).fill('Wir sammeln am Freitag unsere nächsten Fragen.');
    await expect(filter).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Alle Beiträge zeigen', exact: true })).toBeDisabled();
    await expect(page.getByText('Schließe zuerst deinen Beitragsentwurf, bevor du das Thema wechselst.', { exact: true })).toBeVisible();
    await capture(page, info, `community-entry-synthetic-draft-${value}`);
    mutationResponse = new Promise<void>(resolve => { finishMutation = resolve; });
    const requested = page.waitForRequest(request => new URL(request.url()).pathname === '/api/posts' && request.method() === 'POST');
    await page.getByRole('button', { name: 'Beitrag veröffentlichen', exact: true }).focus();
    await page.keyboard.press('Enter');
    await requested;
    await expect(page.getByText('Beitrag erstellt!', { exact: true })).toHaveCount(0);
    finishMutation();
    const feedback = page.locator('main').getByRole('status').filter({ hasText: 'Beitrag erstellt!' });
    await expect(feedback).toBeInViewport();
    await expect(page.locator('main')).toContainText('Beitrag erstellt!');
    const headerBox = await page.getByRole('banner').boundingBox();
    const feedbackBox = await feedback.boundingBox();
    expect(headerBox).not.toBeNull(); expect(feedbackBox).not.toBeNull();
    expect(feedbackBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
    await expect(page.getByText('2 Beiträge geladen', { exact: true })).toHaveCount(1);
    await capture(page, info, `community-entry-synthetic-local-success-${value}`);

    await page.getByRole('button', { name: 'Alle Beiträge zeigen', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/community$/);
    await expect(heading).toBeFocused();
  }
});

test('community entry keeps long content, loading, empty, error and result-end focus distinct', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-390-chromium', 'Exact 1280x800 and 320x700 states are covered by the other two projects.');
  await login(page);
  for (const value of ['light', 'dark']) {
    let finishLoading!: () => void;
    const pending = new Promise<void>(resolve => { finishLoading = resolve; });
    await page.route(feedEndpoint, async route => { await pending; await route.fulfill({ json: { posts: [], nextCursor: null } }); });
    await theme(page, value);
    await expect(page.locator('main').getByRole('heading', { name: 'Beiträge werden geladen', exact: true })).toBeVisible();
    await capture(page, info, `community-entry-synthetic-loading-${value}`);
    finishLoading();
    await expect(page.locator('main').getByRole('heading', { name: 'Keine Beiträge gefunden', exact: true })).toBeVisible();
    await capture(page, info, `community-entry-synthetic-empty-${value}`);
    await page.unroute(feedEndpoint);

    await page.route(feedEndpoint, route => route.fulfill({ status: 503, json: { error: 'Synthetic feed unavailable' } }));
    await page.reload();
    await expect(page.locator('main').getByRole('heading', { name: 'Beiträge konnten nicht geladen werden', exact: true })).toBeVisible();
    await expect(page.getByText('Keine Beiträge gefunden', { exact: true })).toHaveCount(0);
    await capture(page, info, `community-entry-synthetic-error-${value}`);
    await page.unroute(feedEndpoint);
    await page.route(feedEndpoint, route => route.fulfill({ json: { posts: [], nextCursor: null } }));
    await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
    await expect(page.locator('main').getByRole('heading', { name: 'Keine Beiträge gefunden', exact: true })).toBeVisible();
    await page.unroute(feedEndpoint);

    let finishTopics!: () => void;
    const topicsPending = new Promise<void>(resolve => { finishTopics = resolve; });
    await page.route(topicEndpoint, async route => { await topicsPending; await route.fulfill({ json: { topics: [] } }); });
    const search = page.getByRole('searchbox', { name: 'Thema suchen', exact: true });
    await search.focus();
    await expect(page.getByText('Themen werden geladen…', { exact: true })).toBeVisible();
    await capture(page, info, `community-entry-synthetic-topics-loading-${value}`);
    finishTopics();
    await expect(page.getByText('Keine öffentlichen Themen gefunden. Versuche einen anderen Suchbegriff.', { exact: true })).toBeVisible();
    await capture(page, info, `community-entry-synthetic-topics-empty-${value}`);
    await page.unroute(topicEndpoint);
    await page.route(topicEndpoint, route => route.fulfill({ status: 503, json: { error: 'Synthetic topics unavailable' } }));
    await search.fill('Design');
    await expect(page.getByRole('region', { name: 'Themenfilter', exact: true }).getByText('Themen konnten nicht geladen werden.', { exact: false })).toBeVisible();
    await capture(page, info, `community-entry-synthetic-topics-error-${value}`);
    await page.unroute(topicEndpoint);

    const longTopic = 'GemeinschaftlicheProduktentwicklungMitLangenBezeichnungen';
    const longPost = { ...question, title: 'Wie bleibt gemeinsames Lernen auch mit vielen offenen Fragen übersichtlich? '.repeat(5),
      content: `<p>${'Wir halten Beobachtungen fest und stimmen den nächsten kleinen Schritt gemeinsam ab. '.repeat(12)}</p>`,
      tags: [{ id: 'long-topic', name: longTopic }] };
    await page.route(feedEndpoint, route => route.fulfill({ json: { posts: [longPost], nextCursor: null } }));
    await page.route(topicEndpoint, route => route.fulfill({ json: { topics: [{ id: 'long-topic', name: longTopic }] } }));
    await page.goto(`/community?tag=${encodeURIComponent(longTopic)}`);
    await expect(page.locator('#post-entry-question')).toBeVisible();
    await capture(page, info, `community-entry-synthetic-long-${value}`);
    await page.getByRole('searchbox', { name: 'Thema suchen', exact: true }).focus();
    await expect(page.getByRole('region', { name: 'Themenfilter', exact: true }).getByRole('link', { name: longTopic, exact: true })).toBeVisible();
    await capture(page, info, `community-entry-synthetic-long-filter-${value}`);
    // 200% text size exercises reflow separately from the normal viewport.
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const filters = await reflowReport(page, 'section[aria-labelledby="community-topic-heading"]');
    // Capture surrounding chrome too, but do not turn untouched sidebar/header
    // zoom behavior into a claim or a new gate for this owned filter slice.
    await page.screenshot({ path: info.outputPath(`community-entry-synthetic-large-text-${value}.png`), fullPage: true, animations: 'disabled' });
    expect(filters.root.scrollWidth <= filters.root.clientWidth, `200% topic-filter reflow ${JSON.stringify(filters)}`).toBe(true);
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
    await page.unroute(feedEndpoint); await page.unroute(topicEndpoint);

    await page.route(feedEndpoint, route => route.fulfill({ json: { posts: [question], nextCursor: 'final-page' } }));
    await page.goto('/community');
    const loadMore = page.getByRole('button', { name: 'Weitere Beiträge laden', exact: true });
    await expect(loadMore).toBeVisible();
    await page.unroute(feedEndpoint);
    await page.route(feedEndpoint, route => route.fulfill({ json: { posts: [], nextCursor: null } }));
    await loadMore.focus(); await page.keyboard.press('Enter');
    const end = page.locator('main').getByRole('status').filter({ hasText: 'Ende der Liste.' });
    await expect(end).toBeFocused();
    await expect(end).toBeInViewport();
    await expect(page.getByText('1 Beitrag geladen', { exact: true })).toHaveCount(1);
    await capture(page, info, `community-entry-synthetic-result-end-focus-${value}`);
    await page.unroute(feedEndpoint);
  }
});

test('deep feed actions keep local success and error feedback below the header without taking action focus', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile-390-chromium', 'The desktop and 320px projects capture this scrolled interaction boundary.');
  const userId = await login(page);
  const targetId = 'entry-deep-question';
  const peerComment = {
    id: 'entry-deep-peer', authorId: 'fixture-peer', author: { name: 'Jonas Berg', image: null },
    content: 'Wir fragen zuerst, welcher Schritt beim Ausprobieren unklar war.',
    createdAt: '2026-10-10T11:00:00Z', votes: 0, isLiked: false,
  };
  // A separate, explicitly synthetic long feed puts the existing comment/like
  // controls well below the composer. No hash or scripted focus relocation is
  // used to make the sticky feedback or post-mutation focus assertions pass.
  const preceding = Array.from({ length: 8 }, (_, index) => ({
    ...question, id: `entry-earlier-${index}`, title: `Gedanke aus der Lerngruppe ${index + 1}`,
    content: '<p>Wir sammeln Beobachtungen zu unserem Prototyp und besprechen einen nächsten kleinen Schritt.</p>'.repeat(3),
  }));
  const target: CommunityPost = { ...question, id: targetId, comments: [peerComment], commentCount: 1 };
  await page.route(feedEndpoint, route => route.fulfill({ json: { posts: [...preceding, target], nextCursor: null } }));
  await page.route(new RegExp(`/api/posts/${targetId}/comments$`), route => route.fulfill({ json: {
    id: 'entry-deep-own-comment', authorId: userId, author: { name: 'Ada Winter', image: null },
    content: 'Wir nehmen die Frage nach dem nächsten Schritt in unsere Feedbackrunde mit.',
    createdAt: '2026-10-10T12:00:00Z', votes: 0, isLiked: false,
  } }));
  await page.route(new RegExp(`/api/posts/${targetId}/comments/${peerComment.id}/like$`), route =>
    route.fulfill({ status: 503, json: { error: 'Synthetic comment-like unavailable' } }));

  const main = page.locator('main');
  for (const value of ['light', 'dark']) {
    await theme(page, value);
    const card = page.locator(`#post-${targetId}`);
    const openComments = card.getByRole('button', { name: '1 Kommentar anzeigen', exact: true });
    await openComments.scrollIntoViewIfNeeded();
    await openComments.click();
    const input = card.getByRole('textbox', { name: 'Kommentar schreiben', exact: true });
    await input.scrollIntoViewIfNeeded();
    expect(await main.evaluate(element => element.scrollTop)).toBeGreaterThan(page.viewportSize()!.height);
    await input.fill('Wir nehmen die Frage nach dem nächsten Schritt in unsere Feedbackrunde mit.');
    const commentResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/posts/${targetId}/comments` && response.request().method() === 'POST');
    await input.press('Enter');
    expect((await commentResponse).status()).toBe(200);
    await expect(input).toBeEnabled();
    const success = main.getByRole('status').filter({ hasText: 'Kommentar wurde hinzugefügt!' });
    await expect(success).toBeInViewport();
    await expect(card.locator('#comment-entry-deep-own-comment')).toContainText('Wir nehmen die Frage nach dem nächsten Schritt');
    await expect(input).toHaveValue('');
    const header = await page.getByRole('banner').boundingBox();
    const successBox = await success.boundingBox();
    expect(header).not.toBeNull(); expect(successBox).not.toBeNull();
    expect(successBox!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    expect(await main.evaluate(element => element.scrollTop)).toBeGreaterThan(page.viewportSize()!.height);
    const commentFocusStayed = await input.evaluate(element => element === document.activeElement);
    await capture(page, info, `community-entry-synthetic-deep-comment-success-${value}`);
    // Keep both outcome captures if a real focus loss is exposed. Soft failures
    // still fail the test; they do not relocate focus or waive the requirement.
    expect.soft(commentFocusStayed, 'Sending a deep-feed comment must leave focus at its input.').toBe(true);

    const like = card.locator(`#comment-${peerComment.id}`).getByRole('button', { name: 'Kommentar liken', exact: true });
    await like.scrollIntoViewIfNeeded();
    await like.focus();
    const likeResponse = page.waitForResponse(response =>
      new URL(response.url()).pathname === `/api/posts/${targetId}/comments/${peerComment.id}/like` && response.request().method() === 'POST');
    // A real pointer click also checks that the local message does not block
    // this concrete next action; no generic control-overlap rule is invented.
    await like.click();
    expect((await likeResponse).status()).toBe(503);
    await expect(like).toBeEnabled();
    const error = main.getByRole('alert').filter({ hasText: 'Fehler beim Liken des Kommentars.' });
    await expect(error).toBeInViewport();
    await expect(error).toHaveText('Fehler beim Liken des Kommentars.');
    const errorBox = await error.boundingBox();
    expect(errorBox).not.toBeNull();
    expect(errorBox!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
    expect(await main.evaluate(element => element.scrollTop)).toBeGreaterThan(page.viewportSize()!.height);
    const likeFocusStayed = await like.evaluate(element => element === document.activeElement);
    await capture(page, info, `community-entry-synthetic-deep-like-error-${value}`);
    expect.soft(likeFocusStayed, 'A failed deep-feed comment-like must leave focus at its action button.').toBe(true);
  }
});
