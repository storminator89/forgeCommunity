import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { APIRequestContext } from '@playwright/test';

const guardMessage = 'Private invitation browser QA requires the loopback, explicitly disposable SQLite fixture.';

/** No dotenv, database discovery, remote provider or production-account fallback. */
export function privateInvitationFixtureEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  const rawOrigin = environment.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013';
  const rawDatabase = environment.DATABASE_URL ?? '';
  let url: URL;
  try { url = new URL(rawOrigin); } catch { throw new Error(guardMessage); }
  const databasePath = rawDatabase.startsWith('file:') ? rawDatabase.slice(5) : '';
  // Check every environment/provider/path/origin condition BEFORE filesystem access.
  if (environment.BROWSER_QA_DISPOSABLE_DB !== '1' || environment.DATABASE_PROVIDER !== 'sqlite' ||
      url.protocol !== 'http:' || url.origin !== rawOrigin ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      !isAbsolute(databasePath) || resolve(databasePath) !== databasePath ||
      basename(databasePath) !== 'forge-browser-qa.db' || /[?#%\0]/.test(databasePath)) {
    throw new Error(guardMessage);
  }
  try {
    const stat = lstatSync(databasePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(databasePath) !== databasePath) {
      throw new Error(guardMessage);
    }
  } catch { throw new Error(guardMessage); }
  return { origin: url.origin, databasePath };
}

type FixtureEnvironment = ReturnType<typeof privateInvitationFixtureEnvironment>;
export type InvitationAccount = { id: string; email: string; name: string };
export type InvitationScope = { spaceId: string; missionId: string; title: string; href: string; api: string };
export type InvitationFixture = {
  origin: string;
  password: string;
  sender: InvitationAccount;
  recipient: InvitationAccount;
  primary: InvitationScope;
  alternate: InvitationScope;
  snapshot: (scope?: InvitationScope) => {
    participants: number;
    recipientParticipations: number;
    recipientContributions: number;
    invitations: number;
    requests: number;
    recipientNotices: number;
  };
  fillPrimaryCapacity: () => void;
  closePrimary: () => void;
  removeRecipientMembership: () => void;
  cleanup: () => void;
};

function withDatabase<T>(expected: FixtureEnvironment, work: (db: DatabaseSync) => T, readOnly = false): T {
  // Revalidate for EVERY open, including reads and cleanup. Never trust a cached URL.
  const current = privateInvitationFixtureEnvironment();
  if (current.origin !== expected.origin || current.databasePath !== expected.databasePath) throw new Error(guardMessage);
  const db = new DatabaseSync(current.databasePath, { readOnly });
  try {
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON');
    return work(db);
  } finally { db.close(); }
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function count(db: DatabaseSync, sql: string, ...parameters: string[]) {
  return Number((db.prepare(sql).get(...parameters) as { n: number }).n);
}

/** Only two accounts use normal registration/password login. Filler users never authenticate. */
export async function createPrivateInvitationFixture(request: APIRequestContext): Promise<InvitationFixture> {
  const environment = privateInvitationFixtureEnvironment();
  const nonce = randomUUID();
  const marker = `Synthetic disposable private invitation fixture ${nonce}`;
  const password = `PrivateMissionQa1!${nonce}`;
  const registered: InvitationAccount[] = [];
  const filler: InvitationAccount[] = Array.from({ length: 4 }, (_, index) => ({
    id: `pmi-filler-${index}-${nonce}`, email: `pmi-filler-${index}-${nonce}@example.test`, name: `Synthetic peer ${index + 1}`,
  }));
  const scopes = ['primary', 'alternate'].map((kind, index): InvitationScope => {
    const spaceId = `pmi-space-${index}-${nonce}`;
    const missionId = `pmi-mission-${index}-${nonce}`;
    return { spaceId, missionId, title: `${index ? 'Eine weitere Perspektive' : 'Eine Erklärung gemeinsam prüfen'} ${nonce.slice(0, 6)}`,
      href: `/community/spaces/${spaceId}/missions/${missionId}`, api: `/api/spaces/${spaceId}/missions/${missionId}` };
  });
  let seeded = false;
  let cleaned = false;
  const assertOwned = (db: DatabaseSync) => {
    for (const scope of scopes) {
      if (count(db, 'SELECT COUNT(*) AS n FROM "Space" WHERE "id" = ? AND "description" = ?', scope.spaceId, marker) !== 1 ||
          count(db, 'SELECT COUNT(*) AS n FROM "SpaceMission" WHERE "id" = ? AND "spaceId" = ?', scope.missionId, scope.spaceId) !== 1) {
        throw new Error('Synthetic invitation fixture ownership changed; refusing database mutation.');
      }
    }
  };
  const cleanup = () => {
    if (cleaned) return;
    withDatabase(environment, db => transaction(db, () => {
      if (seeded) {
        assertOwned(db);
        for (const scope of scopes) {
          db.prepare('DELETE FROM "SpaceMission" WHERE "id" = ? AND "spaceId" = ?').run(scope.missionId, scope.spaceId);
          db.prepare('DELETE FROM "Space" WHERE "id" = ? AND "description" = ?').run(scope.spaceId, marker);
        }
      }
      // Exact IDs AND unique synthetic emails; no broad LIKE/truncation cleanup.
      for (const account of [...registered, ...filler]) {
        db.prepare('DELETE FROM "User" WHERE "id" = ? AND "email" = ? AND "role" = \'USER\'').run(account.id, account.email);
      }
    }));
    cleaned = true;
  };
  try {
    for (const [index, name] of ['Ada Winter', 'Mara Sommer'].entries()) {
      privateInvitationFixtureEnvironment();
      const email = `pmi-${index}-${nonce}@example.test`;
      const displayName = `${name} ${nonce.slice(0, 6)}`;
      const response = await request.post(`${environment.origin}/api/register`, {
        headers: { origin: environment.origin }, data: { email, name: displayName, password },
      });
      if (response.status() !== 201) throw new Error(`Synthetic invitation registration failed (${response.status()}).`);
      const data: unknown = await response.json();
      const id = typeof data === 'object' && data !== null && 'userId' in data ? data.userId : null;
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid synthetic registration result.');
      registered.push({ id, email, name: displayName });
    }
    withDatabase(environment, db => transaction(db, () => {
      for (const account of registered) {
        const changed = db.prepare('UPDATE "User" SET "isTestAccount" = 1 WHERE "id" = ? AND "email" = ? AND "role" = \'USER\'')
          .run(account.id, account.email);
        if (changed.changes !== 1) throw new Error('Synthetic USER registration was not isolated.');
      }
      for (const account of filler) db.prepare('INSERT INTO "User" ("id","name","email","role","isTestAccount","updatedAt") VALUES (?, ?, ?, \'USER\', 1, CURRENT_TIMESTAMP)')
        .run(account.id, account.name, account.email);
      for (const scope of scopes) {
        db.prepare('INSERT INTO "Space" ("id","name","description","visibility","updatedAt") VALUES (?, ?, ?, \'PRIVATE\', CURRENT_TIMESTAMP)')
          .run(scope.spaceId, `Private Lernwerkstatt ${nonce.slice(0, 6)}`, marker);
        db.prepare('INSERT INTO "SpaceMission" ("id","spaceId","creatorId","requestId","payloadDigest","title","prompt") VALUES (?, ?, NULL, ?, ?, ?, ?)')
          .run(scope.missionId, scope.spaceId, `fixture-${nonce}`, createHash('sha256').update(marker + scope.missionId).digest('hex'), scope.title,
            'Erklärt einen Zusammenhang und entwickelt den Gedanken einer anderen Person gemeinsam weiter.');
        for (const account of [...registered, ...filler]) db.prepare('INSERT INTO "SpaceMember" ("spaceId","userId") VALUES (?, ?)').run(scope.spaceId, account.id);
      }
    }));
    seeded = true;
    const [sender, recipient] = registered;
    return {
      origin: environment.origin, password, sender, recipient, primary: scopes[0], alternate: scopes[1],
      snapshot: (scope = scopes[0]) => withDatabase(environment, db => {
        if (!scopes.includes(scope)) throw new Error('Unknown synthetic invitation scope.');
        assertOwned(db);
        return {
          participants: count(db, 'SELECT COUNT(*) AS n FROM "SpaceMissionParticipation" WHERE "missionId" = ? AND "optedOutAt" IS NULL', scope.missionId),
          recipientParticipations: count(db, 'SELECT COUNT(*) AS n FROM "SpaceMissionParticipation" WHERE "missionId" = ? AND "userId" = ?', scope.missionId, recipient.id),
          recipientContributions: count(db, 'SELECT COUNT(*) AS n FROM "SpaceMissionContribution" WHERE "missionId" = ? AND "authorId" = ?', scope.missionId, recipient.id),
          invitations: count(db, 'SELECT COUNT(*) AS n FROM "SpaceMissionInvitation" WHERE "missionId" = ? AND "recipientId" = ?', scope.missionId, recipient.id),
          requests: count(db, 'SELECT COUNT(*) AS n FROM "SpaceMissionInvitationRequest" WHERE "missionId" = ? AND "senderId" = ?', scope.missionId, sender.id),
          recipientNotices: count(db, 'SELECT COUNT(*) AS n FROM "Notification" WHERE "userId" = ? AND "targetType" = \'SPACE_MISSION_INVITATION\' AND "targetId" IN (SELECT "id" FROM "SpaceMissionInvitation" WHERE "missionId" = ?)', recipient.id, scope.missionId),
        };
      }, true),
      fillPrimaryCapacity: () => withDatabase(environment, db => transaction(db, () => {
        assertOwned(db);
        for (const account of filler) db.prepare('INSERT INTO "SpaceMissionParticipation" ("missionId","userId","epoch") VALUES (?, ?, 1)').run(scopes[0].missionId, account.id);
      })),
      // Controlled external fixture transitions exercise fresh UI reads. These
      // intentionally do not claim coverage of the separately tested admin hooks.
      closePrimary: () => withDatabase(environment, db => transaction(db, () => {
        assertOwned(db);
        db.prepare('UPDATE "SpaceMission" SET "closedAt" = CURRENT_TIMESTAMP WHERE "id" = ? AND "spaceId" = ?').run(scopes[0].missionId, scopes[0].spaceId);
      })),
      removeRecipientMembership: () => withDatabase(environment, db => transaction(db, () => {
        assertOwned(db);
        db.prepare('DELETE FROM "SpaceMember" WHERE "spaceId" = ? AND "userId" = ?').run(scopes[0].spaceId, recipient.id);
      })),
      cleanup,
    };
  } catch (error) { cleanup(); throw error; }
}
