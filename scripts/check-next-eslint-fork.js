/*
 * Compare the checked-in Next ESLint 16.3.8 fork against diagnostics and
 * rootDir results recorded from the unmodified 16.3.8 npm release.
 * `--record-upstream` is for maintainers with the official package installed;
 * CI always runs the comparison mode against the checked-in snapshot.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ESLint } = require('eslint');
const nextVitals = require('eslint-config-next/core-web-vitals');
const fork = require('../vendor/next-eslint-plugin-next');
const forkRootDirs = require('../vendor/next-eslint-plugin-next/dist/utils/get-root-dirs').getRootDirs;

const record = process.argv.includes('--record-upstream');
const plugin = record ? require('@next/eslint-plugin-next') : fork;
const getRootDirs = record
  ? require('@next/eslint-plugin-next/dist/utils/get-root-dirs').getRootDirs
  : forkRootDirs;
const baselinePath = path.join(__dirname, 'fixtures', 'next-eslint-16.3.8-baseline.json');

if (record) {
  const upstreamManifest = require('@next/eslint-plugin-next/package.json');
  assert.equal(upstreamManifest.version, '16.3.8');
  assert.equal(upstreamManifest.dependencies['fast-glob'], '3.3.1');
  assert.notEqual(plugin, fork, 'record from the official release, not the fork');
}

function pluginConfigs() {
  return Object.fromEntries(Object.entries(plugin.configs).map(([name, config]) => [
    name,
    Object.fromEntries(Object.entries(config.rules || {}).sort(([a], [b]) => a.localeCompare(b))),
  ]));
}

function nextConfigRules() {
  return Object.fromEntries(nextVitals
    .filter((config) => config.name === 'next' || config.name === 'next/core-web-vitals')
    .map((config) => [config.name, Object.fromEntries(Object.entries(config.rules)
      .filter(([name]) => name.startsWith('@next/next/'))
      .sort(([a], [b]) => a.localeCompare(b)))]));
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-next-eslint-'));
  for (const dir of [
    'pages/guides', 'apps/alpha/pages/guides', 'apps/beta/src/pages/guides',
    'apps/alpha/app/support', 'apps/.hidden/pages', 'apps/nested/deep/pages/guides',
    'empty', 'literal[brackets]/pages',
  ]) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of [
    'pages/guides/deep.tsx', 'apps/alpha/pages/guides/deep.tsx',
    'apps/beta/src/pages/guides/deep.tsx', 'apps/alpha/app/support/page.tsx',
    'apps/nested/deep/pages/guides/deep.tsx',
  ]) fs.writeFileSync(path.join(root, file), 'export default function Page() { return null; }\n');
  fs.writeFileSync(path.join(root, 'empty', 'file.txt'), 'ignored');
  return root;
}

function rootDirCases(root) {
  return {
    default: undefined,
    plain: 'apps/alpha',
    plainTrailingSlash: 'apps/alpha/',
    dot: '.',
    dotPrefix: './apps/alpha',
    missing: 'apps/missing',
    glob: 'apps/*',
    globstar: 'apps/**/pages',
    terminalGlobstar: 'apps/**',
    dynamicTerminalGlobstar: 'apps/*/**',
    braceGlob: 'apps/{alpha,beta}',
    array: ['apps/alpha', 'apps/missing', 'apps/beta'],
    mixedArray: ['apps/*', null, 'apps/alpha'],
    absolutePlain: path.join(root, 'apps/alpha'),
    absoluteGlob: path.join(root, 'apps/*'),
    windowsPlain: 'apps\\alpha',
    windowsGlob: 'apps\\*',
    nested: 'apps/nested/deep',
    nestedGlob: 'apps/nested/**/pages',
    literalBrackets: 'literal[brackets]',
  };
}

function normalize(value, root) {
  return JSON.parse(JSON.stringify(value).replaceAll(root.replace(/\\/g, '/'), '<ROOT>'));
}

function roots(root) {
  return Object.fromEntries(Object.entries(rootDirCases(root)).map(([name, rootDir]) => {
    const context = { cwd: root, settings: { next: rootDir === undefined ? {} : { rootDir } } };
    const result = normalize(getRootDirs(context), root);
    // fast-glob's brace expansion order varies with filesystem walk order.
    // Only membership is part of this fixture's brace-glob contract.
    return [name, name === 'braceGlob' ? result.sort() : result];
  }));
}

function configFor(rootDir) {
  return nextVitals.map((config) => {
    const updated = { ...config };
    if (config.plugins && config.plugins['@next/next']) {
      updated.plugins = { ...config.plugins, '@next/next': plugin };
      if (rootDir !== undefined) {
        updated.settings = { ...config.settings, next: { ...config.settings?.next, rootDir } };
      }
    }
    return updated;
  });
}

async function lint(root, source, rootDir, filename) {
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: configFor(rootDir),
  });
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const [result] = await eslint.lintText(source, { filePath: path.join(root, filename) });
    return result.messages.map(({ ruleId, severity, message, line, column }) => ({
      ruleId, severity, message, line, column,
    }));
  } finally {
    console.warn = originalWarn;
  }
}

async function diagnostics(root) {
  const allLayers = 'import { useState } from "react";\n' +
    'export default function Fixture({ flag }: { flag: boolean }) { if (flag) useState(0); return <><a href="/guides/deep">Deep</a><script src="/slow.js"></script><img src="/x.png" /></>; }\n';
  const nestedLink = 'export default function Fixture() { return <a href="/guides/deep">Deep</a>; }\n';
  const result = {
    allLayers: await lint(root, allLayers, undefined, 'pages/index.tsx'),
  };
  for (const name of [
    'default', 'plain', 'missing', 'glob', 'array', 'absolutePlain', 'absoluteGlob',
    'windowsPlain', 'windowsGlob', 'nested',
  ]) {
    result[name] = await lint(root, nestedLink, rootDirCases(root)[name], 'fixture.tsx');
  }
  return result;
}

function verifyProvenance() {
  const manifest = require('../vendor/next-eslint-plugin-next/package.json');
  assert.equal(manifest.name, '@next/eslint-plugin-next');
  assert.equal(manifest.version, '16.3.8');
  assert.equal(manifest.dependencies.tinyglobby, '0.2.15');
  assert.equal(manifest.dependencies['fast-glob'], undefined);
  assert.equal(Object.keys(fork.rules).length, 22);
  const hashes = require('../vendor/next-eslint-plugin-next/UPSTREAM_SHA256.json');
  for (const [file, expected] of Object.entries(hashes)) {
    const actual = crypto.createHash('sha256').update(fs.readFileSync(
      path.join(__dirname, '..', 'vendor/next-eslint-plugin-next', file))).digest('hex');
    assert.equal(actual, expected, `${file} differs from official Next 16.3.8`);
  }
}

(async () => {
  verifyProvenance();
  const oldCwd = process.cwd();
  const root = makeRoot();
  try {
    process.chdir(root);
    const actual = {
      ruleNames: Object.keys(plugin.rules).sort(),
      pluginConfigs: pluginConfigs(),
      nextConfigRules: nextConfigRules(),
      roots: roots(root),
      diagnostics: await diagnostics(root),
    };
    if (record) {
      fs.writeFileSync(baselinePath, JSON.stringify(actual, null, 2) + '\n');
      console.log('Recorded official Next ESLint 16.3.8 baseline.');
    } else {
      assert.deepEqual(actual, JSON.parse(fs.readFileSync(baselinePath, 'utf8')));
      console.log('Next ESLint 16.3.8 fork matches upstream rules, severities, rootDir, and diagnostics.');
    }
  } finally {
    process.chdir(oldCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
