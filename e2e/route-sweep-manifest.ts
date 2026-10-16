/**
 * One entry per App Router page.tsx. The outcome describes what this browser
 * sweep actually checks, not whether the whole product flow is complete.
 *
 * `synthetic-api` means the real page renders with a response supplied by this
 * disposable browser test. It does not exercise storage or authorization of
 * that API. `disposable-db` uses only accounts created in the CI SQLite DB.
 */
export type RouteSweepCase = {
  source: `app/${string}/page.tsx` | 'app/page.tsx';
  url: string;
  persona: 'anonymous' | 'member' | 'moderator' | 'admin';
  outcome: 'render' | 'redirect';
  heading?: string;
  redirectTo?: string;
  evidence: 'static' | 'account-empty-disposable-db' | 'shared-disposable-db' | 'disposable-db' | 'synthetic-api' | 'redirect-only';
  settledText?: string;
  settledApi?: string;
  loadingText?: string;
};

export const routeSweepCases: readonly RouteSweepCase[] = [
  { source: 'app/page.tsx', url: '/', persona: 'anonymous', outcome: 'render', heading: 'Wissen teilen. Projekte weiterbringen.', evidence: 'static' },
  { source: 'app/about/page.tsx', url: '/about', persona: 'member', outcome: 'render', heading: 'Gemeinsam lernen und Ideen weiterbringen.', evidence: 'static' },
  { source: 'app/admin/dashboard/page.tsx', url: '/admin/dashboard', persona: 'admin', outcome: 'render', heading: 'Dashboard', evidence: 'shared-disposable-db', settledApi: '/api/admin/dashboard-stats', loadingText: 'Wird geladen' },
  { source: 'app/admin/learning-pathways/page.tsx', url: '/admin/learning-pathways', persona: 'admin', outcome: 'render', heading: 'Lernpfade verwalten', evidence: 'shared-disposable-db', settledApi: '/api/admin/learning-pathways', loadingText: 'Lernpfade werden geladen', settledText: 'Bestehende Lernpfade' },
  { source: 'app/admin/users/page.tsx', url: '/admin/users', persona: 'admin', outcome: 'render', heading: 'Benutzerverwaltung', evidence: 'shared-disposable-db', settledApi: '/api/admin/users', loadingText: 'Benutzer werden geladen' },
  { source: 'app/chat/page.tsx', url: '/chat', persona: 'member', outcome: 'render', heading: 'Chat', evidence: 'shared-disposable-db', settledApi: '/api/chat/channels', loadingText: 'Chat wird geladen' },
  { source: 'app/community/page.tsx', url: '/community', persona: 'member', outcome: 'render', heading: 'Community', evidence: 'shared-disposable-db', settledApi: '/api/posts', loadingText: 'Beiträge werden geladen' },
  { source: 'app/community/missions/page.tsx', url: '/community/missions', persona: 'member', outcome: 'render', heading: 'Space-Missionen', evidence: 'disposable-db', settledApi: '/api/space-missions', settledText: 'Route QA overview mission', loadingText: 'Missionen werden geprüft' },
  { source: 'app/community/spaces/page.tsx', url: '/community/spaces', persona: 'member', outcome: 'render', heading: 'Spaces', evidence: 'disposable-db', settledApi: '/api/spaces', settledText: 'Route QA public space', loadingText: 'Spaces werden geladen' },
  { source: 'app/community/spaces/[spaceId]/page.tsx', url: '/community/spaces/:publicSpaceId', persona: 'member', outcome: 'render', heading: 'Route QA public space', evidence: 'disposable-db', settledApi: '/api/spaces/:publicSpaceId', settledText: 'Route QA discussion', loadingText: 'Space wird geladen' },
  { source: 'app/community/spaces/[spaceId]/discussions/[discussionId]/page.tsx', url: '/community/spaces/:publicSpaceId/discussions/:publicDiscussionId', persona: 'member', outcome: 'render', heading: 'Route QA discussion', evidence: 'disposable-db', settledApi: '/api/spaces/:publicSpaceId/discussions/:publicDiscussionId', settledText: 'Route QA discussion body.', loadingText: 'Diskussion wird geladen' },
  { source: 'app/community/spaces/[spaceId]/missions/[missionId]/page.tsx', url: '/community/spaces/qa-route-space/missions/qa-route-mission', persona: 'member', outcome: 'render', heading: 'Route QA teach-back', evidence: 'synthetic-api', settledApi: '/api/spaces/qa-route-space/missions/qa-route-mission', settledText: 'Noch keine sichtbaren Beiträge.', loadingText: 'Mission wird geladen' },
  { source: 'app/courses/[courseId]/contents/page.tsx', url: '/courses/qa-route-course/contents', persona: 'member', outcome: 'render', heading: 'Route QA course', evidence: 'synthetic-api', settledText: 'Noch keine Kursinhalte' },
  { source: 'app/courses/[courseId]/grading/page.tsx', url: '/courses/qa-route-course/grading', persona: 'member', outcome: 'render', heading: 'Aufgaben bewerten', evidence: 'synthetic-api', settledApi: '/api/courses/qa-route-course/assignments', settledText: 'Keine offenen Bewertungen' },
  { source: 'app/courses/[courseId]/analytics/page.tsx', url: '/courses/qa-route-course/analytics', persona: 'member', outcome: 'render', heading: 'Kursanalyse', evidence: 'synthetic-api', settledApi: '/api/courses/qa-route-course/analytics', settledText: 'Route QA learner', loadingText: 'Kursanalyse wird geladen' },
  { source: 'app/courses/[courseId]/practice/page.tsx', url: '/courses/qa-route-course/practice', persona: 'admin', outcome: 'render', heading: 'Formative Übungen', evidence: 'synthetic-api', settledApi: '/api/courses/qa-route-course/practice/authoring', settledText: 'Noch keine Lernziele', loadingText: 'Übungsdaten werden geladen' },
  { source: 'app/courses/[courseId]/practice/learn/page.tsx', url: '/courses/qa-route-course/practice/learn', persona: 'member', outcome: 'render', heading: 'Privat üben', evidence: 'synthetic-api', settledApi: '/api/courses/qa-route-course/practice/learner', settledText: 'Noch keine Übung veröffentlicht', loadingText: 'Übungen werden geladen' },
  { source: 'app/courses/[courseId]/qa/page.tsx', url: '/courses/qa-route-course/qa', persona: 'member', outcome: 'render', heading: 'Fragen zum Kurs', evidence: 'synthetic-api', settledApi: '/api/courses/qa-route-course/qa', settledText: 'Noch keine Fragen', loadingText: 'Fragen werden geladen' },
  { source: 'app/courses/[courseId]/page.tsx', url: '/courses/qa-route-course', persona: 'member', outcome: 'redirect', redirectTo: '/courses/qa-route-course/contents', evidence: 'redirect-only' },
  { source: 'app/courses/authoring/page.tsx', url: '/courses/authoring', persona: 'member', outcome: 'render', heading: 'Meine Kursentwürfe', evidence: 'account-empty-disposable-db', settledText: 'Noch keine Kursentwürfe' },
  { source: 'app/courses/goals/page.tsx', url: '/courses/goals', persona: 'member', outcome: 'render', heading: 'Mein Lernziel', evidence: 'account-empty-disposable-db', settledText: 'Privates Lernziel starten' },
  { source: 'app/courses/journey/page.tsx', url: '/courses/journey', persona: 'member', outcome: 'render', heading: 'Mein Lernweg', evidence: 'synthetic-api', settledApi: '/api/courses/qa-route-course/progress', loadingText: 'Lernschritte werden geprüft', settledText: 'Route QA offener Lernschritt' },
  { source: 'app/courses/new/page.tsx', url: '/courses/new', persona: 'member', outcome: 'render', heading: 'Neuen Kursentwurf anlegen', evidence: 'static' },
  { source: 'app/courses/pathways/[pathwayId]/page.tsx', url: '/courses/pathways/qa-route-pathway', persona: 'member', outcome: 'render', heading: 'Mein Lernpfad', evidence: 'synthetic-api', settledText: 'Route QA Lernpfad' },
  { source: 'app/courses/pathways/page.tsx', url: '/courses/pathways', persona: 'member', outcome: 'render', heading: 'Lernpfade', evidence: 'shared-disposable-db', settledApi: '/api/learning-pathways/me', loadingText: 'Lernpfade werden geladen', settledText: 'Verfügbare Lernpfade' },
  { source: 'app/courses/page.tsx', url: '/courses', persona: 'member', outcome: 'render', heading: 'Kurse', evidence: 'shared-disposable-db', settledApi: '/api/courses', loadingText: 'Kurse werden geladen' },
  { source: 'app/events/page.tsx', url: '/events', persona: 'member', outcome: 'render', heading: 'Events', evidence: 'shared-disposable-db', settledApi: '/api/events', loadingText: 'Events werden geladen' },
  { source: 'app/knowledgebase/[id]/edit/page.tsx', url: '/knowledgebase/qa-route-article/edit', persona: 'member', outcome: 'render', heading: 'Artikel bearbeiten', evidence: 'synthetic-api', settledText: 'Artikelinhalt' },
  { source: 'app/knowledgebase/[id]/page.tsx', url: '/knowledgebase/qa-route-article', persona: 'member', outcome: 'render', heading: 'Route QA article', evidence: 'synthetic-api' },
  { source: 'app/knowledgebase/drafts/page.tsx', url: '/knowledgebase/drafts', persona: 'member', outcome: 'render', heading: 'Entwürfe', evidence: 'account-empty-disposable-db', settledText: 'Keine Entwürfe vorhanden' },
  { source: 'app/knowledgebase/edit/[id]/page.tsx', url: '/knowledgebase/edit/qa-route-article', persona: 'member', outcome: 'render', heading: 'Entwurf bearbeiten', evidence: 'synthetic-api', settledText: 'Artikelinhalt' },
  { source: 'app/knowledgebase/new-article/page.tsx', url: '/knowledgebase/new-article', persona: 'member', outcome: 'render', heading: 'Neuer Artikel', evidence: 'static', settledText: 'Artikelinhalt' },
  { source: 'app/knowledgebase/page.tsx', url: '/knowledgebase', persona: 'member', outcome: 'render', heading: 'Wissensdatenbank', evidence: 'shared-disposable-db', settledApi: '/api/articles', loadingText: 'Artikel werden geladen' },
  { source: 'app/login/page.tsx', url: '/login', persona: 'anonymous', outcome: 'render', heading: 'Anmelden', evidence: 'static' },
  { source: 'app/logout/page.tsx', url: '/logout', persona: 'member', outcome: 'redirect', redirectTo: '/', evidence: 'redirect-only' },
  { source: 'app/members/page.tsx', url: '/members', persona: 'member', outcome: 'render', heading: 'Mitglieder', evidence: 'shared-disposable-db', settledApi: '/api/members', loadingText: 'Mitglieder werden geladen' },
  { source: 'app/moderation/page.tsx', url: '/moderation', persona: 'moderator', outcome: 'render', heading: 'Meldungen prüfen', evidence: 'shared-disposable-db', settledApi: '/api/reports', loadingText: 'Meldungen werden geladen' },
  { source: 'app/notifications/page.tsx', url: '/notifications', persona: 'member', outcome: 'render', heading: 'Benachrichtigungen', evidence: 'account-empty-disposable-db', settledText: 'Noch keine Benachrichtigungen' },
  { source: 'app/profile/[id]/page.tsx', url: '/profile/:memberId', persona: 'member', outcome: 'render', heading: 'Route QA Member', evidence: 'disposable-db' },
  { source: 'app/projects/[projectId]/page.tsx', url: '/projects/qa-route-project', persona: 'member', outcome: 'render', heading: 'Route QA project', evidence: 'synthetic-api' },
  { source: 'app/projects/new/page.tsx', url: '/projects/new', persona: 'member', outcome: 'render', heading: 'Neues Projekt', evidence: 'static', settledText: 'Projektdetails' },
  { source: 'app/register/page.tsx', url: '/register', persona: 'anonymous', outcome: 'render', heading: 'Konto erstellen', evidence: 'static' },
  { source: 'app/resources/[id]/page.tsx', url: '/resources/qa-route-resource', persona: 'anonymous', outcome: 'render', heading: 'Route QA resource', evidence: 'synthetic-api' },
  { source: 'app/resources/page.tsx', url: '/resources', persona: 'anonymous', outcome: 'render', heading: 'Ressourcen', evidence: 'shared-disposable-db', settledApi: '/api/resources', loadingText: 'Ressourcen werden geladen' },
  { source: 'app/search/page.tsx', url: '/search', persona: 'member', outcome: 'render', heading: 'Suche', evidence: 'static', settledText: 'Geben Sie einen Suchbegriff ein' },
  { source: 'app/settings/page.tsx', url: '/settings', persona: 'member', outcome: 'render', heading: 'Einstellungen', evidence: 'disposable-db', settledApi: '/api/user/profile', loadingText: 'Einstellungen werden geladen' },
  { source: 'app/showcases/page.tsx', url: '/showcases', persona: 'member', outcome: 'render', heading: 'Projekte', evidence: 'shared-disposable-db', settledApi: '/api/projects', loadingText: 'Projekte werden geladen' },
  { source: 'app/skills/page.tsx', url: '/skills', persona: 'member', outcome: 'render', heading: 'Skill-Verzeichnis', evidence: 'shared-disposable-db', settledApi: '/api/skills/directory', loadingText: 'Skill-Verzeichnis wird geladen' },
  { source: 'app/verify-certificate/[certificateId]/page.tsx', url: '/verify-certificate/qa-route-certificate', persona: 'anonymous', outcome: 'render', heading: 'Zertifikat bestätigt', evidence: 'synthetic-api', settledText: 'Gültiges Zertifikat' },
];
