export const KNOWLEDGE_QUERY_LIMIT = 120;

export interface KnowledgeDirectoryState {
  query: string;
  category: string;
  tag: string;
}

function singleValue(params: URLSearchParams, name: string) {
  const values = params.getAll(name);
  return values.length === 1 ? values[0] : '';
}

function cleanQuery(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, KNOWLEDGE_QUERY_LIMIT);
}

function filterValue(value: string) {
  return value && !/[\u0000-\u001f\u007f]/.test(value) ? value : 'All';
}

/** Only ordinary, explicit directory filters belong to this shareable state. */
export function readKnowledgeDirectoryState(search: string): KnowledgeDirectoryState {
  const params = new URLSearchParams(search);
  return {
    query: cleanQuery(singleValue(params, 'q')),
    category: filterValue(singleValue(params, 'category')),
    tag: filterValue(singleValue(params, 'tag')),
  };
}

/** Category/tag names come from the existing published-article DTO. */
export function validateKnowledgeDirectoryFilters(
  state: KnowledgeDirectoryState,
  categories: readonly string[],
  tags: readonly string[],
): KnowledgeDirectoryState {
  return {
    query: state.query,
    category: categories.includes(state.category) ? state.category : 'All',
    tag: tags.includes(state.tag) ? state.tag : 'All',
  };
}

export function knowledgeDirectoryHref(state: KnowledgeDirectoryState, hash = '') {
  const params = new URLSearchParams();
  const query = cleanQuery(state.query);
  const category = filterValue(state.category);
  const tag = filterValue(state.tag);
  if (query) params.set('q', query);
  if (category !== 'All') params.set('category', category);
  if (tag !== 'All') params.set('tag', tag);
  const search = params.toString();
  const fragment = hash.startsWith('#') && !/[\u0000-\u001f\u007f]/.test(hash) ? hash : '';
  return `/knowledgebase${search ? `?${search}` : ''}${fragment}`;
}
