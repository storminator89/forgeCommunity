/** Only current, server-confirmed leaf completions count toward this view. */
export type JourneyContent = {
  id: string;
  title: string;
  type: 'TEXT' | 'VIDEO' | 'AUDIO' | 'H5P' | 'QUIZ' | 'ASSIGNMENT';
  order: number;
  publicationId?: string | null;
  locked?: boolean;
  releaseLocked?: boolean;
  missingPrerequisites?: Array<{ id: string; title: string }>;
  subContents?: JourneyContent[];
};

export type JourneyLeaf = Pick<JourneyContent, 'id' | 'title' | 'type' | 'releaseLocked' | 'missingPrerequisites'> & {
  completed: boolean;
  locked: boolean;
  awaitingGrade: boolean;
};

export type JourneyProjection = {
  leaves: JourneyLeaf[];
  completedCount: number;
  next: JourneyLeaf | null;
  firstLocked: JourneyLeaf | null;
};

export type JourneyCourse = {
  id: string;
  title: string;
  isEnrolled: boolean;
  completed: boolean;
  canDelete?: boolean;
};

/** The editor DTO omits learner locks, so only non-author USER enrollments are eligible. */
export function eligibleJourneyCourses(role: string | null | undefined, courses: JourneyCourse[]): JourneyCourse[] {
  if (role !== 'USER') return [];
  return courses.filter(course => course.isEnrolled === true && course.canDelete === false)
    .sort((a, b) => Number(a.completed) - Number(b.completed) || a.title.localeCompare(b.title, 'de'));
}

export function projectJourney(contents: JourneyContent[], completedContentIds: string[], awaitingGradeContentIds: string[] = []): JourneyProjection {
  const completed = new Set(completedContentIds);
  const awaitingGrade = new Set(awaitingGradeContentIds);
  const leaves: JourneyLeaf[] = [];
  const seen = new Set<string>();
  const ordered = (items: JourneyContent[]) => [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const stack = ordered(contents).map(content => ({ content, parentLocked: false })).reverse();

  while (stack.length) {
    const { content, parentLocked } = stack.pop()!;
    if (seen.has(content.id)) continue;
    seen.add(content.id);
    // An editor response has no `locked` field. Unknown must never mean open.
    const locked = parentLocked || content.locked !== false || content.releaseLocked === true ||
      Boolean(content.missingPrerequisites?.length);
    const children = ordered(content.subContents ?? []);
    if (children.length) {
      for (let index = children.length - 1; index >= 0; index--) stack.push({ content: children[index], parentLocked: locked });
      continue;
    }
    leaves.push({ id: content.id, title: content.title, type: content.type,
      completed: completed.has(content.id), locked,
      awaitingGrade: content.type === 'ASSIGNMENT' && !completed.has(content.id) && !locked && awaitingGrade.has(content.id),
      releaseLocked: content.releaseLocked, missingPrerequisites: content.missingPrerequisites });
  }

  return {
    leaves,
    completedCount: leaves.filter(leaf => leaf.completed).length,
    next: leaves.find(leaf => !leaf.completed && !leaf.locked && !leaf.awaitingGrade) ?? null,
    firstLocked: leaves.find(leaf => !leaf.completed && leaf.locked) ?? null,
  };
}
