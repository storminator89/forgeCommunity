import type { SVGProps } from 'react';

/** Original three-stop path mark for the learner's private next step. */
export function JourneyMark(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <path d="M11 37c3.2-8.6 14.1-3.8 17.4-12.7C31 17.2 37 18.6 38 11" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="10" cy="38" r="4" fill="hsl(var(--card))" stroke="currentColor" strokeWidth="2.5" />
    <circle cx="25" cy="27" r="4" fill="hsl(var(--card))" stroke="currentColor" strokeWidth="2.5" />
    <path d="m35 7 5 1-1 5-5-1z" fill="hsl(var(--card))" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
  </svg>;
}
