/**
 * Bounded in process fixed window rate limiting for authentication endpoints.
 *
 * This protects a single app instance. In a multi instance deployment, put a
 * shared limiter (for example Redis or an edge provider limit) in front of
 * these routes as well; this map is deliberately not presented as a cluster
 * wide security control.
 */

export const LOGIN_RATE_LIMIT = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
} as const;

export const REGISTER_RATE_LIMIT = {
  limit: 5,
  windowMs: 60 * 60 * 1000,
} as const;

// When no trusted proxy address is available, all callers share `unknown`.
// Keep a higher aggregate ceiling for that case instead of applying the
// strict per-client quota to every user behind the same proxy.
export const LOGIN_AGGREGATE_RATE_LIMIT = {
  limit: 100,
  windowMs: 15 * 60 * 1000,
} as const;

export const REGISTER_AGGREGATE_RATE_LIMIT = {
  limit: 100,
  windowMs: 60 * 60 * 1000,
} as const;

export const UPLOAD_RATE_LIMIT = {
  limit: 30,
  windowMs: 60 * 60 * 1000,
} as const;

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitState = {
  entries: Map<string, RateLimitEntry>;
};

const globalState = globalThis as typeof globalThis & {
  __forgeCommunityRateLimitState?: RateLimitState;
};

const state: RateLimitState =
  globalState.__forgeCommunityRateLimitState ?? { entries: new Map() };
globalState.__forgeCommunityRateLimitState = state;

const MAX_ENTRIES = 10_000;
const PRUNE_INTERVAL_MS = 30_000;
let lastPrunedAt = 0;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function pruneExpired(now: number): void {
  for (const [key, entry] of state.entries) {
    if (entry.resetAt <= now) state.entries.delete(key);
  }
}

export function consumeRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
  now = Date.now(),
): RateLimitResult {
  // Periodic pruning keeps normal requests O(1); expired entries are also
  // removed when their key is touched. A full map fails closed rather than
  // evicting an active client's entry under attacker controlled key churn.
  if (now >= lastPrunedAt + PRUNE_INTERVAL_MS || now < lastPrunedAt) {
    pruneExpired(now);
    lastPrunedAt = now;
  }

  let entry = state.entries.get(key);
  if (!entry || entry.resetAt <= now) {
    if (entry) state.entries.delete(key);
    if (state.entries.size >= MAX_ENTRIES) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: 1,
      };
    }
    entry = { count: 0, resetAt: now + options.windowMs };
    state.entries.set(key, entry);
  }

  if (entry.count >= options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  entry.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, options.limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'Cache-Control': 'no-store',
    'Retry-After': String(result.retryAfterSeconds),
    'X-RateLimit-Remaining': String(result.remaining),
  };
}

/** Test and development utility; production code should not need to clear it. */
export function resetRateLimitStore(): void {
  state.entries.clear();
}
