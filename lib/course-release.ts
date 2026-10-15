/** Calendar dates release a whole top-level chapter at 00:00 UTC. */
export function isChapterReleaseDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type ReleaseNode = { id: string; parentId: string | null; releaseOn?: string };

/** Call after topology validation. Only the current root's date is inherited. */
export function chapterReleaseDates(nodes: ReleaseNode[]): Map<string, string | null> {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return new Map(nodes.map(node => {
    let root = node;
    const seen = new Set([node.id]);
    while (root.parentId !== null) {
      const parent = byId.get(root.parentId);
      if (!parent || seen.has(parent.id)) throw new Error('Invalid chapter hierarchy');
      seen.add(parent.id);
      root = parent;
    }
    return [node.id, root.releaseOn ?? null];
  }));
}

export function chapterIsReleased(releaseOn: string | null, now: number): boolean {
  return releaseOn === null || now >= Date.parse(`${releaseOn}T00:00:00.000Z`);
}

export function chapterReleaseLabel(releaseOn: string): string {
  return `${releaseOn.slice(8, 10)}.${releaseOn.slice(5, 7)}.${releaseOn.slice(0, 4)} · 00:00 UTC`;
}
