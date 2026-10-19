/** Public catalog view state only. These tokens never authorize course access. */
export type CourseCatalogFilters = { q: string; category: string; mine: boolean };
export const COURSE_SEARCH_LIMIT = 200;
const allCategories = 'Alle';
const controls = /[\u0000-\u001f\u007f-\u009f]/;
const categoryTokenPattern = /^c1-[0-9a-f]{8}-[0-9a-f]{8}$/;

/** Bounded, deterministic UI lookup, not a confidentiality/security primitive.
 * Two seeded FNV-1a 32-bit accumulators consume the entire UTF-16 string.
 * Readers still reject collisions instead of selecting an arbitrary category.
 */
function categoryToken(category: string) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < category.length; index++) {
    const unit = category.charCodeAt(index);
    first = Math.imul(first ^ unit, 0x01000193);
    second = Math.imul(second ^ unit, 0x01000193);
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  return `c1-${hex(first)}-${hex(second)}`;
}

function uniqueValue(params: URLSearchParams, name: string, limit: number) {
  const values = params.getAll(name);
  return values.length === 1 && values[0].length <= limit && !controls.test(values[0]) ? values[0] : '';
}

function matchingCategories(token: string, categories: readonly string[]) {
  return Array.from(new Set(categories)).filter(category => categoryToken(category) === token);
}

export function readCourseCatalogFilters(search: string, categories: readonly string[]): CourseCatalogFilters {
  const params = new URLSearchParams(search);
  const token = uniqueValue(params, 'category', 20);
  const matches = categoryTokenPattern.test(token) ? matchingCategories(token, categories) : [];
  return {
    q: uniqueValue(params, 'q', COURSE_SEARCH_LIMIT),
    category: matches.length === 1 ? matches[0] : allCategories,
    mine: uniqueValue(params, 'mine', 1) === '1',
  };
}

/** Edit only our three keys; retain all unrelated values, the path and hash. */
export function courseCatalogHref(href: string, filters: CourseCatalogFilters, categories: readonly string[]) {
  const url = new URL(href);
  const q = filters.q.length <= COURSE_SEARCH_LIMIT && !controls.test(filters.q) ? filters.q : '';
  const token = filters.category !== allCategories && categories.includes(filters.category) ? categoryToken(filters.category) : '';
  const uniqueCategory = token && matchingCategories(token, categories).length === 1;
  const own = new URLSearchParams();
  if (q) own.set('q', q);
  if (uniqueCategory) own.set('category', token);
  if (filters.mine) own.set('mine', '1');
  // Keep even the original encoding/order of unrelated query parameters.
  const parts = url.search ? url.search.slice(1).split('&').filter(part => {
    try {
      const key = decodeURIComponent(part.split('=', 1)[0].replace(/\+/g, ' '));
      return key !== 'q' && key !== 'category' && key !== 'mine';
    } catch { return true; }
  }) : [];
  if (own.size) parts.push(own.toString());
  return `${url.pathname}${parts.length ? `?${parts.join('&')}` : ''}${url.hash}`;
}
