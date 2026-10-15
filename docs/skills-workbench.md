# Skills workbench

The Skills section has two addressable views:

- `/skills`: people discovery, taxonomy/category filters, real catalog member counts, profile/detail links and existing member recommendations
- `/skills?view=mine`: the authenticated account's skills, exact integer 0–100 self-assessments, add/create/edit and confirmed removal

Search remains shareable through `query`. Native history preserves unrelated URL parameters, Back/Forward and the existing global-search handoff. Tab navigation also works by keyboard. The default member order is alphabetical; the existing recommendation sorting remains available.

## Existing routes and data contracts

| Surface | Contract |
| --- | --- |
| `/settings?tab=skills` | Existing editor remains available and links back to the workbench |
| `/profile/[id]` | Existing profile and editing handoff remain; skill levels are explicitly labelled as self-assessments |
| `/search` | Existing taxonomy results link to `/skills?query=…` |
| `GET/POST /api/skills` | Authenticated shared taxonomy; no invented verification status |
| `GET /api/skills/directory` | Authenticated minimal directory projection with viewer-specific recommendation flags |
| `GET/POST /api/user/skills` | Current-account reads and attachments; caller-supplied account IDs cannot redirect writes |
| `PUT/DELETE /api/user/skills/[id]` | Owner-scoped row ID and taxonomy ID aliases remain compatible |
| `PUT /api/users/[id]/profile` | Existing profile reconciliation remains unchanged |
| `PATCH /api/users/[id]` | Existing skill endorsement workflow remains unchanged |
| `POST /api/members/[id]/endorse` | Existing member recommendation workflow remains unchanged |
| `/courses`, `/courses/pathways`, `/settings?tab=certificates` | Links to existing learning and certificate features; no automatic skill-to-course or certification claim |

No schema, migration, learning-credit, certificate or endorsement models change. Editing preserves the original UserSkill row and its endorsements. Removing a skill explicitly warns that its skill endorsements are removed too. Empty catalog entries remain discoverable with an honest zero-member count.

## Interaction and safety

- Community skill search and category must match the same skill. A separate skill on the same member cannot satisfy a contradictory category filter.
- Own reads use a minimal projection and `private, no-store` caching.
- Account boundaries remount private forms and abort old reads/mutations. Late responses cannot publish old-account results or success callbacks.
- Saves are single-flight. Failed attachment after catalog creation reuses the created catalog item on retry.
- A successful write followed by a failed list refresh closes the editor and offers a read retry, avoiding duplicate writes.
- Cancel/Escape writes nothing. Dialogs restore focus to the initiating control, or the add button after its row is removed.
- New visual controls use an original stroke-based SVG family and the repository's existing paper/ink semantic tokens. No additional design package or dependency is introduced.

## Verification

Focused Jest suites cover the workbench, directory search/history, actual disposable-SQLite ownership across USER/ADMIN/INSTRUCTOR roles, alias compatibility, row/endorsement preservation, validation, duplicate constraints, refresh failures and account-switch races. Existing profile, settings and global-search suites remain regression coverage.

`e2e/skills-workbench.pw.ts` exercises real rendered pages and the existing server endpoints: register/login in the guarded disposable database, keyboard tab navigation, create → edit → reload → profile → settings handoff → cancel/remove. It records light/dark own-skills views plus the community view in the existing desktop, 320px and 390px Chromium projects. It checks control bounds, document overflow and dialog focus. The existing CI browser job discovers the file and uploads its screenshots without workflow changes.

Browser screenshots are evidence only after that journey actually runs; merely listing the test or passing component tests does not establish rendered-browser success.
