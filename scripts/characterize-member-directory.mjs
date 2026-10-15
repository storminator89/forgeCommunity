import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

// Synthetic characterization, not an implementation or endpoint regression.
// These checks deliberately prove why adding take/contains/orderBy to the
// existing directory would change its client-side behavior. No external DB.
const displayName = name => name || 'Unbekannt';
const clientMatches = (name, query) => displayName(name).toLowerCase().includes(query.toLowerCase());

function withNames(names, run) {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE member (id INTEGER PRIMARY KEY, name TEXT)');
    const insert = db.prepare('INSERT INTO member (id, name) VALUES (?, ?)');
    names.forEach((name, id) => insert.run(id, name));
    run(db);
  } finally { db.close(); }
}

test('SQLite LIKE loses a Unicode match which the current directory finds', () => {
  withNames(['MÜLLER', 'Muller'], db => {
    const rows = db.prepare('SELECT name FROM member WHERE name LIKE ?').all('%müller%');
    assert.equal(clientMatches('MÜLLER', 'müller'), true);
    assert.deepEqual(rows, []);
    // Lowering the SQL field does not repair SQLite Unicode case folding.
    assert.equal(db.prepare('SELECT lower(name) AS name FROM member WHERE id = 0').get().name, 'mÜller');
  });
});

test('SQL field filtering must preserve the current null and empty display-name fallback', () => {
  withNames([null, ''], db => {
    assert.equal([null, ''].filter(name => clientMatches(name, 'unbekannt')).length, 2);
    assert.deepEqual(db.prepare('SELECT name FROM member WHERE name LIKE ?').all('%unbekannt%'), []);
  });
});

test('percent and underscore are literal search input today, not SQL wildcards', () => {
  withNames(['Ada', '100%', 'A_B'], db => {
    for (const query of ['%', '_']) {
      const expected = ['Ada', '100%', 'A_B'].filter(name => clientMatches(name, query));
      const naive = db.prepare('SELECT name FROM member WHERE name LIKE ?').all(`%${query}%`);
      assert.equal(expected.length, 1);
      assert.equal(naive.length, 3);
      const escaped = query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
      const actual = db.prepare("SELECT name FROM member WHERE name LIKE ? ESCAPE '\\'").all(`%${escaped}%`);
      assert.deepEqual(actual.map(row => row.name), expected);
    }
  });
});

test('even LOWER(name) does not reproduce German alphabetical order', () => {
  const names = ['Zara', 'anna', 'Änne', 'Özlem'];
  withNames(names, db => {
    const databaseOrder = db.prepare('SELECT name FROM member ORDER BY lower(name), id').all().map(row => row.name);
    const germanOrder = [...names].sort((a, b) => a.localeCompare(b, 'de'));
    assert.deepEqual(germanOrder, ['anna', 'Änne', 'Özlem', 'Zara']);
    assert.deepEqual(databaseOrder, ['anna', 'Zara', 'Änne', 'Özlem']);
  });
});

test('the current unspecified locale is not one portable collation contract', () => {
  const names = ['Zara', 'Änne'];
  const germanOrder = [...names].sort((a, b) => a.localeCompare(b, 'de'));
  const swedishOrder = [...names].sort((a, b) => a.localeCompare(b, 'sv'));
  assert.notDeepEqual(germanOrder, swedishOrder);
});

test('filtering or computing stats after a cap loses real members and taxonomy', () => {
  const members = Array.from({ length: 26 }, (_, index) => ({
    name: `Member ${index}`, role: index === 25 ? 'INSTRUCTOR' : 'USER',
    skills: index === 25 ? ['TypeScript', 'Design'] : [], followers: index === 25 ? 3 : 0,
  }));
  const matches = member => ['TypeScript', 'Design'].every(skill => member.skills.includes(skill)) &&
    ['ADMIN', 'INSTRUCTOR'].includes(member.role);
  assert.equal(members.filter(matches).length, 1);
  assert.equal(members.slice(0, 25).filter(matches).length, 0);
  assert.equal(members.filter(member => member.followers > 0).length, 1);
  assert.equal(members.slice(0, 25).filter(member => member.followers > 0).length, 0);
  assert.deepEqual([...new Set(members.flatMap(member => member.skills))], ['TypeScript', 'Design']);
  assert.deepEqual([...new Set(members.slice(0, 25).flatMap(member => member.skills))], []);
});

test('keyset values survive a deleted boundary while OFFSET repeats after an insert', () => {
  const initial = ['B', 'C', 'D', 'E'];
  const first = initial.slice(0, 2);
  const afterInsert = ['A', ...initial];
  assert.deepEqual(afterInsert.slice(2, 4), ['C', 'D']);
  assert.deepEqual(afterInsert.filter(name => name > first.at(-1)).slice(0, 2), ['D', 'E']);
  const afterDelete = afterInsert.filter(name => name !== 'C');
  assert.deepEqual(afterDelete.filter(name => name > first.at(-1)).slice(0, 2), ['D', 'E']);
});
