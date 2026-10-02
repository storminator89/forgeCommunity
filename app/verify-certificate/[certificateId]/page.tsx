'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, BadgeCheck, CircleAlert, Loader2, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ThemeToggle } from '@/components/theme-toggle'

interface Certificate {
  id: string
  userName: string
  courseName: string
  issuedAt: string
}
interface VerificationResponse {
  valid: boolean
  certificate?: Certificate
}

export default function VerifyCertificate() {
  const { certificateId } = useParams<{ certificateId: string }>()
  const [outcome, setOutcome] = useState<{ key: string; result?: VerificationResponse; error?: string } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const requestKey = `${certificateId}:${attempt}`
  const loading = outcome?.key !== requestKey
  const result = loading ? null : outcome?.result
  const error = loading ? '' : outcome?.error

  useEffect(() => {
    const controller = new AbortController()
    const key = `${certificateId}:${attempt}`
    const verify = async () => {
      try {
        if (!certificateId) throw new Error('Die Zertifikats-ID fehlt.')
        const response = await fetch(`/api/verify-certificate/${encodeURIComponent(certificateId)}`, { signal: controller.signal })
        if (response.status === 404) { if (!controller.signal.aborted) setOutcome({ key, result: { valid: false } }); return }
        if (!response.ok) throw new Error('Die Prüfung ist momentan nicht möglich. Bitte versuchen Sie es erneut.')
        const data = await response.json() as VerificationResponse
        if (typeof data.valid !== 'boolean') throw new Error('Die Antwort konnte nicht gelesen werden. Bitte versuchen Sie es erneut.')
        if (!controller.signal.aborted) setOutcome({ key, result: data })
      } catch (failure) {
        if (!controller.signal.aborted) setOutcome({ key, error: failure instanceof Error ? failure.message : 'Die Prüfung ist momentan nicht möglich.' })
      }
    }
    void verify()
    return () => controller.abort()
  }, [certificateId, attempt])

  const certificate = result?.valid ? result.certificate : undefined
  const issuedAt = certificate ? new Date(certificate.issuedAt) : null
  const issueDate = issuedAt && !Number.isNaN(issuedAt.getTime()) ? issuedAt.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Nicht verfügbar'

  return (
    <main className="flex min-h-svh flex-col bg-background p-4 text-foreground sm:p-8">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between"><Link href="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" aria-hidden="true" />ForgeCommunity</Link><ThemeToggle /></div>
      <div className="mx-auto flex w-full max-w-2xl flex-1 items-center py-10">
        <Card className="w-full">
          <CardHeader className="space-y-4 p-6 sm:p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">{certificate ? <BadgeCheck className="h-6 w-6" aria-hidden="true" /> : error || result ? <CircleAlert className="h-6 w-6" aria-hidden="true" /> : <ShieldCheck className="h-6 w-6" aria-hidden="true" />}</span>
            <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Zertifikatsprüfung</p><CardTitle className="text-2xl tracking-tight">{loading ? 'Zertifikat wird geprüft' : error ? 'Prüfung nicht abgeschlossen' : certificate ? 'Zertifikat bestätigt' : 'Zertifikat nicht gefunden'}</CardTitle></div>
            <CardDescription>{loading ? 'Wir gleichen die Zertifikats-ID mit den ausgestellten Zertifikaten ab.' : error ? error : certificate ? 'Dieses Zertifikat wurde von ForgeCommunity ausgestellt.' : 'Für diese ID ist kein gültiges Zertifikat hinterlegt. Bitte überprüfen Sie den Link oder die Zertifikats-ID.'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 p-6 pt-0 sm:p-8 sm:pt-0">
            {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Prüfung läuft…</p>}
            {error && <div role="alert"><Button variant="outline" onClick={() => setAttempt(value => value + 1)}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Erneut prüfen</Button></div>}
            {certificate && <dl className="divide-y divide-border rounded-xl border border-border px-4"><div className="py-4"><dt className="text-xs text-muted-foreground">Ausgestellt für</dt><dd className="mt-1 break-words text-lg font-semibold">{certificate.userName}</dd></div><div className="py-4"><dt className="text-xs text-muted-foreground">Abgeschlossener Kurs</dt><dd className="mt-1 break-words font-medium">{certificate.courseName}</dd></div><div className="grid gap-4 py-4 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Ausstellungsdatum</dt><dd className="mt-1 text-sm">{issueDate}</dd></div><div><dt className="text-xs text-muted-foreground">Zertifikats-ID</dt><dd className="mt-1 break-all font-mono text-xs">{certificate.id}</dd></div></div></dl>}
            {!loading && <Button asChild variant="outline"><Link href="/">Zur Startseite</Link></Button>}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
