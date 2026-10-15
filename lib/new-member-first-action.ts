// A browser-only UI preference, never a server-owned onboarding, reward or
// authorization record. Only a successful registration receipt seeds it.
export type FirstActionStatus = 'open' | 'dismissed'
const CHANGE_EVENT = 'forge:first-action-change'
const volatileStatus = new Map<string, FirstActionStatus>()

export function firstActionStorageKey(userId: string) {
  return `forge:first-action:v1:${encodeURIComponent(userId)}`
}

export function firstActionSnapshot(userId: string): FirstActionStatus | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(firstActionStorageKey(userId))
    if (value === 'open' || value === 'dismissed') return value
  } catch {
    // Private browsing or blocked storage must not interrupt registration.
  }
  return volatileStatus.get(userId) ?? null
}

function writeStatus(userId: string, status: FirstActionStatus) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(firstActionStorageKey(userId), status)
    volatileStatus.delete(userId)
  } catch {
    // Preserve Skip for this visit even when persistence is unavailable.
    volatileStatus.set(userId, status)
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function registerNewMemberFirstAction(userId: unknown) {
  if (typeof userId !== 'string' || !userId || userId.length > 128) return
  // A repeated receipt must not undo an explicit dismissal.
  if (firstActionSnapshot(userId) === null) writeStatus(userId, 'open')
}

export function setFirstActionVisibility(userId: string, visible: boolean) {
  if (firstActionSnapshot(userId) !== null) writeStatus(userId, visible ? 'open' : 'dismissed')
}

export function subscribeFirstAction(callback: () => void) {
  window.addEventListener('storage', callback)
  window.addEventListener(CHANGE_EVENT, callback)
  return () => {
    window.removeEventListener('storage', callback)
    window.removeEventListener(CHANGE_EVENT, callback)
  }
}
