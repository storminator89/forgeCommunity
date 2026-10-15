/** @jest-environment node */
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crossEngineFixtureOrigin } from '../e2e/cross-engine-fixture';

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'forge-cross-engine-fixture-'));
const databasePath = join(fixtureDirectory, 'forge-browser-qa.db');
const linkedFileDirectory = join(fixtureDirectory, 'linked-file');
const realParentDirectory = join(fixtureDirectory, 'real-parent');
const linkedParentDirectory = join(fixtureDirectory, 'linked-parent');
const directoryInsteadOfFile = join(fixtureDirectory, 'directory', 'forge-browser-qa.db');
writeFileSync(databasePath, '');
mkdirSync(linkedFileDirectory);
symlinkSync(databasePath, join(linkedFileDirectory, 'forge-browser-qa.db'));
mkdirSync(realParentDirectory);
writeFileSync(join(realParentDirectory, 'forge-browser-qa.db'), '');
symlinkSync(realParentDirectory, linkedParentDirectory);
mkdirSync(join(fixtureDirectory, 'directory'));
mkdirSync(directoryInsteadOfFile);

const disposableEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_PROVIDER: 'sqlite',
  DATABASE_URL: `file:${databasePath}`,
  BROWSER_QA_DISPOSABLE_DB: '1',
  PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:3013',
};

describe('cross-engine fixture destination guard', () => {
  afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

  it('uses a regular database file without symlinked path components', () => {
    expect(lstatSync(databasePath).isFile()).toBe(true);
    expect(realpathSync(databasePath)).toBe(databasePath);
  });

  it.each(['http://127.0.0.1:3013', 'http://localhost:3013/', 'http://[::1]:3013'])
    ('accepts an explicit disposable database at loopback %s', origin => {
      expect(crossEngineFixtureOrigin({ ...disposableEnvironment, PLAYWRIGHT_BASE_URL: origin }))
        .toBe(new URL(origin).origin);
    });

  it.each([
    'https://127.0.0.1:3013',
    'https://community.example.test',
    'http://localhost.example.test:3013',
    'http://127.0.0.1.example.test:3013',
    'http://127.0.0.1@community.example.test',
    'http://user:password@localhost:3013',
    'file:///tmp/forge-browser-qa.db',
    'http://localhost:3013/other-app',
    'http://localhost:3013/?target=external',
    'http://localhost:3013/#external',
    'not a URL',
  ])('rejects an unsafe origin before fixture data can be sent: %s', origin => {
    expect(() => crossEngineFixtureOrigin({ ...disposableEnvironment, PLAYWRIGHT_BASE_URL: origin }))
      .toThrow('Cross-engine smoke requires');
  });

  it.each([
    { BROWSER_QA_DISPOSABLE_DB: undefined },
    { BROWSER_QA_DISPOSABLE_DB: '0' },
    { DATABASE_PROVIDER: 'postgresql' },
    { DATABASE_URL: undefined },
    { DATABASE_URL: 'postgresql://localhost/forge-browser-qa.db' },
    { DATABASE_URL: 'file:forge-browser-qa.db' },
    { DATABASE_URL: 'file:/tmp/production.db' },
    { DATABASE_URL: 'file:/tmp/forge-browser-qa.db?mode=rw' },
    { DATABASE_URL: `file:${join(fixtureDirectory, 'missing', 'forge-browser-qa.db')}` },
    { DATABASE_URL: `file:${join(linkedFileDirectory, 'forge-browser-qa.db')}` },
    { DATABASE_URL: `file:${join(linkedParentDirectory, 'forge-browser-qa.db')}` },
    { DATABASE_URL: `file:${directoryInsteadOfFile}` },
  ])('rejects a non-disposable database configuration: %j', override => {
    expect(() => crossEngineFixtureOrigin({ ...disposableEnvironment, ...override }))
      .toThrow('Cross-engine smoke requires');
  });
});
