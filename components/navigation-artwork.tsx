import type { CSSProperties, ReactNode } from 'react';
import { navigationArtworkSource } from '@/lib/navigation-artwork';
import { cn } from '@/lib/utils';

/** Generated outline artwork uses alpha masks so it follows the text color in both themes. */
export function NavigationArtwork({ href, fallback, className }: { href: string; fallback?: ReactNode; className?: string }) {
  const src = navigationArtworkSource(href);
  if (!src) return fallback ?? null;

  return <span aria-hidden="true" data-navigation-icon={src}
    className={cn('fc-navigation-icon', className)}
    style={{ '--navigation-icon': `url("${src}")` } as CSSProperties} />;
}
