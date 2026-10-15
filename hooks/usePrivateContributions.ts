'use client'

import { useCallback, useEffect, useState } from 'react'
import { fetchCommunityJson, isAbortError } from '@/lib/community-feed'
import { isContributionSummary, type ContributionSummary } from '@/lib/contributions'

export function usePrivateContributions(userId: string | undefined) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ userId: string; revision: number; data: ContributionSummary | null; error: boolean } | null>(null)
  const [previousUserId, setPreviousUserId] = useState(userId)
  if (previousUserId !== userId) {
    setPreviousUserId(userId)
    setResult(null)
  }
  const refresh = useCallback(() => setRevision(value => value + 1), [])

  useEffect(() => {
    if (!userId) return
    const controller = new AbortController()
    void fetchCommunityJson<unknown>('/api/contributions/me', { signal: controller.signal, cache: 'no-store' })
      .then(data => {
        if (!isContributionSummary(data)) throw new Error('Ungültiger Diskussionsstand')
        if (!controller.signal.aborted) setResult({ userId, revision, data, error: false })
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setResult({ userId, revision, data: null, error: true })
      })
    return () => controller.abort()
  }, [userId, revision])

  useEffect(() => {
    if (!userId) return
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, refresh])

  // Hide an old account or old read immediately, before effects can run.
  const active = previousUserId === userId && result && result.userId === userId && result.revision === revision ? result : null
  return { summary: active?.data ?? null, loading: !!userId && !active, error: active?.error ?? false, refresh }
}
