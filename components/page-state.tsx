import type { ReactNode } from 'react';
import { Search, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PageState({ kind = 'empty', title, description, action }: {
  kind?: 'empty' | 'loading' | 'error'; title: string; description?: string; action?: ReactNode;
}) {
  const Icon = kind === 'loading' ? Loader2 : kind === 'error' ? TriangleAlert : Search;
  return (
    <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center"
      role={kind === 'error' ? 'alert' : 'status'} aria-live="polite">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-primary">
        <Icon className={`h-5 w-5 ${kind === 'loading' ? 'animate-spin' : ''}`} />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description && <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function LoadingScreen() {
  return <div className="mx-auto flex min-h-dvh max-w-lg items-center px-6"><div className="w-full">
    <PageState kind="loading" title="Inhalte werden geladen" description="Einen Moment, wir bereiten alles für dich vor." />
  </div></div>;
}

export function RetryButton({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" onClick={onClick}>Erneut versuchen</Button>;
}
