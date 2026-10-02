export type GroupedCourseContent<T> = T & { subContents: GroupedCourseContent<T>[] };

/** Build a stable, acyclic tree without hiding legacy orphaned or cyclic records. */
export function groupCourseContents<T extends { id: string; parentId: string | null; order?: number }>(contents: T[]) {
  const byId = new Map<string, GroupedCourseContent<T>>();
  const roots: GroupedCourseContent<T>[] = [];
  const sorted = [...contents].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
  for (const content of sorted) byId.set(content.id, { ...content, subContents: [] });

  // Visit each parent chain once; only cycle members need their edge detached.
  // Their ordinary descendants remain nested, including very deep courses.
  const evaluated = new Set<string>();
  const cyclic = new Set<string>();
  for (const { id } of sorted) {
    if (evaluated.has(id)) continue;
    const path: string[] = [];
    const indices = new Map<string, number>();
    let currentId: string | null = id;
    while (currentId && byId.has(currentId) && !evaluated.has(currentId)) {
      const repeatedAt = indices.get(currentId);
      if (repeatedAt !== undefined) {
        for (const memberId of path.slice(repeatedAt)) cyclic.add(memberId);
        break;
      }
      indices.set(currentId, path.length);
      path.push(currentId);
      currentId = byId.get(currentId)!.parentId;
    }
    path.forEach(memberId => evaluated.add(memberId));
  }

  const attached = new Set<string>();
  for (const { id } of sorted) {
    if (attached.has(id)) continue;
    attached.add(id);
    const node = byId.get(id)!;
    const parent = node.parentId && byId.get(node.parentId);
    if (parent && !cyclic.has(id)) parent.subContents.push(node);
    else roots.push(node);
  }
  return roots;
}
