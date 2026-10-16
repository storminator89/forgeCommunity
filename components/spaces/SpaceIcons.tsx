import type { SVGProps } from 'react';

// Small, original outline marks. The adjacent words carry the meaning.
export function SpaceGlobeIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <circle cx="10" cy="10" r="7.25" /><path d="M2.9 10h14.2M10 2.75c-2 2-3 4.4-3 7.25s1 5.25 3 7.25c2-2 3-4.4 3-7.25s-1-5.25-3-7.25Z" />
  </svg>;
}
export function SpaceLockIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <rect x="4.4" y="8.6" width="11.2" height="8.3" rx="1.6" /><path d="M6.7 8.6V6.5a3.3 3.3 0 0 1 6.6 0v2.1M10 12v1.5" />
  </svg>;
}
