import type { ReactNode } from 'react';

export function PageIntro({ eyebrow, title, description, children }: {
  eyebrow: string; title: string; description: string; children?: ReactNode;
}) {
  return (
    <section className="page-intro">
      <div className="min-w-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </section>
  );
}
