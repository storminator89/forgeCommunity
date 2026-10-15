import 'server-only';

export type PathNode = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  prerequisiteIds?: string[];
};

export class CoursePathError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

/** A dependency is an earlier leaf in the same published, depth-first outline. */
export function validateCoursePath(nodes: PathNode[]): void {
  const byId = new Map(nodes.map(node => [node.id, node]));
  if (byId.size !== nodes.length) throw new CoursePathError('Doppelte Kursinhalte im Lernpfad.', 409);
  const children = new Set(nodes.map(node => node.parentId).filter((id): id is string => id !== null));
  const byParent = new Map<string | null, PathNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }
  const position = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (parentId: string | null) => {
    for (const node of (byParent.get(parentId) ?? []).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
      if (visiting.has(node.id) || position.has(node.id)) throw new CoursePathError('Zyklische Kursstruktur.', 409);
      visiting.add(node.id);
      position.set(node.id, position.size);
      visit(node.id);
      visiting.delete(node.id);
    }
  };
  visit(null);
  if (position.size !== nodes.length) throw new CoursePathError('Unvollständige Kursstruktur.', 409);
  for (const node of nodes) {
    const prerequisites = node.prerequisiteIds ?? [];
    if (!Array.isArray(prerequisites) || prerequisites.length > 20 ||
        prerequisites.some(id => typeof id !== 'string') || new Set(prerequisites).size !== prerequisites.length ||
        (children.has(node.id) && prerequisites.length > 0)) {
      throw new CoursePathError(`Ungültige Voraussetzungen für „${node.title}“.`, 409);
    }
    for (const id of prerequisites) {
      if (!byId.has(id) || children.has(id) || !position.has(id) || position.get(id)! >= position.get(node.id)!) {
        throw new CoursePathError(`„${node.title}“ benötigt einen früheren Inhalt ohne Unterthemen aus demselben Kurs.`, 409);
      }
    }
  }
  const checked = new Set<string>();
  const active = new Set<string>();
  const checkCycle = (id: string) => {
    if (active.has(id)) throw new CoursePathError('Zyklische Lernvoraussetzungen.', 409);
    if (checked.has(id)) return;
    active.add(id);
    for (const dependency of byId.get(id)?.prerequisiteIds ?? []) checkCycle(dependency);
    active.delete(id);
    checked.add(id);
  };
  for (const node of nodes) checkCycle(node.id);
}

export function publicationPathNodes(payload: string): PathNode[] {
  let value: unknown;
  try { value = JSON.parse(payload); } catch { throw new CoursePathError('Veröffentlichter Lernpfad ist beschädigt.', 409); }
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 1 ||
      !Array.isArray((value as { contents?: unknown }).contents)) {
    throw new CoursePathError('Veröffentlichter Lernpfad ist beschädigt.', 409);
  }
  const nodes = (value as { contents: unknown[] }).contents;
  if (nodes.length > 500 || nodes.some(node => !node || typeof node !== 'object' || Array.isArray(node) ||
      typeof (node as PathNode).id !== 'string' || typeof (node as PathNode).title !== 'string' ||
      ((node as PathNode).parentId !== null && typeof (node as PathNode).parentId !== 'string') ||
      !Number.isSafeInteger((node as PathNode).order))) {
    throw new CoursePathError('Veröffentlichter Lernpfad ist beschädigt.', 409);
  }
  validateCoursePath(nodes as PathNode[]);
  return nodes as PathNode[];
}

/** Validate once for a published path and reuse the evaluator across a learner cohort. */
export function prepareCoursePath(nodes: PathNode[]) {
  validateCoursePath(nodes);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const byParent = new Map<string | null, PathNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }
  const outline: PathNode[] = [];
  const visit = (parentId: string | null) => {
    for (const node of (byParent.get(parentId) ?? []).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
      outline.push(node);
      visit(node.id);
    }
  };
  visit(null);
  return (rawCompletedIds: Iterable<string>) => {
    const rawCompleted = new Set(rawCompletedIds);
    const completed = new Set<string>();
    // Earlier-only edges guarantee this outline is a topological order.
    for (const node of outline) if (rawCompleted.has(node.id) &&
        (node.prerequisiteIds ?? []).every(id => completed.has(id))) completed.add(node.id);
    return new Map(nodes.map(node => [node.id, {
      locked: !(node.prerequisiteIds ?? []).every(id => completed.has(id)),
      prerequisiteIds: node.prerequisiteIds ?? [],
      missingPrerequisites: (node.prerequisiteIds ?? []).filter(id => !completed.has(id)).map(id => ({ id, title: byId.get(id)!.title })),
      completed: completed.has(node.id),
    }]));
  };
}

/** Call with authoritative current-revision completion IDs, including graded work. */
export function coursePathAccess(nodes: PathNode[], rawCompletedIds: Iterable<string>) {
  return prepareCoursePath(nodes)(rawCompletedIds);
}
