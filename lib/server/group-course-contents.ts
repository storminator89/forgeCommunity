export type GroupedCourseContent<T> = T & { subContents: GroupedCourseContent<T>[] };

export function groupCourseContents<T extends { id: string; parentId: string | null }>(contents: T[]) {
  const byId = new Map<string, GroupedCourseContent<T>>();
  const roots: GroupedCourseContent<T>[] = [];
  for (const content of contents) byId.set(content.id, { ...content, subContents: [] });
  for (const content of contents) {
    const node = byId.get(content.id)!;
    const parent = content.parentId && byId.get(content.parentId);
    if (parent) parent.subContents.push(node);
    else roots.push(node);
  }
  return roots;
}
