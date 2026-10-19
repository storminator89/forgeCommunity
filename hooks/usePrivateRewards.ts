'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCommunityJson, isAbortError } from '@/lib/community-feed'
import { isRewardSummary, type CourseRewardMoment, type RewardSummary } from '@/lib/rewards'

type PrivateRead = {
  userId: string; actorEpoch: number; revision: number
  data: RewardSummary | null; error: boolean; rewardMoment: CourseRewardMoment | null
}
type HistoryBaseline = { actorEpoch: number; marker: string | null; seen: Set<string> }

export function usePrivateRewards(userId: string | undefined) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<PrivateRead | null>(null)
  const [actor, setActor] = useState({ userId, epoch: 0 })
  const baseline = useRef<HistoryBaseline | null>(null)
  const requestSerial = useRef(0)
  const preferenceEpoch = useRef(0)
  const intent = useRef<{ actorEpoch: number; serial: number; preferenceEpoch: number } | null>(null)
  if (actor.userId !== userId) {
    setActor({ userId, epoch: actor.epoch + 1 })
    setResult(null)
  }

  // Consume pending/visible moments at the preference event itself. An off/on
  // pair during a request must not rearm it, even if React batches the renders.
  useEffect(() => {
    const consume = () => {
      preferenceEpoch.current += 1
      setResult(current => current ? { ...current, rewardMoment: null } : null)
    }
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === 'forge-community-motion-off' || event.key === 'forge-journey-mascot-hidden') consume()
    }
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    window.addEventListener('forge-community-motion-change', consume)
    window.addEventListener('forge-journey-mascot-visibility-change', consume)
    window.addEventListener('storage', storageChanged)
    media?.addEventListener('change', consume)
    return () => {
      window.removeEventListener('forge-community-motion-change', consume)
      window.removeEventListener('forge-journey-mascot-visibility-change', consume)
      window.removeEventListener('storage', storageChanged)
      media?.removeEventListener('change', consume)
    }
  }, [])

  const refresh = useCallback(() => {
    const serial = ++requestSerial.current
    intent.current = { actorEpoch: actor.epoch, serial, preferenceEpoch: preferenceEpoch.current }
    setResult(current => current ? { ...current, rewardMoment: null } : null)
    setRevision(value => value + 1)
  }, [actor.epoch])

  useEffect(() => {
    if (!userId) {
      baseline.current = null
      return
    }
    if (baseline.current?.actorEpoch !== actor.epoch) {
      baseline.current = { actorEpoch: actor.epoch, marker: null, seen: new Set() }
    }
    const controller = new AbortController()
    const serial = requestSerial.current
    const requested = intent.current?.actorEpoch === actor.epoch && intent.current.serial === serial ? intent.current : null
    void fetchCommunityJson<unknown>('/api/rewards/me', { signal: controller.signal, cache: 'no-store' })
      .then(data => {
        if (!isRewardSummary(data)) throw new Error('Ungültiger Punktestand')
        if (controller.signal.aborted || requestSerial.current !== serial) return
        const previous = baseline.current
        if (!previous || previous.actorEpoch !== actor.epoch) return
        const history = data.history
        const marked = history && history.every(change => typeof change.eventKey === 'string' && typeof change.activeAward === 'boolean')
        let rewardMoment: CourseRewardMoment | null = null
        if (marked) {
          // A bounded window is evidence of novelty only while its exact prior
          // newest marker still overlaps. Empty/legacy/lost windows prime only.
          const overlap = previous.marker ? history.findIndex(change => change.eventKey === previous.marker) : -1
          const fresh = overlap > 0 ? history.slice(0, overlap).find(change =>
            !previous.seen.has(change.eventKey!) && change.type === 'AWARDED' && change.activeAward === true && change.pointsDelta === 50) : undefined
          // Consume every observed identity before deciding whether to display.
          for (const change of history) previous.seen.add(change.eventKey!)
          previous.marker = history[0]?.eventKey ?? null
          if (fresh && requested && requested.preferenceEpoch === preferenceEpoch.current) {
            rewardMoment = { eventKey: fresh.eventKey!, points: 50 }
          }
        } else {
          previous.marker = null
        }
        setResult({ userId, actorEpoch: actor.epoch, revision, data, error: false, rewardMoment })
      })
      .catch(error => {
        if (!controller.signal.aborted && requestSerial.current === serial && !isAbortError(error)) {
          if (baseline.current?.actorEpoch === actor.epoch) baseline.current.marker = null
          setResult({ userId, actorEpoch: actor.epoch, revision, data: null, error: true, rewardMoment: null })
        }
      })
    return () => controller.abort()
  }, [userId, actor.epoch, revision])

  // Hide an old account or old read immediately, before effects can run.
  const active = actor.userId === userId && result && result.userId === userId && result.actorEpoch === actor.epoch && result.revision === revision ? result : null
  const rewardMoment = active?.rewardMoment ?? null
  useEffect(() => {
    if (!rewardMoment) return
    const timeout = window.setTimeout(() => setResult(current =>
      current?.actorEpoch === actor.epoch && current.revision === revision && current.rewardMoment?.eventKey === rewardMoment.eventKey
        ? { ...current, rewardMoment: null } : current), 2800)
    return () => window.clearTimeout(timeout)
  }, [rewardMoment, actor.epoch, revision])

  return { summary: active?.data ?? null, loading: !!userId && !active, error: active?.error ?? false, refresh, rewardMoment }
}
