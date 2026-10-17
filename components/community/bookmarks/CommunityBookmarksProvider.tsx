'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { COMMUNITY_BOOKMARK_BATCH_LIMIT, communityBookmarkKey } from '@/lib/community-bookmarks';
import type { CommunityBookmarkTarget, OwnCommunityBookmark } from '@/lib/community-bookmarks';

type Entry = { state?: OwnCommunityBookmark; pending?: boolean; uncertain?: boolean; error?: string; unavailable?: boolean };
type Store = { entries: Record<string, Entry>; change: (target: CommunityBookmarkTarget) => Promise<void>; refresh: () => void };
const Context = createContext<Store | null>(null);
const validState = (value: unknown): value is OwnCommunityBookmark => {
  if (!value || typeof value !== 'object') return false;
  const row = value as OwnCommunityBookmark;
  return (row.kind === 'post' || row.kind === 'comment') && typeof row.targetId === 'string' && typeof row.saved === 'boolean' && Number.isInteger(row.revision) && row.revision >= 0;
};

/** The keyed boundary discards state synchronously on account change, before
 * effects or pending network responses can paint a previous account's state. */
export function CommunityBookmarksProvider({ accountId, targets, children }: { accountId?: string; targets: CommunityBookmarkTarget[]; children: React.ReactNode }) {
  return <AccountBookmarks key={accountId ?? 'signed-out'} accountId={accountId} targets={targets}>{children}</AccountBookmarks>;
}
function AccountBookmarks({ accountId, targets, children }: { accountId?: string; targets: CommunityBookmarkTarget[]; children: React.ReactNode }) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const entriesRef = useRef(entries);
  const active = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const epochs = useRef(new Map<string, number>());
  const [refreshVersion, setRefreshVersion] = useState(0);
  const targetJson = JSON.stringify([...new Map(targets.map(target => [communityBookmarkKey(target), target])).values()].sort((a, b) => communityBookmarkKey(a).localeCompare(communityBookmarkKey(b))));
  const update = useCallback((work: (previous: Record<string, Entry>) => Record<string, Entry>) => {
    if (!active.current) return;
    const next = work(entriesRef.current); entriesRef.current = next; setEntries(next);
  }, []);
  useEffect(() => { active.current = true; const pending = requests.current; return () => { active.current = false; for (const request of pending) request.abort(); pending.clear(); }; }, []);
  useEffect(() => {
    if (!accountId) return;
    const selected: CommunityBookmarkTarget[] = JSON.parse(targetJson);
    const pending = requests.current;
    const controller = new AbortController(); pending.add(controller);
    const snapshot = new Map(epochs.current);
    const load = async () => {
      try {
        for (let offset = 0; offset < selected.length; offset += COMMUNITY_BOOKMARK_BATCH_LIMIT) {
          const chunk = selected.slice(offset, offset + COMMUNITY_BOOKMARK_BATCH_LIMIT);
          const response = await fetch('/api/community/bookmarks/state', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targets: chunk }), signal: controller.signal, cache: 'no-store' });
          const body = await response.json();
          if (!response.ok || !Array.isArray(body.states) || !body.states.every(validState)) throw new Error();
          if (controller.signal.aborted) return;
          const received = new Map<string, OwnCommunityBookmark>(body.states.map((state: OwnCommunityBookmark) => [communityBookmarkKey(state), state]));
          update(previous => {
            const next = { ...previous };
            for (const target of chunk) {
              const key = communityBookmarkKey(target);
              if ((snapshot.get(key) ?? 0) !== (epochs.current.get(key) ?? 0) || previous[key]?.pending) continue;
              const state = received.get(key);
              if (!state) { next[key] = { unavailable: true }; continue; }
              if ((previous[key]?.state?.revision ?? -1) > state.revision) continue;
              next[key] = { state };
            }
            return next;
          });
        }
      } catch {
        if (!controller.signal.aborted) update(previous => {
          const next = { ...previous };
          for (const target of selected) {
            const key = communityBookmarkKey(target);
            if ((snapshot.get(key) ?? 0) === (epochs.current.get(key) ?? 0)) next[key] = { ...next[key], uncertain: true, error: 'Stand konnte nicht geladen werden.' };
          }
          return next;
        });
      } finally { pending.delete(controller); }
    };
    void load();
    return () => { controller.abort(); pending.delete(controller); };
  }, [accountId, targetJson, refreshVersion, update]);
  const refresh = useCallback(() => setRefreshVersion(version => version + 1), []);
  const change = useCallback(async (target: CommunityBookmarkTarget) => {
    const key = communityBookmarkKey(target);
    const current = entriesRef.current[key];
    if (!accountId || !current?.state || current.pending || current.uncertain || current.unavailable) return;
    epochs.current.set(key, (epochs.current.get(key) ?? 0) + 1);
    const generation = epochs.current.get(key);
    const controller = new AbortController(); requests.current.add(controller);
    update(previous => ({ ...previous, [key]: { state: current.state, pending: true } }));
    try {
      const response = await fetch(`/api/community/bookmarks/${target.kind}/${encodeURIComponent(target.targetId)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, signal: controller.signal, cache: 'no-store',
        body: JSON.stringify({ saved: !current.state.saved, expectedRevision: current.state.revision, requestId: crypto.randomUUID() }),
      });
      const body = await response.json();
      if (controller.signal.aborted || epochs.current.get(key) !== generation) return;
      const valid = validState(body.state) && communityBookmarkKey(body.state) === key && body.state.revision >= current.state.revision;
      if (response.status === 404) { update(previous => ({ ...previous, [key]: { unavailable: true } })); return; }
      if (response.status === 409 && valid) { update(previous => ({ ...previous, [key]: { state: body.state, error: 'Auf einem anderen Gerät geändert. Stand prüfen.' } })); return; }
      if (!response.ok || !valid) throw new Error();
      update(previous => ({ ...previous, [key]: { state: body.state } }));
    } catch {
      if (!controller.signal.aborted) update(previous => ({ ...previous, [key]: { state: current.state, uncertain: true, error: 'Änderung nicht bestätigt. Stand erneut laden.' } }));
    } finally {
      if (epochs.current.get(key) === generation) epochs.current.set(key, (generation ?? 0) + 1);
      requests.current.delete(controller);
    }
  }, [accountId, update]);
  const value = useMemo(() => ({ entries, change, refresh }), [entries, change, refresh]);
  return <Context.Provider value={accountId ? value : null}>{children}</Context.Provider>;
}
export function useCommunityBookmark(target: CommunityBookmarkTarget) {
  const store = useContext(Context);
  return store ? { entry: store.entries[communityBookmarkKey(target)], change: () => store.change(target), refresh: store.refresh } : null;
}
