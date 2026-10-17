# Experimental Cloudflare / Sites branch

This guide applies only to the `cloudflare-sites` branch. The default
[`main` branch](https://github.com/storminator89/forgeCommunity/tree/main) keeps
the standard Next.js self-hosted setup, including Docker with SQLite or
PostgreSQL. First-time users should start there.

This branch is a separate, partial adaptation for Cloudflare Workers and Sites:
Vinext/Vite, a request-scoped Prisma D1 adapter, app-owned session cookies, and
D1-specific SQL for selected flows. Its source snapshot starts from upstream
`c442bb09e0e46684f19bb6d6dff061e13078111d`; it does not import Sites history or
runtime data. This GitHub snapshot backs up the published Version 36 source
`f90430dcbce5f3fa2309fae9a2749538c0987ab1`. Version 36 deployed successfully on
17 October 2026 at 22:50:53 UTC. Bounded Space discussion/reply POST source and
the account-menu Journey fix are live. The bounded learner-menu check passed;
positive Space POST/replay/race acceptance remains unverified.
This branch is experimental and does not claim feature parity with main.

## Requirements and setup

- Node.js 24 and npm, following the checked-in lockfile.
- Your own Sites project and its deployment access. A generic `wrangler deploy`
  setup and standalone Cloudflare account deployment are not provided here.
- A D1 binding named `DB` and your own private R2 binding named `BUCKET`.
  Only the bounded chat-image pipeline below uses R2; other upload paths
  remain unported.
- An HTTPS origin and an empty development database for first setup. Back up an
  existing database before applying any schema changes.

Choose this branch explicitly:

```sh
git clone --branch cloudflare-sites --single-branch https://github.com/storminator89/forgeCommunity.git
cd forgeCommunity
cp .openai/hosting.example.json .openai/hosting.json
```

Register a new private project through your Sites tooling and replace the
placeholder `project_id` in the ignored `.openai/hosting.json` with that new
project's ID. Bind its own `DB` and `BUCKET` resources. The template contains no
live project identity, database ID, bucket ID, credential, or saved user data.
Do not reuse someone else's project ID or deployment credential.

Certificate verification URLs and QR codes are pinned to the archived Site's
verified canonical HTTPS origin by `CERTIFICATE_ORIGIN` in
`lib/server/certificate-pdf.ts`. If you fork this branch, set that constant to
your own verified Site origin before publishing your fork. Otherwise newly
generated certificates will link to the archived Site rather than your own.
Registering a new Sites project or editing the hosting template does not
automatically change the certificate origin.

```sh
npm ci
npm run dev
```

A clean clone uses the portable execution profile and development port 5173.
The installation generates the Cloudflare Prisma client and schema-only D1
migration files. It does not create or populate your deployed D1 database.
Apply `drizzle/0000_forgecommunity.sql` through the migration flow of your own
Sites project before using it. Do not run that initial schema against an
existing populated database without reviewing its migration history.

Build with `npm run build`; Sites packaging must use the project's supported
Sites build/publish workflow. `npm start` is a local Wrangler preview of the
built Worker, using `dist/server/wrangler.json`. It is not a production server.
The five authored files in `build/` are required integration source; keep them.

The standard `.env.example`, Docker commands, `DATABASE_URL` deployments and
`start:standard` inherited from upstream document main's setup. They are not
an alternate database backend for this branch: application reads use D1 `DB`.
Google/NextAuth OAuth is not supported by this adaptation. Sites project access
and the app's email/password session are separate layers.

## Current scope and limits

The published Version 36 source includes the existing bounded ports below,
inherited from Version 35, plus Space discussion/reply POST and account-menu navigation described
below. The earlier bounded Version 25 desktop live check does not establish complete runtime or
all-page visual coverage.

- D1-backed private course creation and draft editing, authoring-list/detail
  reads, review, publication, learner content reads, enrollment, progress,
  quizzes and certificates
- Comment reads and atomic comment-plus-notification writes for other post
  authors; comment counts are derived from stored comment rows
- D1-backed course Q&A list/detail reads and retained-list revalidation,
  preserving access checks and lesson-context visibility; Q&A writes remain unported
- Bounded chat-image uploads with browser normalization, server-side
  JPEG/PNG decoding and fresh PNG encoding, private R2 storage, and
  authenticated owner/message/channel-scoped image serving
- Native D1 atomic chat-message creation and generic notifications to all
  explicit other channel members, retaining existing channel-access checks
- Latest own quiz-attempt display on reopening, with an explicit repeat action
- Embedded licensed certificate fonts and bounded wrapping for names/titles
- Post/comment text formatting, multiline content and composer presentation
- Protected Space/mission reads, privacy-scoped mission overview and personal
  learning-pathway reads
- Own mission-invitation preference and inbox GET reads using D1, without
  materializing missing settings or changing invitation mutation/signing setup
- D1 assignment own/queue reads, learner submission and staff grading, using
  publication/version checks and native atomic batches with progress/reward
  updates; assignment grading runtime acceptance remains pending
- Journey waiting-for-grade projection for own valid, unlocked assignment
  leaves whose latest current-revision submission has no decisions; this
  status does not grant completion and its published acceptance remains pending
- Native D1 admin course reward-approval/withdrawal with session and stored
  ADMIN checks plus atomic approval and ledger/history/badge/pathway
  reconciliation; a bounded single approval and reload check passed
- Current-course Journey station trail with real chapter/descendant counters,
  retained earned stations, the existing global next step, and non-actionable
  locked/waiting states; bounded desktop acceptance and untested variants are
  distinguished below
- Native D1 community accepted-solution selection with owner-only authority,
  exact snapshot/CAS fences and fixed server-authored history; live transitions
  and reversal/concurrency acceptance remain unverified
- Anonymous/loading navigation and Community sign-in states avoid mounting
  member navigation, private account menus and the composer; live readback pending
- Scoped knowledge-base article-viewer typography for existing rich HTML, with
  semantic headings, lists, spacing, links, code and images; bounded article
  acceptance is documented below
- Local knowledge-base directory search/category/tag URL-state and native
  history navigation, preserving existing data/filter/auth behavior; bounded
  search/category/history/reset readback passed as documented below
- Native protected D1 Space discussion/detail/reply GET reads; positive fixture,
  private/hidden/revocation and pagination acceptance remain unverified
- Resources submission disclosure, single-pending-submit guard and retained
  inline errors, with existing backend behavior unchanged; bounded disclosure/
  native validation readback passed, pending-request variants remain untested live
- Search loading/anonymous presentation outside the private account-keyed
  viewer, with a sign-in CTA and safe local return URL; bounded signed-in
  regression passed, while guest and login-callback acceptance remain source-only
- Compact fixed-status resource-preview fallback with the existing safe source
  link; this UI change does not repair metadata fetching or its DNS/transport port
- Native D1 atomic ADMIN Space creation with creator membership and PUBLIC
  own desired join/leave operations; positive runtime mutation acceptance open
- USER-only Journey sidebar/quick-search navigation and eligible-course URL
  selection, with native history and account/publication guards; positive
  multiple-course/resume runtime acceptance remains unverified
- Native D1 protected member discussion/reply POST with scoped request-row
  replay, exact atomic snapshot guards and bounded response checks; positive
  runtime POST/replay/race acceptance remains open
- Account-menu learning link opens Journey for USER learners and the course
  overview for other authenticated roles; bounded learner-menu readback passed
- Protected formative-practice learner GET snapshots using native D1 reads;
  Practice opt-in, start, answer and other mutation flows remain unported
- Scoped course rich-text reader/editor typography and repository-owned public
  course audio/video examples with a bilingual companion transcript
- Public publication/content-ID preconditions for learner writes and
  foreground-aware polling for chat, notifications and selected directories
- Centrally loaded notification CSS, replacing nested runtime CSS imports
- Article category selection and inline validation, preserved form input and
  error feedback, browser navigation, and public About content
- Repository-owned Inter font assets with relative CSS URLs and their OFL
  license, replacing checkout-origin font references

This remains a partial adaptation. Course deletion, formative-practice
mutation flows, course Q&A creation/replies/moderation/solution writes,
course analytics, and other Space/mission mutation flows remain unported.
Version 34 ports ADMIN Space creation and PUBLIC own join/leave source;
Version 36 additionally ports member discussion/reply creation. Positive Space
mutation acceptance remains open. Moderation, polls, invitations, private member
removal and mission cleanup remain outside these ports. Other workflows may still use Prisma
transaction patterns that D1 does not support. Do not infer full write-flow
support from this source scope.

Chat images use the existing private R2 binding through the dedicated chat
upload/serve routes. The browser prepares JPEG/PNG/WebP/GIF as a bounded
image; unsupported browser decoding fails clearly. The server accepts genuine
JPEG/PNG up to 5 MiB, 1 megapixel and 1600 pixels per side, and stores only a
freshly encoded PNG. There is one admitted upload per isolate and a 15-second
body deadline; R2 provider delays can retain that admission until settlement.
Image reads require the current account and either owner staging access or
access to the exact message/channel. Legacy filesystem images are not migrated.
A failed later message write can leave a private orphan. The codec pins are
`jpeg-js@0.4.4` and `pngjs@7.0.0`; retain the complete public notice at
`public/licenses/chat-image-codecs.txt`.

The checked-in examples under `public/course-media/` are deliberately public
authored assets, separate from private user uploads and Storage. Their
publication does not establish general course-media upload/storage support.

Avatar/profile images, post-file uploads, private course assets and H5P package storage
remain outside this repair and may still depend on Node filesystem/native
image-processing APIs. They are not supported as durable Workers storage.
Declaring R2 does not port those other paths or establish general upload support. No PostgreSQL or ordinary file-backed SQLite runtime is supported on
this branch. Managed-Linux helper scripts depend on external Sites tooling;
their standalone wrapper is not part of this source snapshot. The inherited
`db:seed` script and standard-runtime test fixtures are also unported and may
still import native bcrypt or NextAuth dependencies absent from this branch.

Validation for this work is limited to the published Site and the exact source
build reported with its release. Version 15 passed production typechecking
and its build, but its live Q&A regression check failed. Version 17 includes
fixed-class diagnostics without provider messages/data and an equivalent
compound-query grouping correction. Version 17 passed its production source
validation/build; basic Q&A list and revalidation reads returned 200 on the
published Site, without establishing full Q&A coverage. Version 18 passed
production typechecking and its build. The approved single-logo chat-image
flow passed on the published Version 18 Site; this does not establish general
browser compatibility, codec load/memory behavior or other image workflows.
Version 19 passed production source validation and its build. Its own
preference-off/empty-inbox view passed an initial-and-reload check with both
own GET routes returning 200. Enabled inboxes, pagination and mutations are
not established by that check. Invitation mutations remain unported, and
existing cursor-signing requirements are unchanged. Version 20 only adjusts
chat-image display sizing and collapses upload details behind a disclosure.
Its production typechecking/build passed and its published read-check confirmed
the existing 128-by-128 logo image and keyboard disclosure. It made no codec
or API change. Version 21 adds image-viewer Escape focus restoration, protected
formative-practice learner GET reads, scoped course typography, and the authored
public course-media examples. Version 21 production typechecking/build passed;
its deployment succeeded on 17 October 2026 at 16:26:27 UTC. Its live runtime
checks were pending when that source was archived. Version 22 only adds a
UTF-8 byte-order mark to the public companion transcript so browsers can
recognize its encoding. All other media and application code are unchanged.
Version 22 production typechecking/build passed and its deployment succeeded
on 17 October 2026 at 16:38:52 UTC. The bounded published transcript check
passed at 16:39:24 UTC: the normal transcript URL reported UTF-8 and rendered
the checked German accented words correctly. Other learner-course checks
remain separate and pending. Version 23 ports the bounded assignment own/queue
GET, learner submit, and staff grade operations to D1 with publication/version
guards, historical receipt replay, atomic write fences, and first-pass progress,
completion and rewards. Its production typechecking/build and static artifact
checks passed; deployment succeeded on 17 October 2026 at 17:03:19 UTC. Actual
assignment read, submission and grading acceptance was pending when that
source was archived. That release included no schema, configuration, host,
environment, access or UI change. Version 24 adds the bounded own-assignment
waiting-for-grade projection to progress reads and Journey, displaying
"Bewertung ausstehend" and "Abgabe ansehen" without granting completion or
offering the pending assignment as the next actionable step. Failed or withdrawn
decisions remain actionable. The private course snapshot SQL copy is synchronized
in the assignment state reader. Version 24 production typechecking/build passed;
deployment succeeded on 17 October 2026 at 17:50:43 UTC. The waiting label and
existing grading regression are still awaiting published runtime acceptance.
Off, archived, or unavailable Practice states can be
honest results; these GET changes do not establish supported Practice writes,
scheduling, retention maintenance, or cursor-signing repair. No new local
functional tests or GitHub CI run are part of this work. The inherited standard pipeline is unchanged: pushes run
only for main/master, and no pull request is opened for this branch. Recheck
workflow triggers before opening any future pull request. A passed build is
not evidence that untested product flows work. Record live checks separately,
without committing account data, cookies, screenshots containing private
data, or database files.

## Published Version 25 and bounded live acceptance

Version 25 adds a private community learning-progress card using the existing
own rewards read. It distinguishes historical distinct course-completion
milestones at 1, 3, and 5 courses from the active points ledger, and includes
account/revision/abort isolation plus bounded response validation. Existing
contribution statistics remain separate. It changes no backend, API, scoring,
configuration, environment, host, or access setup.

Version 25 source review, production typechecking/build, and static artifact
checks passed. The exact saved source was published after explicit approval;
deployment succeeded on 17 October 2026 at 18:39:00 UTC. This documentation
update changed no application source or public media bytes.

The bounded published desktop check between 18:39 and 18:41 UTC used a
1180-by-757 viewport. The private card appeared above the community feed and
correctly separated one historical completed course from zero active points:
milestone 1 was reached, 3 was next, and 5 remained future. Native disclosure
keyboard activation, refresh readback, and the keyboard CTA to Journey passed;
the current Journey stayed at 8 of 8. The static Spark asset loaded at 64 pixels.
No visibility, ranking, or scoring settings changed.

This check does not establish mobile or reduced-motion behavior, offsetting
reward-history cases, account-switch isolation, or error-path behavior. Those
live scenarios remain unverified; source review and the build are not substitutes
for their runtime acceptance.

## Version 26 admin reward-approval port

Version 26 changes only the existing admin reward-eligibility PATCH and a
dedicated native D1 helper. It preserves session and stored ADMIN checks,
requires an exact publication/content/previous-approval snapshot, and performs
the approval update plus existing publication-mode reward, ledger, history,
badge and pathway reconciliation within one native atomic batch. Changed-state
retries reauthorize; unexplained unchanged failures remain errors. Withdrawal
remains available without a valid publication. No new client fields or scoring
rules are introduced.

Source review, production typechecking/build, and static artifact checks passed.
Deployment succeeded on 17 October 2026 at 20:02:01 UTC; PUBLIC visibility and
environment revision 2 are unchanged. A single normal admin course approval
was submitted at 20:03:04.851 UTC. The UI showed the approved state and
withdrawal button at 20:03:14 UTC, and that state persisted after reload at
20:03:37.924 UTC, without an observed error. No withdrawal or second submit
was performed. Individual learner point credits were not proved by that
initial approval check. A later bounded community read, described below,
showed a consistent positive course-reward balance and ledger entry. Neither
result establishes all approval, withdrawal, or reconciliation scenarios.
No secrets, active hosting identity, runtime database, Storage contents or
private QA artifacts are included in this source backup.

## Version 27 current-course Journey trail

Version 27 changes four frontend files only. It displays the selected course as
a full vertical station trail, with actual root chapters, descendant-leaf
counters and current completion markers. Earned stations remain visible; the
existing global next step, pending assignments and locked/non-actionable states
retain their meanings. Native chapter disclosures keep account/course/
publication-scoped choices across refresh. Allowlisted response validation
checks tree, publication, gates, completion and pending-state coherence;
conservative date/prerequisite closure cannot open a server gate or erase an
earned completion.

The shared projector/reader, Spark preferences, and same-publication
false-to-true completion celebration are unchanged. There are no API, backend,
scoring, configuration, host or runtime-data writes in this increment.
Source review, production typechecking/build and static artifact checks passed.
Deployment succeeded on 17 October 2026 at 20:43:01 UTC. A bounded published
read-only desktop check at 1180 by 757 pixels passed. Journey showed all eight
confirmed stations and the final checkpoint at 20:50:10 UTC. Reload at
20:51:52 UTC retained 8 of 8 confirmed stations and eight correct station links.
Station 1 opened through Tab/Enter, and station 8 opened its normal audio view
with playback paused at the start. The focus outline measured 2 pixels and
there was no horizontal overflow at the checked viewport. No learning-state
write was performed.

An earlier community read during the same bounded session showed a positive
active-point balance matching one visible course-reward ledger entry after
the legitimate Version 26 approval. This records readback consistency only,
without storing account identities, account contents, or screenshots.

The 320/390-pixel mobile layouts, chapter-group, next-step, pending and locked
variants, account transitions and comprehensive accessibility have not been
live-validated. The desktop completed-course check does not establish those
scenarios.

## Version 28 accepted solutions and auth-state UI

Version 28 changes four reviewed files. Its accepted-solutions service uses a
primary typed snapshot that fences actor/current ownership, publication, the
requested same-post non-self/non-test reply, and the exact selected ID/revision.
It preserves the role-neutral post-owner contract and validation/error order.
A same-state guarded no-op writes no history. A real transition uses one native
five-statement batch with throwing snapshot guard, CAS mutation, one-row
assertion, fixed server-authored history, and final state/history assertion.
Only recognized race errors with a changed freshly authorized state may retry;
unknown or ambiguous commits are not retried. Old selection references are
byte-bounded before transport. No points, counters, notifications, rewards,
cleanup, or schema changes are introduced.

The three disjoint UI files suppress member navigation, the private account
menu and the Community composer while anonymous or loading, and provide a
sign-in prompt with a safe local return path. Existing authenticated feed and
account/role keys remain. Authentication, API, proxy and security setup are
unchanged.

Source review, production typechecking/build and static artifact checks passed.
Deployment succeeded on 17 October 2026 at 21:34:25 UTC. Accepted-solution
transitions, reversal and concurrency remain unverified live until a legitimate
authorized flow occurs; no artificial selection or engagement record was made.
Auth-state UI readback is still pending. No completed Version 28 browser result
is claimed by this backup.

## Version 29 knowledge-base article typography

Version 29 changes only the article viewer CSS import/class and a dedicated
scoped typography module. Headings, lists, paragraph spacing, links, code and
images use the existing semantic light/dark tokens. The rich HTML string,
sanitizer, editor, APIs and global styles are unchanged.

Source review, production typechecking/build and static artifact checks passed.
Deployment succeeded on 17 October 2026 at 21:40:42 UTC. Published article
reader typography passed a bounded normal read at 21:41:55 and 21:43 UTC.
Four existing H2 headings rendered at 24 pixels and weight 650 with spacing;
the six-item unordered list showed disc markers and 24-pixel padding. Paragraphs
used a 28-pixel line height and 16-pixel separation. Both checked source links
were underlined and showed a 2-pixel keyboard focus outline. The saved article
was unchanged and no content edit was made. This one-article check does not
establish all rich-content or responsive variants. No local functional tests
or application/browser execution were performed for the source backup.

## Version 30 knowledge-base directory URL-state

Version 30 changes only the directory page and a pure URL-state helper. Search
text is capped at 120 characters with control characters removed; known
category/tag values are encoded in the same-origin directory URL. Typing
replaces the current history entry; category/tag/reset actions push entries,
and native popstate restores the view. Unknown or repeated parameters have safe
defaults. Reset retains focus on the stable search input.

Existing published-article fetching, filtering, data and authentication remain
unchanged, as does Version 29 reader typography. No API fetch call or article/
content write is added. Source review, production typechecking/build and static
artifact checks passed. Deployment succeeded on 17 October 2026 at 21:45:00 UTC.
A bounded normal published readback passed on 17 October 2026. At 21:46:27 UTC
a search/category combination remained intact after opening an article and
Browser Back, retaining one result. At 21:47:30 UTC Back/Forward restored the
query-only and combined views correctly. Opening the exact UI URL in a temporary
same-browser tab and reloading retained the filters and one result; that tab
was closed. Keyboard reset cleared query/category to the all-category view and
retained focus with a visible ring on the search input. No content write was
performed. Tags, unknown parameters and slow-load behavior remain untested live.

## Version 31 Space discussion reads and Resources submission UI

Version 31 combines four reviewed backend read files with one separately
reviewed Resources UI file. Discussion detail, reply-list and individual-reply
GET routes use one protected native D1 statement per request. Existing access,
hidden-content and manager boundaries, cursor/error ordering, dates, bounded
projection and response DTOs are retained. Replies POST and all other mutation
callbacks are unchanged. This is a read port, not Space mutation support.

Resources adds a public-visibility/name disclosure, a same-frame pending-submit
guard, disabled fields while pending, retained inline errors and stale-view
success suppression after account/view unmount. Its backend and existing
submission payload are unchanged. No resource or discussion was created for
this backup.

Independent source review, production typechecking/build and static artifact
checks passed. Deployment succeeded on 17 October 2026 at 22:03:59 UTC. At
22:04 UTC a bounded published readback showed the public-visibility disclosure.
An empty submit triggered the native required-title check and focused that
field; no POST occurred. Cancel retained the existing resource list without
creating content. Actual pending-submit, repeated-submit and mid-request-close
behavior remains source-reviewed only, with no live proof.

The empty Spaces directory showed no UI error. Existing authorized discussion/
reply fixtures are still absent, so positive detail/list/reply GET acceptance
remains unverified. No private/hidden/revocation/pagination result is claimed,
and no discussion or reply was created to manufacture a passing check.

## Version 32 Search auth-state presentation

Version 32 changes only `app/search/SearchPageClient.tsx`. Loading and anonymous
states render in the shared Search shell before the private search viewer is
mounted. Guests receive a sign-in CTA using the existing safe local return URL.
The account-keyed private viewer is unmounted while the session is checked or
when the account changes. The existing signed-in query/results/filter logic and
API behavior are otherwise retained; no authentication or security setup changes
are included. The loading shell honors reduced-motion styling.

Source review, production typechecking/build and static artifact checks passed.
Deployment succeeded on 17 October 2026 at 22:12:03 UTC. A bounded normal
signed-in Search regression produced real results. Keyboard activation of the
article tab returned the matching article, opened its correct detail, and
Browser Back retained query/filter context. Keyboard activation of the Resources
tab showed the matching resource; reload retained the query, filter and result.
No write or logout was performed. Account identities, search contents and
screenshots are not included in this documentation. Guest UI and login-callback
behavior remain source-reviewed only; account-transition, reduced-motion and
complete search-flow live coverage is not established.

## Version 33 compact resource-preview fallback

Version 33 changes only `components/ResourcePreview.tsx`. A compact fixed-status
fallback replaces the large error block and retains the existing safe direct
source link. Authentication, rate-limit and temporary failures receive bounded
server-status descriptions; arbitrary provider/error text is not displayed.
No new request or retry is introduced. PDF/video special handling, existing
URL/type and mounted/abort guards, and server auth, DNS, SSRF, redirect,
transport and rate limits are unchanged.

Source review, production typechecking/build and static artifact checks passed.
Deployment succeeded on 17 October 2026 at 22:20:27 UTC. A bounded normal read
of an existing resource showed the compact 148-pixel unavailable fallback. Its
direct-source link had a 44-pixel target and visible keyboard focus, with the
exact HTTPS destination and noopener/noreferrer protections retained. Reload at
22:21:45 UTC retained the fallback and signed-in session. No content write was
performed. Metadata remained unavailable; authentication, rate-limit and server-
error status variants were not deliberately provoked and remain untested live.
This increment does not repair metadata fetching: the DNS/transport source
blocker remains open. No successful preview fetch or particular external-site
restriction is inferred from the UI.

## Additional curated user-flow roadmap

[USER_FLOW_ROADMAP.md](USER_FLOW_ROADMAP.md) is an additional user-requested
product document, not part of the Sites source. Its stated 17 October 2026,
22:19 UTC date and Version 32 source base are intentionally retained, alongside
its distinction between observed findings, source blockers and proposals.
Unnecessary test-account labels, account totals and concrete search contents
were anonymized for this public repository copy. The roadmap does not claim
that proposals or later release work were implemented at its recorded base.

## Version 34 bounded Space-base write port

Version 34 changes three reviewed backend files. ADMIN Space creation and its
creator membership share one native atomic batch. PUBLIC own join/leave is a
desired set/unset operation with protected preflight, exact throwing snapshot
guards and in-batch response assertions. Stored ADMIN authority, dates, bounded
response projections and fresh count invariants are checked. CREATE has no
durable request receipt, no automatic ambiguous-result retry and no exactly-once
guarantee.

Discussion/reply writes, private member removal and invitation/mission cleanup
remain outside this port. This delivers only the first bounded source stage of
the roadmap P1-A package; it does not complete the usable Space discussion flow.
The additional user-flow roadmap remains byte-identical to the curated document
added with Version 33, retaining its recorded Version 32 date/base and proposal
status.

Independent source review, production typechecking/build and static artifact
checks passed. Deployment succeeded on 17 October 2026 at 22:29:24 UTC. A bounded
read at 22:29:57 UTC retained the signed-in session after reload and showed the
empty Spaces directory without a UI error. No Space was created and no join or
leave was performed. Positive Admin/create/join/leave, private-space, race and
rollback acceptance remain unverified; the empty directory and passed build
are not positive mutation acceptance.

## Version 35 Journey navigation and eligible-course URL

Version 35 changes five frontend files, combining independently reviewed
navigation and course-selection patches. The sidebar and quick-search entry
for the existing Journey route are visible only to authenticated USER learners;
active navigation does not mark Courses and Journey simultaneously. A local
course parameter can select only an item in the currently loaded eligible
course list. Unknown or repeated parameters use the existing safe fallback.
Deliberate course changes use local history and a safe fragment; native
Back/Forward and account/publication guards retain scoped selection semantics.

There is no new endpoint, data mutation, scoring rule, or shared reader/projector
change. This is the frontend source port of roadmap P1-B, not proof of successful
unfinished-course resumption or genuine multiple-course switching. The curated
roadmap is retained byte-identically at its dated Version 32 base.

Independent component and exact-union source review, production typechecking/
build and static artifact checks passed. Deployment succeeded on 17 October
2026 at 22:37:51 UTC. A bounded one-course published check at 22:39 UTC passed:
the Journey rail link opened with Enter and only Journey carried aria-current;
quick-search keyboard activation opened its unique Journey result. The
UI-generated eligible course URL and reload retained the same completed course.
Opening the exact UI share link in a temporary tab retained that course, its
8-of-8 state and the session. No data write was performed, and account names,
course identifiers and screenshots are excluded from this documentation.

Two genuine eligible enrollments, course switching/Back/Forward, invalid or
repeated IDs, anonymous/login return, account transitions, narrow layout and
unfinished resumption remain unverified live. This completed single-course
check does not establish those scenarios or complete roadmap P1-B acceptance.

## Version 36 bounded Space content writes and account-menu Journey link

Version 36 changes three backend files for existing discussion/reply POST
routes and one independently reviewed account-menu file. Native D1 writes
require a current stored account, membership and a visible reply parent. A
scoped request row supports same-payload replay while that row exists; a changed
payload returns conflict. Exact typed pre/post snapshot guards, atomic batches,
bounded response projection and a fresh visible-reply count protect the write
and its returned response. Only recognized rolled-back snapshot/request-key
conflicts are reconsidered; an ambiguous provider result is not automatically
retried. There is no permanent tombstone or lifetime exactly-once guarantee.

The existing account menu sends authenticated USER learners to Journey; other
authenticated roles receive the course overview destination. It reuses the
central role guard and changes no account/role, authentication, scoring,
endpoint or data model setup. Anonymous/loading menu behavior is unchanged.

Independent backend and frontend review, exact-union verification, production
typechecking/build and static artifact checks passed. Deployment succeeded on
17 October 2026 at 22:50:53 UTC. Positive published POST, replay, race, private,
hidden-parent and membership-revocation acceptance remains unverified. At
22:51-22:52 UTC a bounded learner readback showed the account-menu Journey
label and keyboard Enter from Community opened the canonical Journey with the
existing 8-of-8 state. The empty Spaces directory showed no UI error. No Space
creation, join, discussion or reply POST was performed. Other authenticated-role
menu variants remain unverified live. No account name, course identifier or
screenshot is included in this documentation.

This is an additional bounded P1-A source stage, not complete end-to-end Space
flow acceptance. Moderation, polls, invitation and mission mutations remain
separate. Version 35's bounded completed single-course navigation check remains
as documented above; this increment does not establish multiple-course or
unfinished-course resumption. The curated roadmap remains byte-identical at
its recorded Version 32 date/base, with findings and proposals kept distinct.

## Keeping the branches separate

Keep Cloudflare-only dependencies, auth, D1 queries and deployment scaffolding
on `cloudflare-sites`. Do not merge this branch wholesale into main. Port a
shared product fix to main separately only after checking its standard runtime.
This branch leaves the repository's default branch and first-time setup intact.

Never commit real `.env` files, `.openai/hosting.json`, credentials, local
Wrangler/Miniflare state, database/WAL/SHM files, generated Prisma output,
`node_modules`, `dist`, `.next`, uploads, or private QA artifacts.
