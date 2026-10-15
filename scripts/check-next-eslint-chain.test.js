const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const zlib = require('node:zlib');
const { archiveFiles, verifyPackageBytes } = require('./check-next-eslint-chain');

const root = path.join(__dirname, '..');
const archive = path.join(root, 'vendor/next-eslint-plugin-next-16.3.8.tgz');
const source = path.join(root, 'vendor/next-eslint-plugin-next');

function firstEntryLength(bytes) {
  const size = parseInt(bytes.toString('ascii', 124, 136), 8);
  return 512 + Math.ceil(size / 512) * 512;
}

function changeFirstHeader(bytes, { type, name }) {
  const changed = Buffer.from(bytes);
  if (type) changed[156] = type.charCodeAt(0);
  if (name) {
    changed.fill(0, 0, 100);
    changed.write(name, 0, 100, 'utf8');
  }
  changed.fill(32, 148, 156);
  const checksum = changed.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
  changed.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return changed;
}

function checkChangedArchive(change, verify = archiveFiles) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-eslint-archive-test-'));
  try {
    const changedArchive = path.join(temp, 'changed.tgz');
    fs.writeFileSync(changedArchive,
      zlib.gzipSync(change(zlib.gunzipSync(fs.readFileSync(archive)))));
    return verify(changedArchive);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('archive verification rejects a changed rule even with an unchanged rule count', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-eslint-archive-test-'));
  try {
    fs.cpSync(source, temp, { recursive: true });
    const rule = path.join(temp, 'dist/rules/no-img-element.js');
    fs.appendFileSync(rule, '\n// altered rule\n');
    assert.throws(() => verifyPackageBytes(archive, temp),
      /archive differs from source: dist\/rules\/no-img-element\.js/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('installed-byte verification rejects a changed installed rule', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-eslint-archive-test-'));
  try {
    fs.cpSync(source, temp, { recursive: true });
    const rule = path.join(temp, 'dist/rules/no-sync-scripts.js');
    fs.appendFileSync(rule, '\n// altered installed rule\n');
    assert.throws(() => verifyPackageBytes(archive, source, temp),
      /installed plugin differs from source: dist\/rules\/no-sync-scripts\.js/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

for (const [name, type] of [['symlink', '2'], ['PAX metadata', 'x']]) {
  test(`archive verification rejects ${name} entries`, () => {
    assert.throws(() => checkChangedArchive((bytes) =>
      changeFirstHeader(bytes, { type })), /non-regular entry/);
  });
}

test('archive verification rejects duplicate entries', () => {
  assert.throws(() => checkChangedArchive((bytes) => {
    const length = firstEntryLength(bytes);
    return Buffer.concat([bytes.subarray(0, length), bytes]);
  }), /duplicate or empty tar path/);
});

test('archive verification rejects extra entries', () => {
  assert.throws(() => checkChangedArchive((bytes) => {
    const length = firstEntryLength(bytes);
    const extra = changeFirstHeader(bytes.subarray(0, length), { name: 'package/EXTRA' });
    return Buffer.concat([extra, bytes]);
  }, (changedArchive) => verifyPackageBytes(changedArchive, source)),
  /archive entries must exactly match/);
});

test('archive verification rejects missing entries', () => {
  assert.throws(() => checkChangedArchive((bytes) =>
    bytes.subarray(firstEntryLength(bytes)),
  (changedArchive) => verifyPackageBytes(changedArchive, source)),
  /archive entries must exactly match/);
});

test('archive verification rejects traversal paths', () => {
  assert.throws(() => checkChangedArchive((bytes) =>
    changeFirstHeader(bytes, { name: 'package/../LICENSE' }),
  (changedArchive) => verifyPackageBytes(changedArchive, source)),
  /archive entries must exactly match/);
});
