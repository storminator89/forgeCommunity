import { Check } from 'lucide-react'

type Props = {
  count: number
  targets: readonly number[]
  current?: boolean
  tone: 'learning' | 'contribution'
  label: string
  unit: (target: number) => string
  remaining: (count: number) => string
  complete: string
  progressDescription: string
}

/** The caller supplies the unit and time basis; these two tracks never add up. */
export function MilestoneTrack({ count, targets, current = false, tone, label, unit, remaining, complete, progressDescription }: Props) {
  const next = targets.find(target => count < target)
  const ceiling = next ?? targets[targets.length - 1]
  const reachedColor = tone === 'learning' ? 'text-reward-ink' : 'text-coral'
  const reachedSurface = tone === 'learning' ? 'border-reward-ink/35 bg-reward/15 text-reward-ink' : 'border-coral/35 bg-coral/10 text-coral'

  return <div className="mt-4 min-w-0">
    <div className="min-h-12 text-sm leading-relaxed">
      {next !== undefined ? <>
        <p className="font-semibold">Nächster Meilenstein: {next} {unit(next)}</p>
        <p className="text-muted-foreground">{remaining(next - count)}</p>
      </> : <p className={`font-semibold ${reachedColor}`}>{complete}</p>}
    </div>
    <progress value={Math.min(count, ceiling)} max={ceiling} aria-label={label} aria-valuetext={progressDescription}
      className={`mt-2 block h-2.5 w-full ${tone === 'learning' ? 'accent-progress' : 'accent-coral'}`}>
      {progressDescription}
    </progress>
    <ol className="mt-3 grid grid-cols-3 gap-2" aria-label={label}>
      {targets.map(target => {
        const reached = count >= target
        const upcoming = target === next
        return <li key={target} className="flex min-w-0 flex-col items-center gap-1 text-center">
          <span aria-hidden="true" className={`flex size-8 items-center justify-center rounded-full border ${reached ? reachedSurface : upcoming ? 'border-2 border-primary bg-accent text-primary' : 'border-border bg-muted text-muted-foreground'}`}>
            {reached ? <Check className="size-4" strokeWidth={2.5} /> : <span className="text-xs font-semibold tabular-nums">{target}</span>}
          </span>
          <span className={`text-xs font-medium ${reached ? reachedColor : upcoming ? 'text-primary' : 'text-muted-foreground'}`}>
            {target} {unit(target)}
            <span className="sr-only">: {reached ? current ? 'aktuell erreicht' : 'erreicht' : upcoming ? 'nächster Meilenstein' : 'noch nicht erreicht'}</span>
          </span>
        </li>
      })}
    </ol>
  </div>
}
