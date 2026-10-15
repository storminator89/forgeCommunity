"use client";

/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 */
/* Hallmark · genre: document verification · macrostructure: verification status and record · design-system: design.md · designed-as-app */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, BadgeCheck, CircleAlert, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';

interface Certificate {
  id: string;
  userName: string;
  courseName: string;
  issuedAt: string;
}
interface VerificationResponse {
  valid: boolean;
  certificate?: Certificate;
}

function isCertificate(value: unknown): value is Certificate {
  if (!value || typeof value !== 'object') return false;
  const certificate = value as Record<string, unknown>;
  return typeof certificate.id === 'string' && certificate.id.length > 0
    && typeof certificate.userName === 'string' && certificate.userName.length > 0
    && typeof certificate.courseName === 'string' && certificate.courseName.length > 0
    && typeof certificate.issuedAt === 'string' && !Number.isNaN(Date.parse(certificate.issuedAt));
}

export default function VerifyCertificate() {
  const { certificateId } = useParams<{ certificateId: string }>();
  const [outcome, setOutcome] = useState<{ key: string; result?: VerificationResponse; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestKey = `${certificateId}:${attempt}`;
  const loading = outcome?.key !== requestKey;
  const result = loading ? null : outcome?.result;
  const error = loading ? null : outcome?.error;
  const certificate = result?.valid ? result.certificate : undefined;

  useEffect(() => {
    const controller = new AbortController();
    const key = `${certificateId}:${attempt}`;
    const verify = async () => {
      try {
        if (!certificateId) throw new Error('Die Zertifikats-ID fehlt.');
        const response = await fetch(`/api/verify-certificate/${encodeURIComponent(certificateId)}`, { signal: controller.signal });
        if (response.status === 404) { if (!controller.signal.aborted) setOutcome({ key, result: { valid: false } }); return; }
        if (!response.ok) throw new Error('Die Prüfung ist momentan nicht möglich. Bitte versuche es erneut.');
        const data = await response.json() as VerificationResponse;
        if (typeof data.valid !== 'boolean' || (data.valid && (!isCertificate(data.certificate) || data.certificate.id !== certificateId))) throw new Error('Die Antwort konnte nicht gelesen werden. Bitte versuche es erneut.');
        if (!controller.signal.aborted) setOutcome({ key, result: data });
      } catch (failure) {
        if (!controller.signal.aborted) setOutcome({ key, error: failure instanceof Error ? failure.message : 'Die Prüfung ist momentan nicht möglich.' });
      }
    };
    void verify();
    return () => controller.abort();
  }, [certificateId, attempt]);

  const title = loading ? 'Zertifikat wird geprüft' : error ? 'Prüfung nicht abgeschlossen' : certificate ? 'Zertifikat bestätigt' : 'Zertifikat nicht gefunden';
  const description = loading ? 'Die Zertifikats-ID wird mit den ausgestellten Zertifikaten abgeglichen.' : error ? error : certificate ? 'Dieses Zertifikat wurde von ForgeCommunity ausgestellt.' : 'Für diese ID ist kein gültiges Zertifikat hinterlegt. Prüfe den Link oder die Zertifikats-ID.';

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <a href="#page-content" className="skip-link">Zum Inhalt springen</a>
      <header className="border-b"><div className="mx-auto flex min-h-20 w-full max-w-[1200px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"><Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><ArrowLeft className="h-4 w-4" aria-hidden="true" />ForgeCommunity</Link><ThemeToggle /></div></header>
      <main id="page-content" tabIndex={-1} className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6 sm:py-16 lg:px-8">
        <div className="max-w-3xl border-t pt-7">
          <span className={'flex h-12 w-12 items-center justify-center rounded-[10px] ' + (error || (!loading && !certificate) ? 'bg-destructive/10 text-destructive' : 'bg-accent text-primary')}>{certificate ? <BadgeCheck className="h-6 w-6" aria-hidden="true" /> : error || result ? <CircleAlert className="h-6 w-6" aria-hidden="true" /> : <ShieldCheck className="h-6 w-6" aria-hidden="true" />}</span>
          <p className="mt-6 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Zertifikatsprüfung</p>
          <h1 className="mt-2 break-words text-[clamp(2rem,1.3rem+2vw,3rem)] font-semibold tracking-tight [overflow-wrap:anywhere]">{title}</h1>
          <p className="mt-3 max-w-[60ch] text-base leading-relaxed text-muted-foreground">{description}</p>
          {loading && <p role="status" className="mt-7 inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Prüfung läuft…</p>}
          {error && <div role="alert" className="mt-7"><Button type="button" variant="outline" onClick={() => setAttempt(value => value + 1)}>Erneut prüfen</Button></div>}
          {!loading && !error && !certificate && <p role="status" className="mt-7 border-l-2 border-destructive pl-4 text-sm font-medium">Keine gültige Zertifikats-ID gefunden.</p>}
          {certificate && <section aria-labelledby="certificate-details-title" className="mt-9 border-t pt-6"><h2 id="certificate-details-title" className="text-xl font-semibold tracking-tight">Angaben zum Zertifikat</h2><p role="status" className="mt-2 text-sm font-medium">Gültiges Zertifikat</p><dl className="mt-5 divide-y border-y"><div className="py-4"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ausgestellt für</dt><dd className="mt-2 break-words text-lg font-semibold [overflow-wrap:anywhere]">{certificate.userName}</dd></div><div className="py-4"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Abgeschlossener Kurs</dt><dd className="mt-2 break-words font-medium [overflow-wrap:anywhere]">{certificate.courseName}</dd></div><div className="grid gap-5 py-4 sm:grid-cols-2"><div><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ausstellungsdatum</dt><dd className="mt-2 text-sm"><time dateTime={certificate.issuedAt}>{new Date(certificate.issuedAt).toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' })}</time></dd></div><div className="min-w-0"><dt className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Zertifikats-ID</dt><dd className="mt-2 break-all font-mono text-sm">{certificate.id}</dd></div></div></dl></section>}
          {!loading && <div className="mt-9"><Button asChild variant="outline"><Link href="/">Zur Startseite</Link></Button></div>}
        </div>
      </main>
    </div>
  );
}
