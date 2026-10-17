import Image from 'next/image';
import type { ReactNode } from 'react';
import { navigationArtworkSource } from '@/lib/navigation-artwork';

/** Labels remain on their links/buttons; generated artwork is decorative. */
export function NavigationArtwork({ href, fallback }: { href: string; fallback?: ReactNode }) {
  const src = navigationArtworkSource(href);
  if (!src) return fallback ?? null;

  return <Image src={src} width={28} height={28} alt="" aria-hidden="true"
    className="h-7 w-7 shrink-0 object-contain" draggable={false} unoptimized />;
}
