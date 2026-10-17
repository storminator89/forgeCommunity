# Abdeckung aller Seiten

Alle 49 `page.tsx`-Routen sind erfasst: 47 gerenderte Ansichten und zwei Weiterleitungen. Wrapper verwenden die unten aufgeführten, direkt angepassten Darstellungskomponenten. Das ursprüngliche Logo bleibt erhalten.

| Route | Umsetzung | Geänderte Darstellung |
| --- | --- | --- |
| `/` | Gestaltung angepasst | `app/home.module.css` |
| `/about` | Gestaltung angepasst | `app/about/page.tsx` |
| `/admin/dashboard` | Gestaltung angepasst | `app/admin/dashboard/page.tsx` |
| `/admin/learning-pathways` | Gestaltung angepasst | `app/admin/learning-pathways/LearningPathwaysAdmin.tsx`, `components/admin/AdminShell.tsx` |
| `/admin/users` | Gestaltung angepasst | `components/admin/UserManagement.tsx`, `components/admin/AdminShell.tsx` |
| `/chat` | Gestaltung angepasst | `app/chat/page.tsx` |
| `/community` | Gestaltung angepasst | `app/community/page.tsx` |
| `/community/missions` | Gestaltung angepasst | `components/spaces/friendly-missions.module.css`, `components/spaces/SpaceShell.tsx` |
| `/community/spaces` | Gestaltung angepasst | `app/community/spaces/page.tsx` |
| `/community/spaces/:publicSpaceId` | Gestaltung angepasst | `app/community/spaces/[spaceId]/page.tsx` |
| `/community/spaces/:publicSpaceId/discussions/:publicDiscussionId` | Gestaltung angepasst | `app/community/spaces/[spaceId]/discussions/[discussionId]/page.tsx` |
| `/community/spaces/qa-route-space/missions/qa-route-mission` | Gestaltung angepasst | `components/spaces/SpaceMissionDetail.tsx`, `components/spaces/friendly-missions.module.css` |
| `/courses/qa-route-course/contents` | Gestaltung angepasst | `app/courses/[courseId]/contents/CourseWorkspaceRoute.tsx`, `app/courses/[courseId]/contents/CourseContentsEditor.tsx`, `app/courses/[courseId]/contents/CourseDraftWorkspace.tsx`, `app/courses/[courseId]/contents/InstructorCoursePreview.tsx` |
| `/courses/qa-route-course/grading` | Gestaltung angepasst | `app/courses/[courseId]/grading/GradingClient.tsx` |
| `/courses/qa-route-course/analytics` | Gestaltung angepasst | `app/courses/[courseId]/analytics/CourseAnalytics.tsx` |
| `/courses/qa-route-course/practice` | Gestaltung angepasst | `app/courses/[courseId]/practice/PracticeAuthorWorkspace.tsx` |
| `/courses/qa-route-course/practice/learn` | Gestaltung angepasst | `app/courses/[courseId]/practice/learn/PracticeLearnerView.tsx` |
| `/courses/qa-route-course/qa` | Gestaltung angepasst | `app/courses/[courseId]/qa/CourseQaWorkspace.tsx` |
| `/courses/qa-route-course` | Weiterleitung zu `/courses/qa-route-course/contents` | Zielansicht geprüft |
| `/courses/authoring` | Gestaltung angepasst | `app/courses/authoring/page.tsx` |
| `/courses/goals` | Gestaltung angepasst | `app/courses/goals/CourseGoalsClient.tsx` |
| `/courses/journey` | Gestaltung angepasst | `app/courses/journey/JourneyClient.tsx` |
| `/courses/new` | Gestaltung angepasst | `app/courses/new/page.tsx` |
| `/courses/pathways/qa-route-pathway` | Gestaltung angepasst | `app/courses/pathways/PathwaysClient.tsx` |
| `/courses/pathways` | Gestaltung angepasst | `app/courses/pathways/PathwaysClient.tsx` |
| `/courses` | Gestaltung angepasst | `app/courses/CourseClient.tsx` |
| `/events` | Gestaltung angepasst | `app/events/page.tsx` |
| `/knowledgebase/qa-route-article/edit` | Gestaltung angepasst | `app/knowledgebase/[id]/edit/page.tsx` |
| `/knowledgebase/qa-route-article` | Gestaltung angepasst | `app/knowledgebase/[id]/page.tsx` |
| `/knowledgebase/drafts` | Gestaltung angepasst | `app/knowledgebase/drafts/page.tsx` |
| `/knowledgebase/edit/qa-route-article` | Gestaltung angepasst | `app/knowledgebase/edit/[id]/page.tsx` |
| `/knowledgebase/new-article` | Gestaltung angepasst | `app/knowledgebase/new-article/page.tsx` |
| `/knowledgebase` | Gestaltung angepasst | `app/knowledgebase/page.tsx` |
| `/login` | Gestaltung angepasst | `app/login/page.tsx` |
| `/logout` | Weiterleitung zu `/` | Zielansicht geprüft |
| `/members` | Gestaltung angepasst | `app/members/page.tsx` |
| `/moderation` | Gestaltung angepasst | `app/moderation/ModerationQueue.tsx` |
| `/notifications` | Gestaltung angepasst | `app/notifications/page.tsx` |
| `/profile/:memberId` | Gestaltung angepasst | `app/profile/[id]/page.tsx` |
| `/projects/qa-route-project` | Gestaltung angepasst | `app/projects/[projectId]/page.tsx` |
| `/projects/new` | Gestaltung angepasst | `app/projects/new/page.tsx` |
| `/register` | Gestaltung angepasst | `app/register/page.tsx` |
| `/resources/qa-route-resource` | Gestaltung angepasst | `app/resources/[id]/page.tsx` |
| `/resources` | Gestaltung angepasst | `app/resources/page.tsx` |
| `/search` | Gestaltung angepasst | `app/search/SearchPageClient.tsx` |
| `/settings` | Gestaltung angepasst | `app/settings/page.tsx` |
| `/showcases` | Gestaltung angepasst | `app/showcases/page.tsx` |
| `/skills` | Gestaltung angepasst | `app/skills/page.tsx` |
| `/verify-certificate/qa-route-certificate` | Gestaltung angepasst | `app/verify-certificate/[certificateId]/page.tsx` |

Die Browserprüfung nutzt ausschließlich eine getrennte SQLite-Testdatenbank sowie gekennzeichnete synthetische Antworten für einzelne Inhaltsansichten. Gefüllte und leere Zustände decken unterschiedliche Datenpfade ab; dies ist kein vollständiger Test aller fachlichen Workflows.
