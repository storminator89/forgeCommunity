export const RESOURCE_QUERY_LIMIT = 120;

export type ResourceSort = 'newest' | 'oldest' | 'title';

export interface ResourceDirectoryState {
  query: string;
  category: string;
  type: string;
  sort: ResourceSort;
}

function singleValue(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : '';
}

function cleanQuery(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, RESOURCE_QUERY_LIMIT);
}

function filterValue(value: string, allowed: readonly string[]) {
  return allowed.includes(value) ? value : 'all';
}

function sortValue(value: string): ResourceSort {
  return value === 'oldest' || value === 'title' ? value : 'newest';
}

/** These allowlists are the directory's existing controls, not new taxonomy. */
export function readResourceDirectoryState(
  search: string,
  categories: readonly string[],
  types: readonly string[],
): ResourceDirectoryState {
  const params = new URLSearchParams(search);
  return {
    query: cleanQuery(singleValue(params, 'q')),
    category: filterValue(singleValue(params, 'category'), categories),
    type: filterValue(singleValue(params, 'type'), types),
    sort: sortValue(singleValue(params, 'sort')),
  };
}

export function resourceDirectoryHref(
  state: ResourceDirectoryState,
  categories: readonly string[],
  types: readonly string[],
  hash = '',
) {
  const params = new URLSearchParams();
  const query = cleanQuery(state.query);
  const category = filterValue(state.category, categories);
  const type = filterValue(state.type, types);
  const sort = sortValue(state.sort);
  if (query) params.set('q', query);
  if (category !== 'all') params.set('category', category);
  if (type !== 'all') params.set('type', type);
  if (sort !== 'newest') params.set('sort', sort);
  const search = params.toString();
  const fragment = hash.startsWith('#') && !/[\u0000-\u001f\u007f]/.test(hash) ? hash : '';
  return `/resources${search ? `?${search}` : ''}${fragment}`;
}
