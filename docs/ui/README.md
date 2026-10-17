# App screenshot provenance

All PNGs in this README gallery are unedited captures of actual ForgeCommunity
browser rendering, with no API-response substitution, compositing,
hidden/rewritten UI, or added browser/phone chrome. The Home illustration inside
the app is generated fictional artwork of two adults; it is not a photograph or
a generated interface screenshot. Its [asset provenance](../../public/images/home/forge-workbench.provenance.json)
records the original and proportional WebP derivatives. Selected screenshots
were copied byte-for-byte from their named GitHub Actions artifacts and
inspected at original dimensions. All authenticated content is disposable
synthetic test data. A browser journey can set up database fixtures directly;
the soft-week fixture is disclosed below.

## Current Home captures

- Capture date: 17 October 2026 (UTC)
- PR #77 head: [`686c029b1e0f6c2fe8f82b3afd57fbfe977db3e1`](https://github.com/storminator89/forgeCommunity/commit/686c029b1e0f6c2fe8f82b3afd57fbfe977db3e1)
- CI checkout: [`2b36d77f7dc6b76e2ae62c54d5390f289e9c562b`](https://github.com/storminator89/forgeCommunity/commit/2b36d77f7dc6b76e2ae62c54d5390f289e9c562b)
- Merged main: [`dfc76958365e1afc321f8f8b41aa27038f72919b`](https://github.com/storminator89/forgeCommunity/commit/dfc76958365e1afc321f8f8b41aa27038f72919b). All three commits have tree `7ae6960cadcd5c5eb6c7318bb1216f3d96a8a3c6`.
- Workflow: [exact-head PR run 38985703183](https://github.com/storminator89/forgeCommunity/actions/runs/38985703183), **all seven jobs passed**, including the three Chromium projects and four Firefox/WebKit critical journeys
- Artifact: [`browser-qa-38985703183-1`, ID 12083033627](https://github.com/storminator89/forgeCommunity/actions/runs/38985703183/artifacts/12083033627), archive SHA-256 `c5a10969515d509255ed5bdfae4758fd7418fdd1c105d431a103a73b220de8b3`

| Repository image | Artifact path | Viewport / PNG dimensions | State |
| --- | --- | --- | --- |
| `readme/home-desktop-light.png` | `desktop-chromium/landing-home.pw.ts-guest-h-e3922-inations-focus-and-200-text-desktop-chromium/landing-home-guest-light.png` | 1280×800 / 1280×1206 | Anonymous Home, light, full document, static Spark visible, reduced motion enabled |
| `readme/home-mobile-dark-320.png` | `mobile-320-chromium/landing-home.pw.ts-guest-h-bd4b4-inations-focus-and-200-text-mobile-320-chromium/landing-home-guest-dark.png` | 320×700 / 320×1843 | Anonymous Home, dark, full document, static Spark visible, reduced motion enabled |

SHA-256 of the two current Home PNGs:

```text
6c4230fb2fa3671644c562d666b6789a74aeaa24c2c303c20b9a9a380efdbf49  readme/home-desktop-light.png
d7bc0836fd6202b4eb35a73db3d0f6df757de60bc8b0265e554b7127c0ed28a3  readme/home-mobile-dark-320.png
```

The [Home journey](../../e2e/landing-home.pw.ts) opens the real public route,
waits for the local artwork to decode, and captures the full document before
its later focus and 200%-text checks. Neither selected frame contains an
authenticated identity or production data. The original fictional illustration
is visibly rendered in an uncropped 3:2 frame in both themes. These frames use
reduced motion; the movement control is visibly disabled. Normal Home artwork
is also static until the user explicitly requests its finite frame movement.

The separate [Spark entry journey](../../e2e/spark-entry.pw.ts) verifies a fresh
browser's default-visible static figure on Home, Community, and a genuinely
successful zero-enrollment Journey. A saved explicit Off is checked before
rendering/requesting the figure and survives reload/navigation when storage is
available. Native Show/Hide retains keyboard focus and synchronizes tabs. If a
preference write is denied, the choice remains document-local. Reduced motion
leaves an enabled figure visible and static. These are browser-local
presentation controls, not account-shared preferences or new learning activity.

The two selected PNGs establish only those visible Home states. They do not
show the member Community or an enrolled learning workflow, prove animation
timing from still pixels, or establish WCAG, assistive-technology, or broad
cross-engine visual coverage. The image uses one fixed 93,712-byte local WebP;
the [delivery note](../hero-artwork-delivery.md) records its deliberate mobile
bandwidth tradeoff. The earlier landing files remain unchanged and attributed
under the historical gallery below.

<a id="current-space-captures"></a>

## Earlier Space captures

- Capture date: 16 October 2026
- PR #67 head: [`ad2c37efb1fddd62da165aea06333fd6642946ff`](https://github.com/storminator89/forgeCommunity/commit/ad2c37efb1fddd62da165aea06333fd6642946ff)
- CI checkout: [`d173eda604865b11a859e26ae83d771ab1b60d4e`](https://github.com/storminator89/forgeCommunity/commit/d173eda604865b11a859e26ae83d771ab1b60d4e), the PR merge ref recorded in the browser-job checkout log
- Merged main: [`190320b6c4beb3ed0dd04fb8cbba49e59c90cf8a`](https://github.com/storminator89/forgeCommunity/commit/190320b6c4beb3ed0dd04fb8cbba49e59c90cf8a). All three commits have tree `aa5e95ce63348f80e0ba57bbe4a0d467a49e9fe2`.
- Workflow: [exact-head PR run 38884491467](https://github.com/storminator89/forgeCommunity/actions/runs/38884491467), **all seven jobs passed**, including desktop/320px/390px Chromium, four Firefox/WebKit critical journeys, and PostgreSQL mission/poll/waitlist contracts
- Artifact: [`browser-qa-38884491467-1`, ID 12039591886](https://github.com/storminator89/forgeCommunity/actions/runs/38884491467/artifacts/12039591886), archive SHA-256 `435e1aa3e3593a8a2bfa79be5344075517e94a5c3ce11a99b7fc137225439334`

The artifact paths below include the per-project output directory.

| Repository image | Artifact path | Viewport / PNG dimensions | State |
| --- | --- | --- | --- |
| `readme/space-mission-overview-light-768.png` | `desktop-chromium/space-mission-overview.pw.-de9c7-voked-membership-on-refresh-desktop-chromium/mission-overview-Hell-768.png` | 768×900 / 768×900 | One open, self-paced mission in the caller's private Space; viewing has not joined the mission |
| `readme/space-learning-week-form-light-768.png` | `desktop-chromium/cooperative-space-missions-351b2-ate-in-a-real-private-Space-desktop-chromium/mission-week-form-Hell-768.png` | 768×900 / 768×900 | Scrolled admin creation form, optional current Monday/week and Europe/Berlin zone selected; submit is below the fold |
| `readme/space-mission-light-768.png` | `desktop-chromium/cooperative-space-missions-351b2-ate-in-a-real-private-Space-desktop-chromium/mission-Hell-768.png` | 768×900 / 768×900 | Joined learner, soft week ended but mission open, two current insights and one valid cross-person build-on; lower detail is below the fold |
| `readme/space-mission-dark-320.png` | `desktop-chromium/cooperative-space-missions-351b2-ate-in-a-real-private-Space-desktop-chromium/mission-Dunkel-320.png` | 320×900 / 320×900 | Same mission in dark mode, top viewport; lower milestone detail and contribution controls are outside the frame |
| `readme/space-poll-light-768.png` | `desktop-chromium/space-polls.pw.ts-members--f283b-ose-and-lose-revoked-access-desktop-chromium/poll-Hell-768.png` | 768×900 / 720×629 | Unedited poll-section capture with three synthetic members' votes, caller's changed saved choice and action control |

SHA-256 of the five dated Space PNGs:

```text
da909803f80d021548954f34e2ae97572f6b0ce0eb15ba7470586115436d2f84  readme/space-mission-overview-light-768.png
1aaffff697be8e8217d7df4e5fde5255add56265250d04627f007f09da1264ec  readme/space-learning-week-form-light-768.png
01ce09a061e495f6c66cee88d5d719465c4c5612ff2c8eafffd2382229464d2d  readme/space-mission-light-768.png
35488fa856b13a964d7b8f255d5ea2b3909527b9c023a00899bfd43d16068a87  readme/space-mission-dark-320.png
b6ec8ae9680bbc93e6d63f58458f77b229f7827c713feace97eedd5865c534de  readme/space-poll-light-768.png
```

The [mission journey](../../e2e/cooperative-space-missions.pw.ts) registers
synthetic accounts, promotes its synthetic admin directly in guarded SQLite,
and creates the private Space and mission through real APIs/UI. After the
administrator creates the current week through the form and two participants
share insights, the test directly moves the disposable stored window back one
week, then reloads and submits the cross-person build-on through the UI.
**Production has no schedule-edit or time-travel control.** The visible total
includes that late contribution; it proves neither on-time participation nor
real user qualification or measured learning.

The [overview journey](../../e2e/space-mission-overview.pw.ts) discovers a real
API-created mission from an unenrolled synthetic learner's private Space.
Browsing the overview does not create mission consent or participation. The
[poll journey](../../e2e/space-polls.pw.ts) records three synthetic members' votes
through the real API/UI, including the caller's changed choice. Displayed totals
and saved choice are server responses. Voter identities are not projected;
small-group choices can still be inferred, as the visible notice explains.
The selected demo frames are separate from the long-content stress captures.

The [post-merge main run 38885812817](https://github.com/storminator89/forgeCommunity/actions/runs/38885812817)
also passed all seven jobs on 16 October. These PNGs still come from the PR
artifact above, not from a later documentation commit.

The previous Space captures came from [PR #65 run 38871008041](https://github.com/storminator89/forgeCommunity/actions/runs/38871008041),
head `0a8cead91c7f24609236bd516a61722d22472001`, tree
`9ea80641be9e08520675503971124e76aeee0770` (also merged main
`38a0826458387056ea079d46797b3be4b7a36b96`). They are superseded here; their
original provenance and bytes remain in Git history. The unchanged public
`readme/landing-desktop-light.png` retains its historical attribution below.
It was also retrieved byte-identically from PR #65's
`desktop-chromium/browser-qa.pw.ts-landing-a-79ba0--work-on-desktop-and-mobile-desktop-chromium/landing.png`
(1280×800 viewport, 1280×1471 full-document PNG).

The five selected images show synthetic CI test data, with no email, password,
token, real member record, or production activity. They preserve actual focus
outlines, scroll positions and clipping. Mission/overview/poll journeys check
320/375/414/768px light/dark reflow and 200% CSS zoom, but these frames are a
narrower visual sample. They do not establish complete mobile workflows,
assistive-technology compatibility, WCAG conformance, or broad Firefox/WebKit
visual coverage. Earlier captures retain their own attribution below.

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

The Space mission overview/week, poll, course draft/publication review, and
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
   practice captures. `e2e/cooperative-space-missions.pw.ts`,
   `e2e/space-polls.pw.ts` and `e2e/space-mission-overview.pw.ts` generated the
   dated Space captures. Inspect a new run's real artifacts before selecting
   any further images; distinguish
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
audit. The current refresh inspected the two selected Home PNGs. The five dated
Space frames and earlier learner-practice, course-publication and historical
frames retain their original scoped reviews. The current shared contract uses
cool daylight/deep-water surfaces, petrol, coral and sunny accents, Inter, and
the pinned frontend-design guidance linked from that contract.
