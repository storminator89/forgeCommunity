/** @jest-environment node */
import { coursePathAccess, prepareCoursePath, type PathNode } from '@/lib/server/course-path';

test('prepared path evaluator matches single-learner access across a chain and branch', () => {
  const nodes: PathNode[] = [
    { id: 'chapter', parentId: null, order: 1, title: 'Chapter' },
    { id: 'a', parentId: 'chapter', order: 1, title: 'A' },
    { id: 'b', parentId: 'chapter', order: 2, title: 'B', prerequisiteIds: ['a'] },
    { id: 'c', parentId: null, order: 2, title: 'C', prerequisiteIds: ['b'] },
    { id: 'd', parentId: null, order: 3, title: 'D', prerequisiteIds: ['a'] },
    { id: 'e', parentId: null, order: 4, title: 'E', prerequisiteIds: ['c', 'd'] },
  ];
  const evaluate = prepareCoursePath(nodes);
  for (const raw of [[], ['a'], ['b', 'c', 'd', 'e'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e']]) {
    expect([...evaluate(raw)]).toEqual([...coursePathAccess(nodes, raw)]);
  }
  const staleUpstream = evaluate(['b', 'c', 'd', 'e']);
  expect(staleUpstream.get('c')).toMatchObject({ locked: true, completed: false, missingPrerequisites: [{ id: 'b', title: 'B' }] });
  expect(staleUpstream.get('e')).toMatchObject({ locked: true, completed: false, missingPrerequisites: [{ id: 'c', title: 'C' }, { id: 'd', title: 'D' }] });
  expect(evaluate(['a', 'b', 'c', 'd', 'e']).get('e')).toMatchObject({ locked: false, completed: true });
});
