import type { SVGProps } from 'react';

/** One small, original stroke family for the Skills workbench. */
export function SkillIcon({ name, ...props }: SVGProps<SVGSVGElement> & {
  name: 'people' | 'skills' | 'search' | 'plus' | 'edit' | 'remove' | 'arrow' | 'check' | 'up' | 'down' | 'learn';
}) {
  const paths = {
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
    skills: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="m4 7.5 8 5 8-5M12 12.5V21M8 5.2l8 5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    edit: <><path d="m15 5 4 4M4 20l5-1L20 8a2.8 2.8 0 0 0-4-4L5 15l-1 5Z" /></>,
    remove: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    check: <path d="m5 12 4 4L19 6" />,
    up: <path d="m6 15 6-6 6 6" />,
    down: <path d="m6 9 6 6 6-6" />,
    learn: <><path d="m3 8 9-4 9 4-9 4-9-4Zm4 2v6c3 3 7 3 10 0v-6M21 8v8" /></>,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{paths[name]}</svg>;
}
