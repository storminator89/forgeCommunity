/** Original generated monochrome outline artwork for navigation only. This registry never adds routes. */
export const navigationArtwork = {
  '/community': 'community',
  '/members': 'members',
  '/showcases': 'projects',
  '/projects': 'projects',
  '/events': 'events',
  '/courses': 'courses',
  '/courses/pathways': 'pathways',
  '/knowledgebase': 'knowledge',
  '/resources': 'resources',
  '/skills': 'skills',
  '/community/missions': 'missions',
  '/knowledgebase/drafts': 'drafts',
  '/chat': 'chat',
  '/notifications': 'notifications',
  '/search': 'search',
  '/settings': 'settings',
  '/about': 'about',
  '/admin/dashboard': 'dashboard',
  '/admin/users': 'user-management',
  '/admin/learning-pathways': 'pathways',
  '/moderation': 'moderation',
  // Prepared for the separate saved/unread features; no navigation is added here.
  '/community/saved': 'saved',
  '/community/unread': 'notifications',
} as const;

export function navigationArtworkSource(href: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(navigationArtwork, href)) return undefined;
  const artwork = navigationArtwork[href as keyof typeof navigationArtwork];
  return artwork ? `/images/navigation/outline-v2/${artwork}.webp` : undefined;
}
