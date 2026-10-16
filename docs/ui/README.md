# App screenshot provenance

All PNGs in this README gallery show actual ForgeCommunity rendering without
image generation, API-response substitution, compositing, hidden/rewritten UI,
or added browser/phone chrome. Selected files were copied byte-for-byte from
their named GitHub Actions artifacts and inspected at original dimensions.
All authenticated content is disposable synthetic test data. A browser journey
can set up database fixtures directly; the soft-week fixture is disclosed below.

## Current Space captures

- Capture date: 16 October 2026
- PR head: [`0a8cead91c7f24609236bd516a61722d22472001`](https://github.com/storminator89/forgeCommunity/commit/0a8cead91c7f24609236bd516a61722d22472001), source tree `9ea80641be9e08520675503971124e76aeee0770`
- CI checkout: [`0596795d17ddbd3018737519c7072c1540b9397b`](https://github.com/storminator89/forgeCommunity/commit/0596795d17ddbd3018737519c7072c1540b9397b), the PR merge ref recorded in the browser-job checkout log, with the same Git tree as the PR head and merged main
- Merged main: [`38a0826458387056ea079d46797b3be4b7a36b96`](https://github.com/storminator89/forgeCommunity/commit/38a0826458387056ea079d46797b3be4b7a36b96), with the same source tree as the PR head
- Workflow: [exact-head PR run 38871008041](https://github.com/storminator89/forgeCommunity/actions/runs/38871008041), **all seven jobs passed**. The browser job completed separate desktop/320px/390px Chromium invocations and four Firefox/WebKit critical journeys. The PostgreSQL release job completed the mission, poll and waitlist API contracts.
- Artifact: [`browser-qa-38871008041-1`, ID 12033810360](https://github.com/storminator89/forgeCommunity/actions/runs/38871008041/artifacts/12033810360), archive SHA-256 `853f2b8cd14131f529f4a9ab90e1285a3d519f4283277e79dda092ccdef7c259`

The artifact paths below include the per-project output directory.

| Repository image | Artifact path | Viewport / PNG dimensions | State |
| --- | --- | --- | --- |
| `readme/space-learning-week-form-light-768.png` | `desktop-chromium/cooperative-space-missions-351b2-ate-in-a-real-private-Space-desktop-chromium/mission-week-form-Hell-768.png` | 768×900 / 768×900 | Scrolled admin creation form, optional current Monday/week and Europe/Berlin zone selected; submit is below the fold |
| `readme/space-mission-light-768.png` | `desktop-chromium/cooperative-space-missions-351b2-ate-in-a-real-private-Space-desktop-chromium/mission-Hell-768.png` | 768×900 / 768×900 | Joined learner, soft week ended but mission open, two current insights and one valid cross-person build-on; lower detail is below the fold |
| `readme/space-mission-dark-320.png` | `desktop-chromium/cooperative-space-missions-351b2-ate-in-a-real-private-Space-desktop-chromium/mission-Dunkel-320.png` | 320×900 / 320×900 | Same mission in dark mode, top viewport; the long fixture title wraps and contribution controls are lower down |
| `readme/space-poll-light-768.png` | `desktop-chromium/space-polls.pw.ts-members--f283b-ose-and-lose-revoked-access-desktop-chromium/poll-Hell-768.png` | 768×900 / 768×900 | Private-Space member's changed choice and option totals; lower action controls are outside this viewport |

SHA-256 of the four new committed PNGs:

```text
405888aace2b4b164dbc8f70d392b3c1966db5677cc8f56b4287328c47de1342  readme/space-learning-week-form-light-768.png
77fea2b33a2778d220264d13153ed79bc10ff45724d7466a8c8f320471d188c2  readme/space-mission-light-768.png
ec5da3c772545eba1dd6c07b3b7a3324c2db26fd567da893df87ef4f34a4b2ab  readme/space-mission-dark-320.png
8dd7775b1e51f62a34983cd4173d806aec5c5f552b787476892dd7f151d1a9bd  readme/space-poll-light-768.png
```

The [mission journey](../../e2e/cooperative-space-missions.pw.ts) registers
synthetic accounts, promotes its synthetic admin directly in the guarded
SQLite fixture, and creates the private Space and mission through real APIs/UI.
The administrator creates the current week through the actual form. After two
real participant insights, the test directly moves that disposable mission's
immutable stored window back one week, then reloads and submits the cross-person
build-on through the real UI. This deliberate fixture enables an ended-week
state without waiting a week. **Production has no schedule-edit or time-travel
control.** The visible cooperation total includes the late build-on; it is not
a claim of on-time participation or measured learning.

The [poll journey](../../e2e/space-polls.pw.ts) creates a private Space and poll,
then casts/changes two members' choices through the real app. The displayed
options, totals and caller's saved choice come from its actual server responses.
No voter identities are projected. Small-group choices can still be inferred;
the visible privacy notice is preserved. Long questions/titles and short random
Space-name suffixes are intentional synthetic reflow fixtures.

The separate [post-merge main run 38872143016](https://github.com/storminator89/forgeCommunity/actions/runs/38872143016)
also passed all seven jobs on 16 October. It is additional integration evidence;
these PNGs still come from the PR artifact above.

The public `readme/landing-desktop-light.png` was also retrieved and checked
from `desktop-chromium/browser-qa.pw.ts-landing-a-79ba0--work-on-desktop-and-mobile-desktop-chromium/landing.png`
in this artifact. Its 1280×1471 bytes/hash are identical to the historical
landing image recorded below, so no duplicate PNG was added. The source
viewport was 1280×800 and the capture covers the full document.

The selected new pixels show synthetic names and content, with no email,
password, token, real member record, or production activity. They preserve
actual focus outlines, scroll positions and viewport clipping. Mission/poll
journeys check 320/375/414/768px light/dark reflow and 200% CSS zoom, but these
four frames are a narrower visual sample. They do not establish complete mobile
workflows, assistive-technology compatibility, WCAG conformance, or broad
Firefox/WebKit visual coverage. Earlier learning captures retain their own
source attribution below; the new run does not relabel those earlier bytes.

## Earlier practice captures

- Capture date: 15 October 2026
- PR head: [`a4cc101a1b3a905dcc8645e37d093836d3d1e326`](https://github.com/storminator89/forgeCommunity/commit/a4cc101a1b3a905dcc8645e37d093836d3d1e326), source tree `c7db611cb0dcb5a141aef5014296990b7ed97fcf`
- Merged main: [`edcd9cfb6611eefe27275d603bedcd108b7430ec`](https://github.com/storminator89/forgeCommunity/commit/edcd9cfb6611eefe27275d603bedcd108b7430ec), with the same Git tree
- Workflow: [exact-head PR run 38776781726](https://github.com/storminator89/forgeCommunity/actions/runs/38776781726), **all seven jobs passed**, including quality, strict audit, Docker, PostgreSQL release/runtime, browser QA, and validation. Browser QA passed 124 Chromium cases and four Firefox/WebKit critical journeys; 59 configured variants were skipped.
- Artifact: [`browser-qa-38776781726-1`, ID 11994935278](https://github.com/storminator89/forgeCommunity/actions/runs/38776781726/artifacts/11994935278). The `a9caf4d5a84e` filename suffix identifies the CI checkout, while the run/artifact metadata identify the PR source head above.

| Repository image | Artifact path | Viewport / PNG dimensions | State |
| --- | --- | --- | --- |
| `readme/practice-question-desktop.png` | `formative-practice-real-le-115cc-ession-and-private-evidence-desktop-chromium/real-learner-question-desktop-a9caf4d5a84e.png` | 1280×800 / 1280×800 | Enrolled, opted-in learner's reserved question with optional confidence; answer not yet submitted |
| `readme/practice-feedback-mobile-320.png` | `formative-practice-real-le-115cc-ession-and-private-evidence-desktop-chromium/real-learner-feedback-320-a9caf4d5a84e.png` | 320×700 / 320×700 | Scrolled corrective feedback after a real submitted answer; next question waits for an explicit action |

SHA-256 of the earlier practice PNGs:

```text
398abbd80345d6dbc117376bdcd1b7a2bd5ff7b04ae8c72cbabeb912cfa4ceaf  readme/practice-question-desktop.png
e86cebc04c755f42e75b6f9eb411448f81c1d9c97dc7d2de82ca9a500964075b  readme/practice-feedback-mobile-320.png
```

The selected [real learner journey](../../e2e/formative-practice-real-learner.pw.ts)
registers synthetic instructor and learner accounts in a guarded, disposable
loopback SQLite database, publishes a practice pool through the app API, then
opts in and answers through the actual learner UI. It does not intercept or
replace the learner API responses. The pixels show only a synthetic account
name, question, and explanation; no email, password, token, real member record,
or production data is visible. The 320px frame is scrolled to feedback, so it
does not document the entire mobile page. These two frames do not prove broad
mobile, assistive-technology, dark-mode, or cross-engine visual coverage.

## Course publication captures

- Capture date: 15 October 2026
- PR head: [`326f4798fc59ccb8c15420d95eaf79cb91bec191`](https://github.com/storminator89/forgeCommunity/commit/326f4798fc59ccb8c15420d95eaf79cb91bec191)
- Checked-out CI merge commit: [`bc805124afb0c5b3f72df0d45e6d1e911e993499`](https://github.com/storminator89/forgeCommunity/commit/bc805124afb0c5b3f72df0d45e6d1e911e993499). Its Git tree `9b58c8986012c95d8f80f9db7ae7bfa96fee3692` is identical to that PR head's tree.
- Workflow: [PR run 38729421653](https://github.com/storminator89/forgeCommunity/actions/runs/38729421653), **overall failed** because the PostgreSQL smoke and course-page route manifest had outdated authentication/heading fixture expectations. The staged editor's actual desktop and 320px Chromium journeys passed; the security, quality, Docker, PostgreSQL migration, and four Firefox/WebKit critical-journey jobs passed. The later green #45 run above does not change these earlier screenshot bytes.
- Artifact: [`browser-qa-38729421653-1`, ID 11968724406](https://github.com/storminator89/forgeCommunity/actions/runs/38729421653/artifacts/11968724406)

| Repository image | Artifact path | Viewport / PNG dimensions | State |
| --- | --- | --- | --- |
| `readme/course-draft-authoring-desktop.png` | `course-editor.pw.ts-privat-efd54-nt-use-real-disposable-data-desktop-chromium/private-author-outline-editor-desktop-bc805124afb0c5b3f72df0d45e6d1e911e993499.png` | 1280×800 / 1280×800 | Saved private draft, synthetic text lesson selected, real outline/editor |
| `readme/course-publication-review-desktop.png` | `course-editor.pw.ts-privat-efd54-nt-use-real-disposable-data-desktop-chromium/publication-review-desktop-bc805124afb0c5b3f72df0d45e6d1e911e993499.png` | 1280×800 / 1280×800 | Real review dialog over synthetic draft, ready state and impact counts before first publish |

SHA-256 of committed course-publication PNGs:

```text
4e21ffa1b8d9e4ce5826e190e8e57417e6ecdf3ba0cc60427def7b378906d970  readme/course-draft-authoring-desktop.png
5eb6772fe641427da2e46f2c77209f0122369e8ba6388314cbdd7996aa149a45  readme/course-publication-review-desktop.png
```

These earlier frames show only `Publication Author Fixture` and a generated
`Private publication …` title from the disposable browser database. No email,
password, token, real member record, or production data is visible. The draft
frame labels the private saved state and shows the selected lesson and editor
controls; the rich-text body is below that panel's visible scroll position.
The review frame visibly shows the saved-only publication boundary, two added
lessons, no enrolled learners, and certificate/completion guidance. The same
journey also captured a 320px published author workspace and passed an overflow
assertion, but that viewport frame was not selected for README because its
lower editor panel is cut at the fold. These pixels are a focused visual check,
not proof of assistive-technology, dark-mode, all-lesson, all-engine, or full
mobile UX coverage.

## Historical pre-phase-2 gallery

The two course captures document the earlier immediate-save authoring flow.
They are not evidence that the new private-draft, review, publish, version
history, or restore flow has passed browser QA.

## Source and reviewed gallery

- Capture date: 15 October 2026
- Source commit: [`102576735dd3b7cb23c8657e3a74098228582bc6`](https://github.com/storminator89/forgeCommunity/commit/102576735dd3b7cb23c8657e3a74098228582bc6), after the LMS authoring merge and touch-target correction
- Source Git tree: `b4d8b2eeb4875648e90837b3c046dc81ff1d2627`
- Workflow: [main push run 38717775096](https://github.com/storminator89/forgeCommunity/actions/runs/38717775096), completed successfully with all six jobs passing
- Artifact: [`browser-qa-38717775096-1`, ID 11963228196](https://github.com/storminator89/forgeCommunity/actions/runs/38717775096/artifacts/11963228196)

| Repository image | Artifact path | Viewport / PNG dimensions | State |
| --- | --- | --- | --- |
| `readme/landing-desktop-light.png` | `browser-qa.pw.ts-landing-a-79ba0--work-on-desktop-and-mobile-desktop-chromium/landing.png` | 1280×800 / 1280×1471 | Anonymous landing, light, full document |
| `readme/landing-mobile-light.png` | `browser-qa.pw.ts-landing-a-79ba0--work-on-desktop-and-mobile-mobile-390-chromium/landing.png` | 390×844 / 390×1809 | Anonymous landing, light, full document |
| `readme/course-quiz-authoring-desktop-light.png` | `course-editor.pw.ts-course-6523a-licitly-enters-learner-mode-desktop-chromium/course-editor-saved-quiz.png` | 1280×800 / 1280×800 | Historical pre-phase-2 synthetic owner, saved quiz authoring, light; editor panel scrolled to question/save controls |
| `readme/course-quiz-preview-desktop-light.png` | `course-editor.pw.ts-course-6523a-licitly-enters-learner-mode-desktop-chromium/course-editor-quiz-preview.png` | 1280×800 / 1280×800 | Historical pre-phase-2 synthetic owner, course preview of a local unsaved quiz draft, light |

SHA-256 of committed PNGs:

```text
987419530697c373ec6baef4182e842c97de9e29cee4ae3fc2632fa4a7682cf3  readme/landing-desktop-light.png
dac05a666ac88353e83fc4ea8e5adc5bc0050b0e9c3353a55ac33bfa21accd8b  readme/landing-mobile-light.png
f49398a74ef7b56a62d706124bd1855e8f46dcd2c51f30c82ac4a02b22e0d65f  readme/course-quiz-authoring-desktop-light.png
0fa9597263be0619eba8fe041308608e9de8c589d6e126acfaef372f498cc931  readme/course-quiz-preview-desktop-light.png
```

The two public landing captures happen to have the same bytes as the earlier
`87a8b584` artifact. These copies were nevertheless obtained and checked from
the `1025767` run listed above. No old editor image is relabeled as the new editor.
The older PNGs directly in `docs/ui/` belong to the historical guides that link
them and are not evidence for a later UI.

## Historical pixel and privacy review

The two landing pages are public and contain no member data. The authoring
screens use the freshly registered `Course Editor Fixture` account and a
synthetic course named “Lernwerkstatt: Fragen und Antworten”, created through the
real app APIs in the explicitly disposable SQLite CI database. Those labels and
numbers are examples, not customer identities, usage metrics, or production
activity. No credential, email address, authentication token, browser address
bar, or real personal record is visible in the selected pixels.

The quiz-authoring viewport deliberately reflects its real scrolled panel state.
The new-question type control and lower helper text are partly outside that
panel's visible scroll area; this is not a full-form capture. The preview image
visibly labels its unsaved draft and non-persisting rehearsal behavior. Focus
outlines and actual modal/backdrop behavior are preserved.

The run's text-editor frames were not selected: they show a toolbar without a
settled visible rich-text body. Save/font readiness alone does not establish
Tiptap readiness after remount. This is a rejected documentation frame, not a
claim that a data-loss defect was reproduced. Future text-editor captures must
wait for the actual “Text bearbeiten” textbox to contain the persisted lesson
text; a failure to reach that state must be investigated rather than hidden.

These historical frames do not claim complete mobile editor, dark-mode, all-field,
all-content-type, Safari/Firefox, assistive-technology, or WCAG coverage. The
historical mobile image is explicitly the public landing page. Independently
scrollable panels also mean one viewport PNG cannot show every control. The underlying
browser journey and API/database evidence have their own scope in the
[course editor guide](../COURSE-EDITOR.md).

## Refresh instructions

The Space mission/week, poll, saved course draft, publication review, and real
learner practice/feedback have reviewed captures above. Further targets are an
actual-data opt-in screen, the practice author workspace with controls in view,
the private course author worklist, and version-restore-as-draft state. Include a narrow viewport
with the relevant controls in view; inspect scrolled panels and distinguish a
local unsaved change from a saved private draft. Existing historical files
remain labeled and are not overwritten.

1. Use the existing approved GitHub Actions browser job on the intended app
   commit. It builds the production app and uses official Chromium with a
   loopback origin and explicitly disposable synthetic SQLite data. Do not aim
   these tests at a deployed app or personal database.
2. The historical gallery came from `e2e/browser-qa.pw.ts` and the earlier
   `e2e/course-editor.pw.ts` flow. The staged-publication journey in that same
   test file generated the two course captures. The separate
   `e2e/formative-practice-real-learner.pw.ts` journey generated the two earlier
   practice captures. `e2e/cooperative-space-missions.pw.ts` and
   `e2e/space-polls.pw.ts` generated the current Space captures. Inspect a new
   run's real artifacts before selecting any further images; distinguish
   API-intercepted UI tests from end-to-end learner evidence.
3. Retrieve the exact run's artifact and inspect actual pixels before copying.
   Reject blank/loading, error, credential-bearing, UUID-heavy, or stale-editor
   frames. Do not replace the app's state or composite a prettier interface.
4. Copy selected files without pixel editing. Record the real capture SHA/tree,
   run/artifact link, path, viewport/theme/state, dimensions, and SHA-256 here.
   A later docs-only or test-fixture commit necessarily has a different Git
   SHA; do not relabel images as captured at that later SHA. For a
   current-state gallery, verify app/rendering/dependency files are unchanged
   between the capture source and documentation head. The older images here
   remain explicitly historical because phase-2 source differs from their
   capture commit.
5. Check every Markdown image link and retain the synthetic-data captions.
   The CI uploader retains PNG artifacts for seven days, so the checked-in files
   preserve the reviewed evidence after the temporary artifact expires.

## Design reference used

The shared visual contract is [`design.md`](../../design.md). For this README
and screenshot work, the actual Hallmark 1.1.0 source checkout was inspected at
[`Nutlope/hallmark@13ac0ec7`](https://github.com/Nutlope/hallmark/tree/13ac0ec7e148655948100b6396439e481361d690),
including `skills/hallmark/SKILL.md`, the redesign guidance, and output contract.
The applicable guidance is honest content, an existing shared system, real
screenshots without redrawn chrome, and preserving implementation boundaries.
This does not claim an installed Hallmark runtime/tool or a fresh app-wide design
audit. The current pixel review covers the four selected Space frames and the
byte-identical public landing capture, alongside the earlier scoped
learner-practice, course-publication and historical reviews.
