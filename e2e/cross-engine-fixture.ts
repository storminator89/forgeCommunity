import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

function isRegularUnlinkedFile(path: string): boolean {
  try {
    return lstatSync(path).isFile() && realpathSync(path) === resolve(path);
  } catch {
    return false;
  }
}

/** Validate before navigating or sending synthetic account/post data. */
export function crossEngineFixtureOrigin(environment: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = environment.DATABASE_URL;
  const databasePath = databaseUrl?.startsWith('file:') ? databaseUrl.slice(5) : '';
  let url: URL;
  try {
    url = new URL(environment.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3013');
  } catch {
    throw new Error('Cross-engine smoke requires a loopback origin and its disposable SQLite database.');
  }

  if (environment.BROWSER_QA_DISPOSABLE_DB !== '1' || environment.DATABASE_PROVIDER !== 'sqlite' ||
      !isAbsolute(databasePath) || basename(databasePath) !== 'forge-browser-qa.db' ||
      !isRegularUnlinkedFile(databasePath) || url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Cross-engine smoke requires a loopback origin and its disposable SQLite database.');
  }

  return url.origin;
}
