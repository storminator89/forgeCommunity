'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { spaceJson, SpaceHttpError } from './space-api';
import type { MissionNextAction } from '@/types/space-mission-invitations';

type Unresolved = Readonly<{ body: string; path: string; method: 'POST' | 'PUT'; phase: 'sending' | 'unknown' }>;
const requests = new Map<string, Unresolved>();
let activeAccount: string | null = null;
const listeners = new Set<() => void>();
const MAX_REQUESTS = 32;
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
class InvitationMemoryCapacityError extends Error {}
function retain(key: string, value: Unresolved) {
  // Never evict an unresolved action to make room for a new one. Fail before fetch.
  if (!requests.has(key) && requests.size >= MAX_REQUESTS) throw new InvitationMemoryCapacityError();
  requests.set(key, value); emit();
}
function forget(key: string, exact: Unresolved) { if (requests.get(key) === exact) { requests.delete(key); emit(); } }

/** Observe even closed invitation surfaces; a loading session is not an account switch. */
export function useInvitationAccount(accountId: string | null | undefined) {
  useLayoutEffect(() => {
    if (accountId === undefined) return;
    const owner = accountId ?? 'anonymous';
    if (activeAccount !== owner) { requests.clear(); activeAccount = owner; emit(); }
  }, [accountId]);
}

/** Bounded tab-memory only. Reload creates a fresh module and performs no writes. */
export function useInvitationScope(accountId: string, scope: string) {
  const identity = JSON.stringify([accountId, scope]);
  const current = useRef({ identity, live: true });
  // Updating the imperative lease in render fences retained handlers before effects.
  /* eslint-disable react-hooks/refs */
  if (current.current.identity !== identity) { current.current.live = false; current.current = { identity, live: true }; }
  const lease = current.current;
  /* eslint-enable react-hooks/refs */
  useLayoutEffect(() => {
    // Keyed private views suppress old content during render. The commit lease
    // also discards account A memory before any B event/effect can submit it.
    if (activeAccount !== accountId) { requests.clear(); activeAccount = accountId; emit(); }
    lease.live = true; return () => { lease.live = false; };
  }, [lease, accountId]);
  const isCurrent = useCallback(() => current.current === lease && lease.live && activeAccount === accountId, [lease, accountId]);
  return { identity, isCurrent };
}

export function useInvitationMutation(identity: string, isCurrent: () => boolean, operation: string) {
  const key = JSON.stringify([identity, operation]);
  const unresolved = useSyncExternalStore(subscribe, () => requests.get(key) ?? null, () => null);
  const execute = async <T,>(path: string, method: 'POST' | 'PUT', body: object, valid: (value: unknown) => value is T): Promise<T | null> => {
    if (!isCurrent()) return null;
    const previous = requests.get(key);
    if (previous?.phase === 'sending') return null;
    const request: Unresolved = previous
      ? Object.freeze({ ...previous, phase: 'sending' })
      : Object.freeze({ path, method, body: JSON.stringify(body), phase: 'sending' });
    retain(key, request);
    try {
      const result = await spaceJson<unknown>(request.path, { method: request.method, headers: { 'Content-Type': 'application/json' }, body: request.body });
      if (!valid(result)) throw new Error('Unbekannte Antwort');
      forget(key, request);
      return isCurrent() ? result : null;
    } catch (error) {
      if (error instanceof SpaceHttpError && error.status >= 400 && error.status < 500) forget(key, request);
      else if (requests.get(key) === request) retain(key, Object.freeze({ ...request, phase: 'unknown' }));
      if (isCurrent()) throw error;
      return null;
    }
  };
  return { unresolved, execute };
}

export function useInvitationRead<T>(identity: string, isCurrent: () => boolean, path: string | null, valid: (value: unknown) => value is T) {
  const [snapshot, setSnapshot] = useState<{ identity: string; value: T | null; loading: boolean; error: string }>({ identity, value: null, loading: Boolean(path), error: '' });
  const generation = useRef(0);
  const load = useCallback(async () => {
    const read = ++generation.current;
    if (!path || !isCurrent()) return;
    setSnapshot({ identity, value: null, loading: true, error: '' });
    try {
      const value = await spaceJson<unknown>(path);
      if (!valid(value)) throw new Error('Unbekannte Antwort');
      if (isCurrent() && read === generation.current) setSnapshot({ identity, value, loading: false, error: '' });
    } catch {
      if (isCurrent() && read === generation.current) setSnapshot({ identity, value: null, loading: false, error: 'Einladungen sind gerade nicht verfügbar. Prüfe den Stand erneut.' });
    }
  }, [identity, isCurrent, path, valid]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    const refocus = () => { if (document.visibilityState !== 'hidden') void load(); };
    window.addEventListener('focus', refocus); document.addEventListener('visibilitychange', refocus);
    return () => { active = false; window.removeEventListener('focus', refocus); document.removeEventListener('visibilitychange', refocus); };
  }, [load]);
  return { ...(snapshot.identity === identity ? snapshot : { value: null, loading: Boolean(path), error: '' }), load };
}

export function invitationRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
export function invitationRevision(value: unknown): value is number { return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 2147483647; }
export function invitationProblem(error: unknown) {
  if (error instanceof InvitationMemoryCapacityError) return 'Es sind noch ungeklärte Anfragen offen. Kläre eine davon, bevor du eine neue Anfrage startest.';
  if (error instanceof SpaceHttpError && error.code === 'MISSION_FULL') return 'Inzwischen sind alle fünf Plätze belegt. Die Einladung reserviert keinen Platz.';
  if (error instanceof SpaceHttpError && error.code === 'MISSION_CLOSED') return 'Die Mission ist geschlossen. Eine Teilnahme ist nicht mehr möglich.';
  if (error instanceof SpaceHttpError && [401, 403, 404].includes(error.status)) return 'Diese Einladung ist nicht mehr verfügbar.';
  if (error instanceof SpaceHttpError && error.status < 500) return 'Die Anfrage wurde nicht ausgeführt. Prüfe den aktuellen Stand und wähle erneut.';
  return 'Die Antwort ist unklar. Wiederhole dieselbe Anfrage, um ihren Ausgang zu prüfen.';
}

export function missionNextStep(action: MissionNextAction) {
  switch (action.kind) {
    case 'CLOSED': return { text: 'Die Mission ist geschlossen.', href: null };
    case 'CURRENT_GOAL_REACHED': return { text: 'Das aktuelle gemeinsame Ziel ist erreicht. Lies, was ihr zusammengetragen habt.', href: '#mission-contributions' };
    case 'SHARE_INSIGHT': return { text: 'Teile eine eigene Erkenntnis.', href: '#mission-contributions-composer' };
    case 'REVIEW_BUILD_ON': return { text: 'Prüfe deinen weiterführenden Gedanken. Seine Grundlage ist nicht mehr sichtbar.', href: `#mission-own-contribution-${action.contributionId}` };
    case 'BUILD_ON': return { text: 'Lies die Erkenntnis einer anderen Person und baue darauf auf.', href: `#mission-contribution-${action.targetContributionId}` };
    case 'LIMIT_REACHED': return { text: 'Die Beitragsgrenze ist erreicht. Du kannst die Gedanken der Gruppe lesen.', href: '#mission-contributions' };
    case 'WAIT_FOR_PEER': return { text: 'Im Moment gibt es keinen weiteren Beitragsschritt. Du kannst die Gedanken der Gruppe lesen.', href: '#mission-contributions' };
  }
}
