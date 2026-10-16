'use client';

import { useId, useState, type FormEvent } from 'react';
import { Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { reportReasons, type ReportReason, type ReportTargetType } from '@/lib/reporting';

export function ReportControl({ targetType, targetId, request }: {
  targetType: ReportTargetType | 'SPACE_DISCUSSION' | 'SPACE_REPLY' | 'SPACE_MISSION_CONTRIBUTION';
  targetId: string;
  request?: <T>(path: string, init?: RequestInit) => Promise<T>;
}) {
  const reasonId = useId();
  const detailsId = useId();
  const targetLabel = targetType === 'POST' ? 'Beitrag' : targetType === 'COMMENT' ? 'Kommentar' : targetType === 'SPACE_DISCUSSION' ? 'Space-Diskussion' : targetType === 'SPACE_MISSION_CONTRIBUTION' ? 'Missionsbeitrag' : 'Space-Antwort';
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('SPAM');
  const [details, setDetails] = useState('');
  const [pending, setPending] = useState(false);
  const [reported, setReported] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const init = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, reason, details }),
      };
      let body: { alreadyReported?: boolean };
      if (request) body = await request('/api/reports', init);
      else {
        const response = await fetch('/api/reports', init);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Meldung fehlgeschlagen');
        body = result;
      }
      setReported(true);
      setFeedback(body.alreadyReported ? 'Dieser Inhalt wurde bereits von dir gemeldet.' : 'Danke. Deine Meldung wurde gespeichert.');
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Meldung fehlgeschlagen');
    } finally {
      setPending(false);
    }
  }

  return <div>
    <Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) setError(''); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={reported} aria-label={`${targetLabel} melden`}>
          <Flag className="mr-1 h-4 w-4" aria-hidden="true" />
          {reported ? 'Gemeldet' : 'Melden'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{targetLabel} melden</DialogTitle>
          <DialogDescription>
            {targetType === 'SPACE_MISSION_CONTRIBUTION' ? 'Wähle einen Grund. Deinen Hinweis und den Missionsbeitrag können nur Admins dieses privaten Spaces prüfen.' : 'Wähle einen Grund. Dein Hinweis wird nur vom Moderationsteam gelesen.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor={reasonId} className="text-sm font-medium">Grund</label>
            <select id={reasonId} value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3 text-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
              {reportReasons.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label htmlFor={detailsId} className="text-sm font-medium">Hinweis {reason === 'OTHER' ? '(erforderlich)' : '(optional)'}</label>
            <Textarea id={detailsId} value={details} onChange={(event) => setDetails(event.target.value)}
              required={reason === 'OTHER'} minLength={reason === 'OTHER' ? 5 : undefined} maxLength={500}
              placeholder="Beschreibe kurz, was geprüft werden sollte." />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Abbrechen</Button>
            <Button type="submit" disabled={pending}>{pending ? 'Wird gesendet…' : 'Meldung senden'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    {feedback && <p role="status" className="mt-1 text-xs text-muted-foreground">{feedback}</p>}
  </div>;
}
