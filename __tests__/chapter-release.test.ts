/** @jest-environment node */
import { chapterReleaseDates, chapterReleaseLabel, isChapterReleaseDate } from '@/lib/course-release';
import { coursePathAccess, publicationPathNodes, validateCoursePath, type PathNode } from '@/lib/server/course-path';

const nodes: PathNode[] = [
  { id: 'chapter-a', parentId: null, order: 1, title: 'A', releaseOn: '2026-11-01' },
  { id: 'section-a', parentId: 'chapter-a', order: 1, title: 'Section' },
  { id: 'lesson-a', parentId: 'section-a', order: 1, title: 'Lesson' },
  { id: 'chapter-b', parentId: null, order: 2, title: 'B' },
  { id: 'lesson-b', parentId: 'chapter-b', order: 1, title: 'Dependent', prerequisiteIds: ['lesson-a'] },
];
const release = Date.parse('2026-11-01T00:00:00.000Z');

test.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01', '0000-01-01', '2026-1-01', '2026-11-01T00:00:00Z', '', null, 123])('rejects non-calendar release value %p', value => {
  expect(isChapterReleaseDate(value)).toBe(false);
});

test.each(['2024-02-29', '2026-11-01', '0001-01-01', '9999-12-31'])('accepts exact calendar release value %s', value => {
  expect(isChapterReleaseDate(value)).toBe(true);
});

test('server time gates the entire chapter at the UTC boundary without destroying stored progress', () => {
  const stored = ['lesson-a', 'lesson-b'];
  const before = coursePathAccess(nodes, stored, release - 1);
  for (const id of ['chapter-a', 'section-a', 'lesson-a']) expect(before.get(id)).toMatchObject({ locked: true, releaseLocked: true, releaseOn: '2026-11-01' });
  expect(before.get('lesson-a')).toMatchObject({ completed: true });
  expect(before.get('lesson-b')).toMatchObject({ locked: false, releaseLocked: false, missingPrerequisites: [], completed: true });
  const unearned = coursePathAccess(nodes, [], release - 1);
  expect(unearned.get('lesson-a')).toMatchObject({ locked: true, completed: false });
  expect(unearned.get('lesson-b')).toMatchObject({ locked: true, missingPrerequisites: [{ id: 'lesson-a', title: 'Lesson' }], completed: false });
  const at = coursePathAccess(nodes, stored, release);
  expect(at.get('lesson-a')).toMatchObject({ locked: false, releaseLocked: false, completed: true });
  expect(at.get('lesson-b')).toMatchObject({ locked: false, completed: true });
  expect(stored).toEqual(['lesson-a', 'lesson-b']);
  expect(coursePathAccess(nodes, [], release).get('lesson-a')).toMatchObject({ locked: false, completed: false });
  expect(chapterReleaseLabel('2026-11-01')).toBe('01.11.2026 · 00:00 UTC');
});

test('moving a child follows its current root, with immediate release when the root has no date', () => {
  const moved = nodes.map(node => node.id === 'section-a' ? { ...node, parentId: 'chapter-b', order: 2 } :
    node.id === 'lesson-b' ? { ...node, prerequisiteIds: [] } : node);
  expect(chapterReleaseDates(moved).get('lesson-a')).toBeNull();
  expect(coursePathAccess(moved, [], release - 1).get('lesson-a')).toMatchObject({ locked: false, releaseOn: null });
});

test('only root nodes can carry a validated release date; corrupt published schedules fail closed', () => {
  expect(() => validateCoursePath(nodes.map(node => node.id === 'lesson-a' ? { ...node, releaseOn: '2026-11-01' } : node))).toThrow('obersten Ebene');
  expect(() => publicationPathNodes(JSON.stringify({ schemaVersion: 1, contents: nodes.map(node => node.id === 'chapter-a' ? { ...node, releaseOn: '2026-02-30' } : node) }))).toThrow('Freigabedatum');
});

test('old version-1 payloads and course dates retain immediate access', () => {
  const legacy = { schemaVersion: 1, startDate: '2099-12-01', endDate: '2099-12-31', contents: [{ id: 'legacy', parentId: null, order: 1, title: 'Legacy' }] };
  expect(coursePathAccess(publicationPathNodes(JSON.stringify(legacy)), ['legacy'], release - 1).get('legacy')).toMatchObject({ locked: false, releaseOn: null, completed: true });
});
