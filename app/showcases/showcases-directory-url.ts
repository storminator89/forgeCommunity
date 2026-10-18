export const SHOWCASE_QUERY_LIMIT = 120;

export type ShowcaseSort = 'newest' | 'mostLiked' | 'mostCommented';

export interface ShowcaseDirectoryState {
  query: string;
  tag: string;
  sort: ShowcaseSort;
}

function singleValue(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : '';
}

function cleanQuery(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, SHOWCASE_QUERY_LIMIT);
}

function tagValue(value: string) {
  return value && !/[\u0000-\u001f\u007f]/.test(value) ? value : 'all';
}

function sortValue(value: string): ShowcaseSort {
  return value === 'mostLiked' || value === 'mostCommented' ? value : 'newest';
}

/** Share only the existing directory controls, never project drafts or identity. */
export function readShowcaseDirectoryState(search: string): ShowcaseDirectoryState {
  const params = new URLSearchParams(search);
  return {
    query: cleanQuery(singleValue(params, 'q')),
    tag: tagValue(singleValue(params, 'tag')),
    sort: sortValue(singleValue(params, 'sort')),
  };
}

/** Tags are names from the complete project read, not project categories. */
export function validateShowcaseDirectoryTag(
  state: ShowcaseDirectoryState,
  tags: readonly string[],
): ShowcaseDirectoryState {
  return { ...state, tag: tags.includes(state.tag) ? state.tag : 'all' };
}

export function showcaseDirectoryHref(state: ShowcaseDirectoryState, hash = '') {
  const params = new URLSearchParams();
  const query = cleanQuery(state.query);
  const tag = tagValue(state.tag);
  const sort = sortValue(state.sort);
  if (query) params.set('q', query);
  if (tag !== 'all') params.set('tag', tag);
  if (sort !== 'newest') params.set('sort', sort);
  const search = params.toString();
  const fragment = hash.startsWith('#') && !/[\u0000-\u001f\u007f]/.test(hash) ? hash : '';
  return `/showcases${search ? `?${search}` : ''}${fragment}`;
}
