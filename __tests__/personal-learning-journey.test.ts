import { eligibleJourneyCourses, projectJourney, type JourneyContent } from '../app/courses/journey/journey-progress';

const leaf = (id: string, order: number, extras: Partial<JourneyContent> = {}): JourneyContent => ({
  id, title: id, order, type: 'TEXT', locked: false, ...extras,
});

describe('personal learning journey projection', () => {
  it('counts only current server-confirmed leaf IDs in published order', () => {
    const contents = [
      leaf('chapter-two', 2, { subContents: [leaf('third', 2), leaf('second', 1)] }),
      leaf('chapter-one', 1, { subContents: [leaf('first', 1)] }),
    ];
    const view = projectJourney(contents, ['chapter-one', 'first', 'stale-id']);
    expect(view.leaves.map(item => item.id)).toEqual(['first', 'second', 'third']);
    expect(view.completedCount).toBe(1);
    expect(view.next?.id).toBe('second');
  });

  it('never recommends a locked leaf, including one under a locked chapter', () => {
    const view = projectJourney([
      leaf('locked-chapter', 1, { locked: true, subContents: [leaf('nested', 1)] }),
      leaf('date-locked', 2, { locked: true, releaseLocked: true }),
      leaf('ready', 3),
    ], []);
    expect(view.next?.id).toBe('ready');
    expect(view.leaves.slice(0, 2).every(item => item.locked)).toBe(true);
    expect(view.firstLocked?.id).toBe('nested');
  });

  it('treats absent or inconsistent learner lock metadata as locked', () => {
    const editorLeaf = leaf('editor-dto', 1);
    delete editorLeaf.locked;
    const inconsistent = leaf('inconsistent', 2, { releaseLocked: true, locked: false });
    const view = projectJourney([editorLeaf, inconsistent, leaf('open', 3)], []);
    expect(view.leaves.map(item => item.locked)).toEqual([true, true, false]);
    expect(view.next?.id).toBe('open');
  });

  it('returns no next step for fully completed or empty courses', () => {
    expect(projectJourney([leaf('done', 1)], ['done']).next).toBeNull();
    expect(projectJourney([], ['stale-id'])).toEqual({ leaves: [], completedCount: 0, next: null, firstLocked: null });
  });

  it('does not loop if a malformed tree repeats a node', () => {
    const repeated = leaf('same', 1);
    repeated.subContents = [repeated];
    expect(projectJourney([repeated], [])).toEqual({ leaves: [], completedCount: 0, next: null, firstLocked: null });
  });
});

describe('personal learning journey eligibility', () => {
  const rows = [
    { id: 'other', title: 'Anderer Kurs', isEnrolled: true, completed: false, canDelete: false },
    { id: 'own', title: 'Eigener Kurs', isEnrolled: true, completed: false, canDelete: true },
    { id: 'unknown', title: 'Ohne Editor-Signal', isEnrolled: true, completed: false },
    { id: 'browse', title: 'Nicht angemeldet', isEnrolled: false, completed: false, canDelete: false },
  ];

  it('allows only enrolled non-author courses for a USER', () => {
    expect(eligibleJourneyCourses('USER', rows).map(course => course.id)).toEqual(['other']);
  });

  it.each(['INSTRUCTOR', 'ADMIN', 'MODERATOR', null, undefined])('denies %s, even when enrolled', role => {
    expect(eligibleJourneyCourses(role, rows)).toEqual([]);
  });
});
