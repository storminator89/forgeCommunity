export class PaginationError extends Error {}

/** Bound offset work as well as response size; reject malformed numbers explicitly. */
export function readPagination(params: URLSearchParams, defaultLimit = 10) {
  const positiveInteger = (key: string, fallback: number, max: number) => {
    const raw = params.get(key);
    if (raw === null) return fallback;
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > max) {
      throw new PaginationError(`${key} must be an integer between 1 and ${max}`);
    }
    return Number(raw);
  };
  const page = positiveInteger('page', 1, 100);
  const limit = positiveInteger('limit', defaultLimit, 50);
  return { page, limit, skip: (page - 1) * limit };
}
