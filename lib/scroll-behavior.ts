/** Read at scroll time so a changed OS preference applies to the next action. */
export function getPreferredScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'instant';

  // Unlike "auto", "instant" cannot inherit smooth scrolling from CSS.
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}
