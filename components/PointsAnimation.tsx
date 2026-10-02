import { useEffect, useEffectEvent } from 'react'

interface PointsAnimationProps {
  points: number
  isVisible: boolean
  onComplete: () => void
}

export function PointsAnimation({ points, isVisible, onComplete }: PointsAnimationProps) {
  const complete = useEffectEvent(onComplete)

  useEffect(() => {
    if (!isVisible) return
    const timeout = setTimeout(() => complete(), 1500)
    return () => clearTimeout(timeout)
  }, [isVisible, points])

  if (!isVisible) return null

  return (
    <div role="status" className="fixed bottom-4 right-4 z-50 rounded-xl border bg-card px-4 py-2 text-sm text-foreground shadow-sm">
      <span className="font-semibold tabular-nums">+{points}</span> Punkte
    </div>
  )
}
