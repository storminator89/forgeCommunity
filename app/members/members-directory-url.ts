export const MEMBER_QUERY_LIMIT = 120;

export type MemberSort = 'name' | 'joinedAt' | 'followers';
export type MemberSortOrder = 'asc' | 'desc';

export interface MemberDirectoryState {
  query: string;
  skills: string[];
  roles: string[];
  sort: MemberSort;
  order: MemberSortOrder;
}

function singleValue(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : '';
}

function cleanQuery(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, MEMBER_QUERY_LIMIT);
}

function filterValues(values: readonly string[]) {
  return [...new Set(values.filter(value => value && !/[\u0000-\u001f\u007f]/.test(value)))];
}

function sortValue(value: string): MemberSort {
  return value === 'joinedAt' || value === 'followers' ? value : 'name';
}

function orderValue(value: string): MemberSortOrder {
  return value === 'desc' ? value : 'asc';
}

/** Only the existing discovery controls belong in the shareable member URL. */
export function readMemberDirectoryState(search: string): MemberDirectoryState {
  const params = new URLSearchParams(search);
  return {
    query: cleanQuery(singleValue(params, 'q')),
    skills: filterValues(params.getAll('skill')),
    roles: filterValues(params.getAll('role')),
    sort: sortValue(singleValue(params, 'sort')),
    order: orderValue(singleValue(params, 'order')),
  };
}

/** Dynamic choices come from the existing complete, successful member read. */
export function validateMemberDirectoryFilters(
  state: MemberDirectoryState,
  skills: readonly string[],
  roles: readonly string[],
): MemberDirectoryState {
  return {
    ...state,
    skills: state.skills.filter(skill => skills.includes(skill)),
    roles: state.roles.filter(role => roles.includes(role)),
  };
}

export function memberDirectoryHref(state: MemberDirectoryState, hash = '') {
  const params = new URLSearchParams();
  const query = cleanQuery(state.query);
  const sort = sortValue(state.sort);
  const order = orderValue(state.order);
  if (query) params.set('q', query);
  for (const skill of filterValues(state.skills)) params.append('skill', skill);
  for (const role of filterValues(state.roles)) params.append('role', role);
  if (sort !== 'name') params.set('sort', sort);
  if (order !== 'asc') params.set('order', order);
  const search = params.toString();
  const fragment = hash.startsWith('#') && !/[\u0000-\u001f\u007f]/.test(hash) ? hash : '';
  return `/members${search ? `?${search}` : ''}${fragment}`;
}
