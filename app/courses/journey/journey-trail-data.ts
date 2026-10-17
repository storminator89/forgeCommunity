import { chapterIsReleased, isChapterReleaseDate } from '@/lib/course-release';
import { type JourneyContent, type JourneyCourse, type JourneyLeaf, type JourneyProjection } from './journey-progress';

export type JourneyProgress = {
  completedContentIds: string[]; awaitingGradeContentIds: string[];
  complete: boolean; canTrack: boolean; publicationId: string;
};
type CheckedContent = JourneyContent & {
  courseId: string; parentId: string | null; publicationId: string; locked: boolean;
  releaseLocked: boolean; prerequisiteIds: string[]; releaseOn: string | null;
  missingPrerequisites: Array<{ id: string; title: string }>; subContents: CheckedContent[];
};
export type JourneyTrailStation = { leaf: JourneyLeaf; position: number };
export type JourneyTrailGroup = {
  id: string; title: string; isChapter: boolean; stations: JourneyTrailStation[]; completedCount: number;
};

const CONTENT_TYPES = new Set(['TEXT', 'VIDEO', 'AUDIO', 'H5P', 'QUIZ', 'ASSIGNMENT']);
const MAX_NODES = 500;
const invalid = (): never => { throw new Error('Inconsistent journey response'); };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const idString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

function ids(value: unknown, limit = MAX_NODES): string[] {
  if (!Array.isArray(value) || value.length > limit) return invalid();
  const seen = new Set<string>();
  return value.map(id => {
    if (!idString(id) || seen.has(id)) return invalid();
    seen.add(id);
    return id;
  });
}

/** Only allowlisted navigation metadata is retained, never lesson bodies. */
export function readJourneyCourses(value: unknown): JourneyCourse[] {
  if (!Array.isArray(value)) return invalid();
  const seen = new Set<string>();
  return value.map(row => {
    if (!record(row) || !idString(row.id) || seen.has(row.id) || typeof row.title !== 'string' ||
        typeof row.isEnrolled !== 'boolean' || typeof row.completed !== 'boolean' || typeof row.canDelete !== 'boolean') return invalid();
    seen.add(row.id);
    return { id: row.id, title: row.title, isEnrolled: row.isEnrolled, completed: row.completed, canDelete: row.canDelete };
  });
}

/** The two private reads must describe one publication and a coherent tree.
 * Local date/prerequisite checks can only CLOSE access, never open a server
 * gate or remove an already confirmed completion after a date-only reschedule.
 */
export function readJourneyDetail(contentsValue: unknown, progressValue: unknown, courseId: string, now = Date.now()) {
  if (!record(progressValue) || progressValue.canTrack !== true || typeof progressValue.complete !== 'boolean' ||
      !idString(progressValue.publicationId) || !Number.isFinite(now)) return invalid();
  const progress: JourneyProgress = {
    completedContentIds: ids(progressValue.completedContentIds),
    awaitingGradeContentIds: ids(progressValue.awaitingGradeContentIds),
    complete: progressValue.complete, canTrack: true, publicationId: progressValue.publicationId,
  };
  const byId = new Map<string, CheckedContent>();
  const parse = (items: unknown, parentId: string | null): CheckedContent[] => {
    if (!Array.isArray(items) || items.length > MAX_NODES) return invalid();
    return items.map(row => {
      if (!record(row) || !idString(row.id) || byId.has(row.id) || byId.size >= MAX_NODES ||
          row.courseId !== courseId || row.parentId !== parentId || row.publicationId !== progress.publicationId ||
          typeof row.title !== 'string' || typeof row.type !== 'string' || !CONTENT_TYPES.has(row.type) ||
          typeof row.order !== 'number' || !Number.isSafeInteger(row.order) || typeof row.locked !== 'boolean' ||
          typeof row.releaseLocked !== 'boolean' ||
          (row.releaseOn !== null && !isChapterReleaseDate(row.releaseOn)) ||
          (row.contentVersionToken !== null && !idString(row.contentVersionToken)) ||
          (row.locked === false && !idString(row.contentVersionToken))) return invalid();
      const prerequisiteIds = ids(row.prerequisiteIds, 20);
      if (!Array.isArray(row.missingPrerequisites) || row.missingPrerequisites.length > 20) return invalid();
      const missingSeen = new Set<string>();
      const missingPrerequisites = row.missingPrerequisites.map(item => {
        if (!record(item) || !idString(item.id) || typeof item.title !== 'string' || missingSeen.has(item.id) ||
            !prerequisiteIds.includes(item.id)) return invalid();
        missingSeen.add(item.id);
        return { id: item.id, title: item.title };
      });
      const node: CheckedContent = {
        id: row.id, title: row.title, type: row.type as JourneyContent['type'], order: row.order,
        courseId, parentId, publicationId: progress.publicationId, locked: row.locked,
        releaseLocked: row.releaseLocked, releaseOn: row.releaseOn as string | null,
        prerequisiteIds, missingPrerequisites, subContents: [],
      };
      byId.set(node.id, node);
      node.subContents = parse(row.subContents === undefined ? [] : row.subContents, node.id);
      return node;
    });
  };
  const contents = parse(contentsValue, null);
  const leaves = new Map([...byId].filter(([, node]) => node.subContents.length === 0));
  const completed = new Set(progress.completedContentIds);
  if (progress.completedContentIds.some(id => !leaves.has(id)) ||
      progress.awaitingGradeContentIds.some(id => !leaves.has(id) || leaves.get(id)!.type !== 'ASSIGNMENT' || completed.has(id)) ||
      progress.complete !== (leaves.size > 0 && progress.completedContentIds.length === leaves.size)) return invalid();
  for (const node of byId.values()) {
    if (node.prerequisiteIds.some(id => id === node.id || !leaves.has(id))) return invalid();
    const closedByDate = !chapterIsReleased(node.releaseOn, now);
    const missing = new Map(node.missingPrerequisites.map(item => [item.id, item]));
    for (const id of node.prerequisiteIds) if (!completed.has(id)) missing.set(id, { id, title: leaves.get(id)!.title });
    node.missingPrerequisites = [...missing.values()];
    node.releaseLocked = node.releaseLocked || closedByDate;
    node.locked = node.locked || node.releaseLocked || missing.size > 0;
  }
  return { contents, progress };
}

/** Chapter markers are reversible current-view summaries of actual leaves.
 * Shared reader/projectJourney completion and ordering semantics are untouched.
 */
export function groupJourneyTrail(contents: JourneyContent[], projection: JourneyProjection): JourneyTrailGroup[] {
  const stationById = new Map(projection.leaves.map((leaf, index) => [leaf.id, { leaf, position: index + 1 }]));
  const ordered = (items: JourneyContent[]) => [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return ordered(contents).map(root => {
    const stations: JourneyTrailStation[] = [];
    const stack = [root];
    while (stack.length) {
      const node = stack.pop()!;
      const children = ordered(node.subContents ?? []);
      if (children.length) for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
      else {
        const station = stationById.get(node.id);
        if (station) stations.push(station);
      }
    }
    return { id: root.id, title: root.title, isChapter: Boolean(root.subContents?.length), stations,
      completedCount: stations.filter(station => station.leaf.completed).length };
  });
}

