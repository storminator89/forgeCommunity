import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Shared discovery header. Actions keep their own permissions and handlers. */
export function HeroBanner({ title, description, icon: Icon, action, children, className }: {
  title: string; description: string; icon?: LucideIcon; action?: ReactNode;
  children?: ReactNode; className?: string;
}) {
  return <section className={cn('fc-hero', className)} aria-label={title}>
    {Icon && <div className="fc-hero-icon"><Icon aria-hidden="true" /></div>}
    <div className="fc-hero-copy"><h2>{title}</h2><p>{description}</p></div>
    {action && <div className="fc-hero-action">{action}</div>}
    {children}
  </section>;
}

export function PageContainer({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('fc-page-container', className)} {...props} />;
}

export function SurfaceCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('fc-surface', className)} {...props} />;
}

/** Original vector landscape, decorative and independent of community data. */
export function CommunityLandscape() {
  return <svg className="fc-community-landscape" viewBox="0 0 580 260" fill="none" aria-hidden="true" focusable="false">
    <circle cx="493" cy="54" r="32" className="landscape-sun" />
    <path d="M0 193 104 112 154 144 283 37 357 114 402 91 580 172V260H0Z" className="landscape-far" />
    <path d="m283 37-48 71 34-15 17 14 18-18 25 15Z" className="landscape-snow" />
    <path d="M0 207 99 163 168 186 303 122 383 163 476 123 580 177V260H0Z" className="landscape-middle" />
    <path d="M0 247c98-86 159-15 251-47 117-42 166-21 329-6v66H0Z" className="landscape-near" />
    <path d="M348 260c40-42 87-46 116-64-4 27-46 40-42 64" className="landscape-trail" />
    {[40, 87, 132, 187, 240, 309, 453, 526, 561].map((x, i) => <g key={x} transform={`translate(${x} ${195 + (i % 3) * 17}) scale(${.65 + (i % 3) * .18})`} className="landscape-tree"><path d="m0-47-14 24h8L-21-1h15L-26 23h52L6-1h15L6-23h8Z" /><path d="M-2 15h4v25h-4z" /></g>)}
    <g transform="translate(480 145)"><path d="m-12 34-4 37m18-37 8 37" className="landscape-hiker" strokeWidth="8" strokeLinecap="round" /><path d="m-9 9-12 29m21-27 12 21" className="landscape-hiker" strokeWidth="6" strokeLinecap="round" /><rect x="-17" y="3" width="22" height="37" rx="8" className="landscape-pack" /><circle cx="-7" cy="-7" r="9" className="landscape-hiker-fill" /><path d="m16 31 5 42" className="landscape-hiker" strokeWidth="2" /></g>
  </svg>;
}
