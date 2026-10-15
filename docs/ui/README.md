# App screenshot provenance

These are **historical pre-phase-2** images. They show actual ForgeCommunity
rendering with no image generation, API-response substitution, compositing,
hidden/rewritten UI, or added browser or phone chrome. All four PNGs were
copied byte-for-byte from the same approved merged-main GitHub Actions
artifact and inspected at their original dimensions.

The two course captures document the earlier immediate-save authoring flow.
They are not evidence that the new private-draft, review, publish, version
history, or restore flow has passed browser QA. This document reserves no
replacement image names until a real capture has been reviewed.

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

## Pixel and privacy review

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

This gallery does not claim complete mobile editor, dark-mode, all-field,
all-content-type, Safari/Firefox, assistive-technology, or WCAG coverage. The
mobile image is explicitly the public landing page. Independently scrollable
panels also mean one viewport PNG cannot show every control. The underlying
browser journey and API/database evidence have their own scope in the
[course editor guide](../COURSE-EDITOR.md).

## Refresh instructions

For phase 2, capture the actual private author worklist, saved-draft indicator,
review dialog with real synthetic impact data, published learner view, and
version-restore-as-draft state. Include a narrow viewport; inspect scrolled
panels and distinguish a local unsaved change from a saved private draft.
These are capture targets, not claims that screenshots already exist or tests
have passed. Do not replace the historical files until the new source commit,
successful run and pixels have been verified.

1. Use the existing approved GitHub Actions browser job on the intended app
   commit. It builds the production app and uses official Chromium with a
   loopback origin and explicitly disposable synthetic SQLite data. Do not aim
   these tests at a deployed app or personal database.
2. The historical gallery came from `e2e/browser-qa.pw.ts` and the earlier
   `e2e/course-editor.pw.ts` flow. Use the staged-publication Playwright journey
   on the intended phase-2 commit for new course captures, then inspect that
   run's real artifacts before selecting any. This documentation change adds
   no browser test, runtime change, or temporary capture flag.
3. Retrieve the exact run's artifact and inspect actual pixels before copying.
   Reject blank/loading, error, credential-bearing, UUID-heavy, or stale-editor
   frames. Do not replace the app's state or composite a prettier interface.
4. Copy selected files without pixel editing. Record the real capture SHA/tree,
   run/artifact link, path, viewport/theme/state, dimensions, and SHA-256 here.
   A later docs-only commit necessarily has a different Git SHA; do not relabel
   images as captured at that later SHA. For a current-state gallery, verify
   app/rendering/dependency files are unchanged between the capture source and
   documentation head. The older images here remain explicitly historical
   because phase-2 source differs from their capture commit.
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
audit. The gallery's pixel review is limited to the four selected captures.
