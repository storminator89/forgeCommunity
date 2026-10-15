'use client'

import Link from 'next/link'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { firstActionSnapshot, setFirstActionVisibility, subscribeFirstAction } from '@/lib/new-member-first-action'

export function FirstActionGuide({ userId }: { userId: string }) {
  return <AccountFirstActionGuide key={userId} userId={userId} />
}

function AccountFirstActionGuide({ userId }: { userId: string }) {
  const status = useSyncExternalStore(subscribeFirstAction, () => firstActionSnapshot(userId), () => null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const reopenRef = useRef<HTMLButtonElement>(null)
  const focusAfterChange = useRef<'open' | 'dismissed' | null>(null)

  useEffect(() => {
    // Restore focus only after this member uses Skip/Reopen, not on initial
    // arrival or a preference change from another tab.
    if (focusAfterChange.current && focusAfterChange.current === status) {
      if (status === 'open') titleRef.current?.focus()
      else reopenRef.current?.focus()
      focusAfterChange.current = null
    }
  }, [status])

  const changeVisibility = (visible: boolean) => {
    focusAfterChange.current = visible ? 'open' : 'dismissed'
    setFirstActionVisibility(userId, visible)
  }

  if (status === null) return null
  if (status === 'dismissed') return (
    <section aria-label="Dein Einstieg" className="mb-8 border-b pb-5">
      <Button ref={reopenRef} type="button" variant="outline" onClick={() => changeVisibility(true)}>Einstieg anzeigen</Button>
    </section>
  )

  return (
    <section aria-labelledby="first-action-title" className="mb-8 min-w-0 border-y py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-[68ch]">
          <h2 ref={titleRef} id="first-action-title" tabIndex={-1} className="text-xl font-semibold tracking-tight focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">Dein Einstieg</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Wähle, was dich gerade interessiert. Du kannst ohne weitere Profilangaben starten.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => changeVisibility(false)}>Überspringen</Button>
      </div>
      <ul aria-label="Ersten Schritt wählen" className="mt-5 flex min-w-0 flex-wrap gap-3">
        <li><Button asChild variant="outline"><a href="#community-feed-title">Beiträge lesen</a></Button></li>
        <li><Button asChild variant="outline"><Link href="/courses">Kurse entdecken</Link></Button></li>
        <li><Button asChild variant="outline"><Link href="/events">Events ansehen</Link></Button></li>
        <li><Button asChild variant="outline"><Link href="/settings?tab=skills">Fähigkeiten ergänzen</Link></Button></li>
      </ul>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Überspringen wird nur in diesem Browser gespeichert, wenn dein Browser das erlaubt. Du kannst den Einstieg hier wieder öffnen.</p>
    </section>
  )
}
