'use client';

import { useRef, useState } from 'react';
import { Award, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CourseProgressState, courseRequestError } from '../hooks/useCourseProgress';

interface CourseProgressProps {
  progress: CourseProgressState | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  courseId: string;
  courseName: string;
}

export function CourseProgress({ progress, isLoading, error, onRetry, courseId, courseName }: CourseProgressProps) {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloading = useRef(false);

  const downloadCertificate = async () => {
    if (downloading.current || (!progress?.certificate && !progress?.enrollment.completedAt)) return;
    downloading.current = true;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const response = progress.certificate
        ? await fetch(`/api/certificates/${progress.certificate.id}/download`)
        : await fetch(`/api/courses/${courseId}/certificate`, { method: 'POST' });
      if (!response.ok) throw await courseRequestError(response, 'Zertifikat konnte nicht heruntergeladen werden. Bitte erneut versuchen.');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${courseName.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '_')}_Zertifikat.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);
      if (!progress.certificate) onRetry();
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : 'Zertifikat konnte nicht heruntergeladen werden.');
    } finally {
      downloading.current = false;
      setIsDownloading(false);
    }
  };

  return (
    <section className="space-y-3 p-4 border-t border-border bg-background/95" aria-label="Kursfortschritt">
      <h3 className="font-semibold text-sm">Kursfortschritt</h3>
      {isLoading && <p className="text-sm text-muted-foreground" role="status">Fortschritt wird geladen...</p>}
      {error && <div role="alert" className="text-sm text-destructive space-y-2"><p>{error}</p><Button size="sm" variant="outline" onClick={onRetry} disabled={isLoading}>Erneut laden</Button></div>}
      {progress && <>
        {progress.enrollment.completedAt ? (
          <p className="flex items-center gap-2 text-sm text-green-600"><CheckCircle2 className="h-4 w-4" />Kurs abgeschlossen</p>
        ) : (
          <>
            <div className="flex justify-between gap-2 text-xs"><span>{progress.completedCount} von {progress.requiredCount} Pflichtinhalten</span><span>{progress.percentage}%</span></div>
            <Progress value={progress.percentage} aria-label={`${progress.percentage}% abgeschlossen`} />
            <p className="text-xs text-muted-foreground">{progress.requiredCount === 0 ? 'Noch keine Pflichtinhalte vorhanden. Ein automatischer Abschluss ist noch nicht möglich.' : 'Markieren Sie bearbeitete Inhalte ausdrücklich als abgeschlossen. Nach allen Pflichtinhalten wird das Zertifikat automatisch ausgestellt.'}</p>
          </>
        )}
        <p className="text-xs text-muted-foreground">Der Abschluss dokumentiert die selbst bestätigte Bearbeitung, keine bestandene Prüfung.</p>
        {(progress.certificate || progress.enrollment.completedAt) ? <>
          {progress.certificate && <p className="text-xs text-muted-foreground">Zertifikat ausgestellt am {new Date(progress.certificate.issuedAt).toLocaleDateString('de-DE')}</p>}
          <Button className="w-full" disabled={isDownloading} onClick={downloadCertificate}>
            {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Award className="mr-2 h-4 w-4" />}
            {isDownloading ? 'Wird heruntergeladen...' : 'Zertifikat herunterladen'}
          </Button>
        </> : null}
      </>}
      {downloadError && <p role="alert" className="text-sm text-destructive">{downloadError}</p>}
    </section>
  );
}
