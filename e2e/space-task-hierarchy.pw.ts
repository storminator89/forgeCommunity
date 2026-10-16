import { randomUUID } from 'node:crypto';
import { basename, isAbsolute } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { SpacePoll } from '../components/spaces/poll-api';
import type { SpaceMission } from '../components/spaces/mission-api';

const origin = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
const url = '/community/spaces/qa-task-space';
const api = '/api/spaces/qa-task-space';
const sizes = [{ width: 1280, height: 800 }, { width: 320, height: 700 }];
const now = '2026-10-16T00:00:00.000Z';
const author = { id: 'synthetic-member', name: 'Route QA Member', image: null };
type Persona = 'member' | 'nonmember' | 'private-admin';
type PollState = 'empty' | 'populated' | 'closed' | 'hidden' | 'error' | 'loading';
type Fixture = { persona: Persona; polls: PollState; stress?: boolean; emptyDiscussions?: boolean };

// Every Space, membership, role, discussion, mission and poll response below is
// synthetic rendering evidence. It proves neither persistence nor authorization.
// Real HTTP policy, vote-receipt and focus journeys remain in space-polls.pw.ts.
async function signIn(page: Page) {
  const database = process.env.DATABASE_URL?.startsWith('file:') ? process.env.DATABASE_URL.slice(5) : '';
  if (process.env.BROWSER_QA_DISPOSABLE_DB !== '1' || process.env.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(database) || basename(database) !== 'forge-browser-qa.db' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) {
    throw new Error('Space hierarchy captures require the explicitly disposable loopback SQLite fixture.');
  }
  const nonce = randomUUID();
  const email = `space-hierarchy-${nonce}@example.test`;
  const password = `SpaceHierarchyQaA1!${nonce}`;
  const created = await page.request.post(`${origin}/api/register`, { headers: { origin }, data: { name: author.name, email, password } });
  expect(created.status(), await created.text()).toBe(201);
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-Mail-Adresse' }).fill(email);
  await page.getByLabel('Passwort', { exact: true }).fill(password);
  await page.getByLabel('Passwort', { exact: true }).press('Enter');
  await expect(page).toHaveURL(/\/community$/);
}

function poll(fixture: Fixture): SpacePoll {
  const admin = fixture.persona === 'private-admin';
  return {
    id: 'synthetic-poll', spaceId: 'qa-task-space', question: fixture.stress
      ? 'Welche Verantwortungsübernahmevereinbarungen und Wissensweitergabemöglichkeiten wollen wir gemeinsam ausprobieren?'.repeat(2).slice(0, 200)
      : 'Was wollen wir gemeinsam ausprobieren?',
    createdAt: now, closedAt: fixture.polls === 'closed' ? now : null, hiddenAt: fixture.polls === 'hidden' ? now : null,
    moderationRevision: 0, totalVotes: 3,
    options: [
      { id: 'one', label: fixture.stress ? 'Zugänglichkeitsverantwortungsübernahmevereinbarungen'.repeat(2) : 'Zugänglichkeit gemeinsam prüfen', votes: 2 },
      { id: 'two', label: 'Tests gemeinsam verbessern', votes: 1 },
    ],
    ownVote: { optionId: fixture.persona === 'nonmember' ? null : 'one', revision: 1 },
    canVote: fixture.persona !== 'nonmember' && !['closed', 'hidden'].includes(fixture.polls), canManage: admin,
  };
}

const mission: SpaceMission = {
  id: 'synthetic-mission', spaceId: 'qa-task-space', title: 'Eine gute Frage gemeinsam erklären',
  prompt: 'Zwei Erkenntnisse teilen und einen Gedanken weiterdenken.', creator: author, createdAt: now, closedAt: null,
  week: null, windowState: 'self-paced', participants: [{ ...author, joinedAt: now }], participantLimit: 5,
  participation: { epoch: 1, active: true, joinedAt: now, optedOutAt: null }, canManage: true, canJoin: false,
  contributions: [], ownContributions: [], progress: { insightAuthors: 0, hasCrossPersonBuildOn: false, complete: false },
};

async function installFixture(page: Page, current: () => Fixture, onLoading?: (release: () => void) => void) {
  await page.route('**/api/spaces/qa-task-space**', async route => {
    expect(route.request().method(), 'This render-only fixture must never accept a Space mutation').toBe('GET');
    const path = new URL(route.request().url()).pathname;
    const fixture = current();
    if (path === api) {
      await route.fulfill({ json: {
        id: 'qa-task-space', name: fixture.stress ? 'Verantwortungsübernahmevereinbarungen'.repeat(3) : fixture.persona === 'private-admin' ? 'Unsere Lernwerkstatt' : 'Route QA public space',
        description: fixture.stress ? 'Gemeinsam überlegen, Erfahrungen austauschen und nächste Schritte nachvollziehbar machen. '.repeat(5) : fixture.persona === 'private-admin' ? 'Gemeinsam lernen. Kleine Schritte ausprobieren.' : 'A disposable public space.',
        visibility: fixture.persona === 'private-admin' ? 'PRIVATE' : 'PUBLIC', createdAt: now, updatedAt: now,
        memberCount: 2, discussionCount: fixture.emptyDiscussions ? 0 : 1,
        isMember: fixture.persona !== 'nonmember', canManage: fixture.persona === 'private-admin', canWrite: fixture.persona !== 'nonmember',
      } });
    } else if (path === `${api}/discussions`) {
      await route.fulfill({ json: { items: fixture.emptyDiscussions ? [] : [{
        id: 'synthetic-discussion', spaceId: 'qa-task-space',
        title: fixture.stress ? 'WissensweitergabeundVerantwortungsübernahme'.repeat(3) : 'Route QA discussion',
        content: fixture.stress ? 'Eine ausführliche Frage mit langem Kontext. '.repeat(30) : 'Eine Idee für unseren nächsten gemeinsamen Schritt.',
        author: fixture.stress ? { ...author, name: 'Langtextverantwortungsübernahmemitglied'.repeat(3) } : author,
        createdAt: now, updatedAt: now, replyCount: 0, hiddenAt: null,
      }], nextCursor: null } });
    } else if (path === `${api}/polls`) {
      if (fixture.polls === 'loading') {
        if (!onLoading) throw new Error('A loading render fixture requires an explicit release.');
        await new Promise<void>(resolve => onLoading(resolve));
        await route.fulfill({ json: { items: [], nextCursor: null } }); return;
      }
      if (fixture.polls === 'error') { await route.fulfill({ status: 503, json: { error: 'Synthetic unavailable polls' } }); return; }
      await route.fulfill({ json: { items: fixture.polls === 'empty' ? [] : [poll(fixture)], nextCursor: null } });
    } else if (path === `${api}/missions`) {
      await route.fulfill({ json: { items: [mission], nextCursor: null } });
    } else if (path === `${api}/members`) {
      await route.fulfill({ json: { items: [author, { id: 'synthetic-other', name: 'Weiteres Testmitglied', image: null }], nextCursor: null } });
    } else { throw new Error(`Unexpected synthetic Space read: ${path}`); }
  });
}

async function reflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
  expect(await page.locator('#page-content').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const clipped = await page.locator('#page-content button:visible, #page-content input:visible, #page-content textarea:visible, #page-content nav a:visible').evaluateAll(elements => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    return box.left >= -1 && box.right <= innerWidth + 1 ? [] : [element.getAttribute('aria-label') || element.textContent];
  }));
  expect(clipped).toEqual([]);
}

async function capture(page: Page, info: TestInfo, name: string) {
  await reflow(page);
  await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
}

async function assertSectionPosition(page: Page, id: string) {
  const target = page.locator(`#${id}`);
  await expect(target).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`#${id}$`));
  await expect(page.locator('.app-header')).toBeInViewport({ ratio: 1 });
  // Verify the actual app frame and the destination, rather than accepting a
  // correctly focused target inside an offscreen main after an ancestor scroll.
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect.poll(async () => {
    const box = await target.boundingBox(); const main = await page.locator('#page-content').boundingBox();
    return Boolean(box && main && box.y >= main.y - 1 && box.y < main.y + main.height - 20);
  }).toBe(true);
  await expect.poll(() => target.evaluate(element => {
    const main = element.closest<HTMLElement>('#page-content')!;
    const margin = Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
    const intended = main.scrollTop + element.getBoundingClientRect().top - main.getBoundingClientRect().top - margin;
    const clamped = Math.max(0, Math.min(main.scrollHeight - main.clientHeight, intended));
    return Math.abs(main.scrollTop - clamped);
  })).toBeLessThanOrEqual(1);
}

async function jump(page: Page, label: string, id: string) {
  const link = page.getByRole('navigation', { name: 'Aufgaben im Space' }).getByRole('link', { name: label, exact: true });
  await link.focus();
  await page.keyboard.press('Enter');
  await assertSectionPosition(page, id);
}

async function theme(page: Page, mode: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
  await page.evaluate(value => localStorage.setItem('theme', value), mode);
}

test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'This capture journey checks desktop and 320px itself.');
  test.setTimeout(240_000);
  await signIn(page);
});

test('synthetic public member and nonmember tasks are early and empty polls stay compact', async ({ page }, info) => {
  let fixture: Fixture = { persona: 'member', polls: 'empty' };
  await installFixture(page, () => fixture);
  for (const persona of ['member', 'nonmember'] as const) for (const mode of ['light', 'dark'] as const) {
    fixture = { persona, polls: 'empty' }; await theme(page, mode);
    for (const size of sizes) {
      await page.setViewportSize(size); await page.goto(url);
      await expect(page.getByRole('heading', { level: 1, name: 'Route QA public space' })).toBeVisible();
      const polls = page.getByRole('region', { name: 'Umfragen', exact: true });
      await expect(polls.getByText('Noch keine Umfragen.', { exact: true })).toBeVisible();
      expect((await polls.boundingBox())!.height).toBeLessThan(120);
      await expect(polls.getByText(/In kleinen Gruppen/)).toHaveCount(0);
      await expect(polls.getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Route QA discussion', exact: true })).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('navigation', { name: 'Aufgaben im Space' }).getByRole('link')).toHaveCount(2);
      if (persona === 'member') {
        await expect(page.getByRole('button', { name: 'Diskussion starten' })).toBeInViewport({ ratio: 1 });
        expect((await page.getByRole('button', { name: 'Verlassen' }).boundingBox())!.width).toBeLessThan(130);
      } else {
        await expect(page.getByRole('button', { name: 'Beitreten' })).toBeInViewport({ ratio: 1 });
        await expect(page.getByRole('button', { name: 'Diskussion starten' })).toHaveCount(0);
      }
      await capture(page, info, `space-synthetic-${persona}-empty-${mode}-${size.width}x${size.height}`);
      await jump(page, 'Umfragen', 'space-polls');
      await capture(page, info, `space-synthetic-${persona}-poll-jump-${mode}-${size.width}`);
      await jump(page, 'Diskussionen', 'space-discussions');
      if (persona === 'member') {
        await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Diskussion starten' })).toBeFocused();
        await page.keyboard.press('Enter'); await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toBeFocused();
        await page.getByRole('textbox', { name: 'Titel', exact: true }).fill('Ein noch unveröffentlichter Entwurf');
        await capture(page, info, `space-synthetic-discussion-composer-${mode}-${size.width}`);
        await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Diskussion starten' })).toBeFocused();
        await page.keyboard.press('Enter'); await expect(page.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Ein noch unveröffentlichter Entwurf');
        await page.keyboard.press('Escape');
        await page.goBack(); await assertSectionPosition(page, 'space-polls');
        await page.goForward(); await assertSectionPosition(page, 'space-discussions');
        // A normal pointer click uses the same bounded local navigation.
        await page.getByRole('navigation', { name: 'Aufgaben im Space' }).getByRole('link', { name: 'Umfragen', exact: true }).click();
        await assertSectionPosition(page, 'space-polls');
        await capture(page, info, `space-synthetic-local-history-${mode}-${size.width}`);
      }
    }
  }
  fixture = { persona: 'member', polls: 'empty' };
  await page.goto('/community/spaces');
  await page.goto(`${url}#space-polls`); await expect(page.getByText('Noch keine Umfragen.', { exact: true })).toBeVisible();
  await assertSectionPosition(page, 'space-polls');
  await page.reload(); await expect(page.getByText('Noch keine Umfragen.', { exact: true })).toBeVisible();
  await assertSectionPosition(page, 'space-polls');
  await capture(page, info, 'space-synthetic-direct-fragment-reload-dark-320');
});

test('synthetic private admin tasks separate member management and expose poll creation safeguards', async ({ page }, info) => {
  let fixture: Fixture = { persona: 'private-admin', polls: 'empty' };
  await installFixture(page, () => fixture);
  for (const mode of ['light', 'dark'] as const) {
    await theme(page, mode);
    for (const size of sizes) {
      fixture = { persona: 'private-admin', polls: 'empty' }; await page.setViewportSize(size); await page.goto(url);
      const manage = page.getByRole('region', { name: 'Space verwalten', exact: true });
      await expect(manage.getByRole('button', { name: 'Route QA Member entfernen' })).toBeVisible();
      await expect(page.getByText('Nur Mitglieder und Administratoren können Inhalte sehen.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Verlassen' })).toHaveCount(0);
      expect(await page.locator('#space-polls').evaluate(element => Boolean(element.compareDocumentPosition(document.getElementById('space-management')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
      await capture(page, info, `space-synthetic-private-admin-${mode}-${size.width}x${size.height}`);
      await jump(page, 'Missionen', 'space-missions');
      await expect(page.getByRole('link', { name: mission.title, exact: true })).toBeInViewport({ ratio: 1 });
      await capture(page, info, `space-synthetic-private-missions-${mode}-${size.width}`);
      await jump(page, 'Umfragen', 'space-polls');
      const open = page.getByRole('button', { name: 'Umfrage erstellen', exact: true });
      await open.focus(); await page.keyboard.press('Enter');
      await expect(page.getByRole('textbox', { name: 'Frage', exact: true })).toBeFocused();
      const risk = page.getByText('In kleinen Gruppen können Antworten erkennbar sein. Keine sensiblen Fragen.', { exact: true });
      await expect(risk).toBeVisible();
      await expect(page.getByText('Freiwillig · Eine Stimme pro Person', { exact: true })).toBeVisible();
      await page.locator('#space-polls').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await capture(page, info, `space-synthetic-private-poll-form-${mode}-${size.width}`);
      await page.keyboard.press('Escape'); await expect(open).toBeFocused();
      await jump(page, 'Verwaltung', 'space-management');
      await capture(page, info, `space-synthetic-private-management-${mode}-${size.width}`);
    }
  }
});

test('synthetic populated, long, closed, hidden and failed polls preserve decisions and reflow', async ({ page }, info) => {
  let fixture: Fixture = { persona: 'member', polls: 'populated' };
  let releaseLoading: (() => void) | undefined;
  await installFixture(page, () => fixture, release => { releaseLoading = release; });
  for (const persona of ['member', 'nonmember', 'private-admin'] as const) for (const mode of ['light', 'dark'] as const) {
    await theme(page, mode);
    for (const size of sizes) {
      fixture = { persona, polls: 'populated' }; await page.setViewportSize(size); await page.goto(url);
      await expect(page.getByRole('heading', { name: poll(fixture).question, exact: true })).toBeVisible();
      await jump(page, 'Umfragen', 'space-polls');
      const polls = page.getByRole('region', { name: 'Umfragen', exact: true });
      await expect(polls.getByText(/In kleinen Gruppen können Antworten erkennbar sein/)).toBeInViewport({ ratio: 1 });
      await expect(polls.getByRole('button', { name: 'Animationen durch Systemeinstellung ausgeschaltet' })).toBeDisabled();
      if (persona === 'nonmember') {
        await expect(polls.getByRole('button', { name: 'Abstimmen' })).toHaveCount(0);
        await expect(polls.getByText('Tritt dem Space bei, um abzustimmen.')).toBeVisible();
      } else {
        await expect(polls.getByText('Deine gespeicherte Auswahl', { exact: true })).toBeVisible();
        await expect(polls.getByRole('button', { name: 'Auswahl ändern' })).toBeDisabled();
      }
      await polls.getByText('So wird gezählt', { exact: true }).click();
      await expect(polls.getByText('Angezeigt werden nur Summen und deine eigene Auswahl. Solange die Umfrage offen ist, kannst du deine Auswahl ändern.', { exact: true })).toBeVisible();
      await polls.getByText('So wird gezählt', { exact: true }).click();
      await capture(page, info, `space-synthetic-${persona}-populated-${mode}-${size.width}`);
    }
  }
  for (const mode of ['light', 'dark'] as const) for (const size of sizes) {
    fixture = { persona: 'private-admin', polls: 'populated', stress: true };
    await theme(page, mode); await page.setViewportSize(size); await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Verantwortungsübernahme');
    await capture(page, info, `space-synthetic-stress-top-${mode}-${size.width}`);
    await jump(page, 'Diskussionen', 'space-discussions'); await capture(page, info, `space-synthetic-stress-discussions-${mode}-${size.width}`);
    await jump(page, 'Umfragen', 'space-polls'); await capture(page, info, `space-synthetic-stress-polls-${mode}-${size.width}`);
  }
  for (const state of ['closed', 'hidden', 'error'] as const) {
    fixture = { persona: 'private-admin', polls: state, emptyDiscussions: true }; await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Noch keine Diskussionen' })).toBeVisible();
    await jump(page, 'Umfragen', 'space-polls');
    if (state === 'error') await expect(page.getByRole('region', { name: 'Umfragen', exact: true }).getByRole('alert')).toHaveText('Umfragen konnten nicht geladen werden.');
    else {
      await expect(page.getByRole('button', { name: 'Auswahl ändern' })).toHaveCount(0);
      for (const radio of await page.getByRole('radio').all()) await expect(radio).toBeDisabled();
      await expect(page.getByText(/In kleinen Gruppen können Antworten erkennbar sein/)).toBeVisible();
    }
    await capture(page, info, `space-synthetic-poll-${state}-dark-320`);
  }
  fixture = { persona: 'member', polls: 'loading' }; await page.goto(url);
  await expect(page.getByText('Umfragen werden geladen…', { exact: true })).toBeVisible();
  await jump(page, 'Umfragen', 'space-polls');
  await capture(page, info, 'space-synthetic-poll-loading-dark-320');
  expect(releaseLoading).toBeDefined(); releaseLoading!();
  await expect(page.getByText('Noch keine Umfragen.', { exact: true })).toBeVisible();
  // Large text keeps real local targets operable inside the app scroll region.
  fixture = { persona: 'private-admin', polls: 'populated' }; await page.goto(url);
  await page.addStyleTag({ content: 'html { font-size: 125% !important; }' });
  await jump(page, 'Umfragen', 'space-polls'); await capture(page, info, 'space-synthetic-large-text-dark-320');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => localStorage.setItem('forge-community-motion-off', 'true'));
  await page.reload(); await jump(page, 'Umfragen', 'space-polls');
  await expect(page.getByRole('button', { name: 'Animationen einschalten', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-confirmed]')).toHaveCount(0);
});
