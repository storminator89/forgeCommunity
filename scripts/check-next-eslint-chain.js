/* Verify the release lock installs the checked-in Next ESLint fork, not the
 * official fast-glob dependency chain or a broken nested local file link. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const root = path.join(__dirname, '..');
const manifest = require(path.join(root, 'package.json'));
const lock = require(path.join(root, 'package-lock.json'));
const fork = require(path.join(root, 'vendor/next-eslint-plugin-next/package.json'));
const tarball = 'vendor/next-eslint-plugin-next-16.3.8.tgz';
const localSpec = `file:${tarball}`;
const sourceDir = path.join(root, 'vendor/next-eslint-plugin-next');

function sourceFiles(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) return sourceFiles(path.join(dir, entry.name), name);
    assert.ok(entry.isFile(), `non-regular fork source: ${name}`);
    return [name];
  });
}

// npm's checked-in archive uses regular ustar entries. Parse the raw headers
// rather than a tar listing, which can hide PAX entries and duplicate names.
function archiveFiles(archivePath) {
  const bytes = zlib.gunzipSync(fs.readFileSync(archivePath), {
    maxOutputLength: 16 * 1024 * 1024,
  });
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      assert.ok(bytes.subarray(offset).every((byte) => byte === 0),
        'nonzero bytes after tar end marker');
      return files;
    }
    const octal = (start, end) => {
      const field = header.toString('ascii', start, end).replace(/\0.*$/, '').trim();
      assert.match(field, /^[0-7]+$/, 'invalid tar octal field');
      return parseInt(field, 8);
    };
    const checksum = header.reduce((sum, byte, index) =>
      sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(octal(148, 156), checksum, 'invalid tar header checksum');
    assert.ok(header[156] === 0 || header[156] === 48,
      'archive contains a non-regular entry');
    const string = (start, end) => header.toString('utf8', start, end).split('\0')[0];
    const name = string(0, 100);
    const prefix = string(345, 500);
    const fullName = prefix ? `${prefix}/${name}` : name;
    assert.ok(fullName.startsWith('package/'), `unexpected tar path: ${fullName}`);
    const relative = fullName.slice('package/'.length);
    assert.ok(relative && !files.has(relative), `duplicate or empty tar path: ${fullName}`);
    const size = octal(124, 136);
    const start = offset + 512;
    assert.ok(start + size <= bytes.length, `truncated tar member: ${fullName}`);
    files.set(relative, bytes.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  assert.fail('archive is missing its tar end marker');
}

function verifyPackageBytes(archivePath, sourcePath, installedPath) {
  const files = archiveFiles(archivePath);
  const expected = [
    'LICENSE', 'README.md', 'package.json',
    ...sourceFiles(path.join(sourcePath, 'dist'), 'dist'),
  ].sort();
  assert.deepEqual([...files.keys()].sort(), expected,
    'archive entries must exactly match the reviewed fork source');
  for (const name of expected) {
    const sourceFile = path.join(sourcePath, name);
    assert.ok(fs.lstatSync(sourceFile).isFile(), `non-regular fork source: ${name}`);
    const source = fs.readFileSync(sourceFile);
    assert.deepEqual(files.get(name), source, `archive differs from source: ${name}`);
    if (installedPath) {
      const installedFile = path.join(installedPath, name);
      assert.ok(fs.lstatSync(installedFile).isFile(), `non-regular installed plugin: ${name}`);
      assert.deepEqual(fs.readFileSync(installedFile), source,
        `installed plugin differs from source: ${name}`);
    }
  }
  if (installedPath) {
    assert.deepEqual(sourceFiles(path.join(installedPath, 'dist'), 'dist').sort(),
      expected.filter((name) => name.startsWith('dist/')),
      'installed plugin dist entries differ from the archive');
  }
}

assert.equal(manifest.devDependencies['@next/eslint-plugin-next'], localSpec);
assert.equal(lock.packages[''].devDependencies['@next/eslint-plugin-next'], localSpec);
assert.equal(fork.name, '@next/eslint-plugin-next');
assert.equal(fork.version, '16.3.8');
assert.equal(fork.dependencies['fast-glob'], undefined);
assert.equal(fork.dependencies.tinyglobby, '0.2.15');

const installed = lock.packages['node_modules/@next/eslint-plugin-next'];
assert.ok(installed, 'plugin must have a lock entry');
assert.equal(installed.version, '16.3.8');
assert.equal(installed.resolved, localSpec);
assert.equal(installed.dependencies['fast-glob'], undefined);
assert.equal(installed.dependencies.tinyglobby, '0.2.15');
assert.deepEqual(Object.keys(lock.packages).filter((key) =>
  key.includes('node_modules/@next/eslint-plugin-next') &&
  key !== 'node_modules/@next/eslint-plugin-next'), [],
'no nested official plugin or fast-glob chain may remain');

const digest = `sha512-${crypto.createHash('sha512')
  .update(fs.readFileSync(path.join(root, tarball))).digest('base64')}`;
assert.equal(installed.integrity, digest, 'lock must attest the checked-in tarball');
verifyPackageBytes(path.join(root, tarball), sourceDir,
  process.argv.includes('--installed')
    ? path.dirname(require.resolve('@next/eslint-plugin-next/package.json')) : undefined);

if (process.argv.includes('--installed')) {
  const installedManifest = require('@next/eslint-plugin-next/package.json');
  assert.equal(installedManifest.dependencies['fast-glob'], undefined);
  assert.equal(installedManifest.dependencies.tinyglobby, '0.2.15');
}

console.log('Next ESLint lock uses the pinned local fork without fast-glob.');

module.exports = { archiveFiles, verifyPackageBytes };
