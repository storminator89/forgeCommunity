'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Flag } from 'lucide-react'
import { useSparkVisibility } from '@/hooks/useSparkVisibility'

/** Static context, never an event player. Historical reads cannot replay success. */
export function ProgressSpark({ state }: { state: 'neutral' | 'target' | 'reached' }) {
  const { visible } = useSparkVisibility()
  const [failedSource, setFailedSource] = useState<string | null>(null)
  if (!visible) return null
  const source = state === 'reached' ? '/images/forge-spark-celebrate-final.webp' : '/images/forge-spark-preview.webp'
  return <span aria-hidden="true" data-progress-spark={state}
    className={`relative flex size-20 shrink-0 items-center justify-center rounded-full ${state === 'reached' ? 'bg-reward/15 ring-1 ring-inset ring-reward-ink/20' : state === 'target' ? 'bg-accent ring-1 ring-inset ring-primary/20' : 'bg-muted'}`}>
    {failedSource !== source && <Image src={source} width={80} height={80} alt="" unoptimized
      className="block size-20 object-contain" onError={() => setFailedSource(source)} />}
    {state === 'target' && <span className="absolute bottom-0 right-0 flex size-6 items-center justify-center rounded-full border border-border bg-card text-primary"><Flag className="size-3" /></span>}
  </span>
}
