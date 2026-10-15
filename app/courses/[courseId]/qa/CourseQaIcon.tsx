import type { SVGProps } from 'react'

/** A small conversation mark for this course utility, intentionally free of gamification cues. */
export function CourseQaIcon(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-5a7.5 7.5 0 0 1-1-4.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z" />
    <path d="M8 10h8M8 13.5h5" />
  </svg>
}
