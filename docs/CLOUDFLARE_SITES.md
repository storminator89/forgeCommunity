# Experimental Cloudflare / Sites branch

This guide applies only to the `cloudflare-sites` branch. The default
[`main` branch](https://github.com/storminator89/forgeCommunity/tree/main) keeps
the standard Next.js self-hosted setup, including Docker with SQLite or
PostgreSQL. First-time users should start there.

This branch is a separate, partial adaptation for Cloudflare Workers and Sites:
Vinext/Vite, a request-scoped Prisma D1 adapter, app-owned session cookies, and
D1-specific SQL for selected flows. Its source snapshot starts from upstream
`c442bb09e0e46684f19bb6d6dff061e13078111d`; it does not import Sites history or
runtime data. This GitHub snapshot backs up the published Version 66 source
`c29d72d3cc07b2150aae03f0043adb7879c5b42e`. Version 66 deployed successfully on
18 October 2026 at 05:55:07 UTC. Canonical course-asset GET/HEAD authorization
now uses native D1; private storage/uploads remain unchanged and positive byte/
HEAD/ACL/persistence acceptance is open. Native/legacy/DDL limits remain explicit.
Roadmap uses v66; the source map retains its historical v63 base.
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

The published Version 66 source includes the existing bounded ports below,
inherited from Version 65, plus native D1 course-asset reads described
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
- Project-detail header presentation with a bounded title scale, wrapping
  metadata, separate action row and 44-pixel minimum action targets; original
  content and behavior unchanged, bounded desktop layout readback passed
- Project-comment draft revisions preserve edits made during a pending POST;
  unmounted views suppress late UI success/errors; source-reviewed race and
  lifecycle guards; bounded ordinary-comment acceptance passed, race proof open
- Resources and Showcases directory query/filter/sort state in local URLs,
  with native history and keyboard reset focus; API and existing filtering scope
  unchanged, bounded detail/Back/reload/share/reset readback passed
- Project-comment explicit HTTP(S) plain-text links use the existing URL guard,
  token rejection and visible keyboard focus; stored content and sanitizer
  unchanged, bounded existing-comment link readback passed
- Project-edit immutable submit snapshot, single-pending gate and dialog/draft
  generation guards; positive PUT/pending acceptance remains source-reviewed;
  Version 43 adds the opt-in rich-editor and dismissal-focus corrections below
- Project-comment POST selects the existing newline-preserving plain-text
  sanitizer; stored comments are not rewritten, new multiline acceptance open
- Resource-edit immutable submission, same-frame pending gate, target/draft/
  dialog-generation guards and inline errors; source-reviewed pending handling,
  positive published PUT/race acceptance remains open
- Project-description rich-editor opt-in with silent controlled synchronization,
  initial/pending inert locks and root-document change checks; exact-opener
  focus restoration for project/resource dialogs, bounded read-only acceptance passed
- Member-directory query, skill/role filters and sort/order in local URLs, with
  native history and reset focus; profile/inspector and layout stay local,
  bounded profile-return/reload/reset acceptance passed
- Native D1 protected poll list/detail GET with caller-only own vote, aggregate
  option counts, typed bounded projections and 10-plus-1 keyset paging; positive
  poll/privacy/paging acceptance unverified
- Native D1 ADMIN poll creation with scoped receipt replay, rolling quotas and
  atomic Poll/options/response fences; positive Create/quota/race acceptance open
- Native D1 poll Vote with scoped receipts, own-vote revision CAS and quotas;
  positive Vote/replay/race acceptance open
- Native D1 ADMIN poll close/hide/unhide with exact snapshot and CAS fences;
  positive moderation/noop/race acceptance remains unverified
- Native D1 ADMIN Mission creation in PRIVATE Spaces with scoped current replay,
  one-open and weekly clock fences; positive Create/replay/DST/race acceptance open
- Native D1 ADMIN Mission close and mission-scoped bookmark/invitation cleanup;
  positive Close/repeat/purge/privacy/race acceptance remains open
- Native D1 normal Mission self-join/leave and scoped pending-invitation settlement;
  positive consent/epoch/capacity/replay/settlement/race acceptance remains open
- Native D1 own Mission contribution Add/Withdraw with scoped receipt and exact
  snapshot fences; positive target/lifetime/replay/privacy/race acceptance open
- Native D1 ADMIN Mission-contribution hide/unhide with same-state and historical
  live-kind rival rules; positive moderation/history/privacy/race acceptance open
- Native D1 Mission bookmark Save/Unsave PUT with fixed access epoch and own
  revision fences; positive stale/global-revocation/race acceptance remains open
- Native D1 ADMIN PRIVATE member Add/Remove with coupled invitation, bookmark
  and participation revocation; positive Add/Remove/privacy/race acceptance open
- Native D1 own invitation detail and protected notice-target resolution, keeping
  pending/terminal/closed/privacy gates; positive published acceptance remains open
- Native D1 invitation candidate authority/snapshot reads with bounded lookahead
  and retained signing contract; positive candidate/LIKE/privacy/latency QA open
- Native D1 invitation preference toggle and complete incoming Pending/Notice
  cleanup; positive preference/noop/overflow/privacy/race acceptance remains open
- Native D1 invitation Send with receipt/suppression/clock/privacy fences and
  atomic incoming cleanup/delivery; positive published acceptance remains open
- Native D1 own invitation Accept/Decline with coupled participation/terminal
  cleanup and full reader fences; positive decision/expiry/privacy/race QA open
- Native D1 ADMIN discussion/reply hide/unhide with exact atomic snapshot/
  projection guards and unchanged-state write-free reads; positive live QA open
- Native D1 normal Pathway Join/Leave with complete own private-badge
  reconciliation and retained history/tombstones; positive mutation QA open
- Native D1 ADMIN Pathway-definition Create with immutable ordered snapshots/
  UUID receipt and atomic sealing; positive published create/replay QA open
- Native D1 Follow POST with existing atomic Follow/FOLLOW-Notice semantics;
  GET/DELETE unchanged, positive published Follow/Notice acceptance open
- Native D1 Event RSVP status/join/leave with complete FIFO/Notice semantics;
  positive published acceptance open, Admin Event PUT/DELETE unchanged
- Native D1 canonical course-asset GET/HEAD ACL reads with unchanged private
  file reader; positive byte/HEAD/storage/ACL acceptance remains open
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
Version 36 additionally ports member discussion/reply creation; Version 49 ports
PRIVATE ADMIN Mission creation; Version 50 ports close and scoped cleanup;
Version 51 ports normal self-join/leave and scoped invitation settlement;
Version 52 ports own contribution Add/Withdraw; Version 53 ports ADMIN
contribution moderation; Version 54 ports own Mission bookmark PUT; Version 55
ports PRIVATE member Add/Remove with coupled revocation.
Version 59 ports Send; Version 60 ports invitation Accept/Decline source.
Version 61 ports existing ADMIN discussion/reply moderation.
Version 62 ports normal Pathway participation; Version 63 ports ADMIN Pathway
definition Create only. Version 64 ports existing Follow POST; Version 65 ports
RSVP GET/POST/DELETE. Version 66 ports canonical course-asset GET/HEAD ACL reads,
not uploads/storage. Admin Event PUT/DELETE and other unported flows remain separate. The [historical v63 source map](D1_CALLBACK_SOURCE_MAP_V63.md)
records callback-route reachability, not 63 live-reproduced bugs.
Positive Space/Mission mutation acceptance remains open. Account/role changes
and other mission mutation flows remain
outside these ports. Other workflows may still use Prisma
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
product document, not part of the Sites source. The separately reviewed
18 October 2026, 00:15 UTC refresh replaces the earlier Version 32 roadmap with
the actual published Version 44 base. It distinguishes delivered source, bounded
live observations, untested variants, technical blockers and proposals. Its
three next packages are legitimate positive Space acceptance, coupled private
mission/access ports, and a safe resource-metadata runtime port. No member names,
search contents, private record identifiers, credentials or internal notes are
included. Earlier release entries that say the Version 32 roadmap was retained
refer to their historical backup; this documentation update supersedes that
roadmap snapshot without changing application source or deployment.

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

## Version 37 project-header layout correction

Version 37 changes only literal className attributes in the existing project
detail page. The header uses a vertically arranged title/metadata block and a
separate wrapping action row, reducing title scale and responsive padding while
allowing long title and metadata text to wrap. Date, author and category icons
remain non-shrinking; existing actions receive 44-pixel minimum target heights.

Removing literal className attributes leaves all remaining source bytes
identical to Version 36. Original stored project title/content, rendered data,
permissions, action handlers, APIs, authentication and scoring are unchanged.
No screenshot, account data, private project content or runtime state is
included in this source backup.

Independent exact-path source review, production typechecking/build and static
artifact/archive checks passed. Deployment succeeded on 17 October 2026 at
23:02:26 UTC. At 23:03 UTC a bounded published readback at 1180 by 757 pixels
showed the unchanged title on one line without mid-word breaking, using a
771-pixel-wide title region and approximately 37.7-pixel type. Three actions
occupied a separate row with 44-pixel heights. Tab focus was visible on all
three actions without activating them. Reload retained the same content and
session. No content edit, action activation or data write was performed.
Mobile/narrow layouts and other long-content or action-behavior variants remain
unverified live. Earlier bounded acceptance and open flow limits remain as
documented above. The curated roadmap is retained byte-identically at its dated
Version 32 base.

## Version 38 project-comment draft revision and lifecycle guard

Version 38 changes only the existing project-detail page. The comment field
tracks text and a monotonically incremented local revision. Submission captures
the draft, and successful completion clears only that submitted revision.
Typing during a pending POST is preserved, including editing back to the same
text. The existing single-pending-request guard remains. An active-view guard
suppresses late success/error UI and state changes after the viewer unmounts.

The complete Version 37 project-header block is byte-identical. Existing
comment API, content payload field, server behavior, permissions, authentication
and scoring are unchanged; the backup contains no comment contents, account
names, project/comment identifiers or screenshots. The revision is local view
state and is not a server request receipt or an exactly-once guarantee.

Independent exact-path source review, production typechecking/build and static
artifact/archive checks passed. Deployment succeeded on 17 October 2026 at
23:12:12 UTC. A bounded ordinary published comment submission at 23:12-23:13
UTC briefly showed pending state, then exactly one new entry and an empty
submitted composer. Reload retained the entry. It was a legitimate comment;
its contents, account details and identifiers are excluded from this backup.
The observable pending-edit window had already ended by the next read, so this
check does not prove edit-during-request preservation. Pending-edit, same-text
edit-back, repeated-submit, late unmount response, account/view transition and
error-path races remain source-reviewed only. The backup did not invoke a
comment write.

Earlier bounded acceptance and open flow limits remain as documented above.
The curated roadmap remains byte-identical at its dated Version 32 base.

## Version 39 Resources and Showcases directory URL-state

Version 39 combines two independently reviewed directory frontend changes,
four files in total. Resources records existing search, category, type and sort
controls in its local URL. Showcases records existing search, project-tag and
sort controls; its tag is validated only after the complete successful project
read. Both query strings remove control characters and cap search at 120
characters. Known sorts/filters are allowlisted; repeated or unknown values
use safe defaults.

The URL is the read state through native popstate subscriptions. Typing replaces
the current history entry; deliberate filter/sort/reset actions push entries.
Updates merge with the actual current URL and preserve an accepted local
fragment. Reset clears query/filter/sort to defaults and returns focus to the
stable search input. No content draft or identity is serialized into a URL.
The existing view-layout toggle remains local.

Existing APIs, authentication, server data and mutations are unchanged.
Resources category/type/sort still apply only to loaded results, with its
existing explanatory notice; this release does not create complete server-side
filtering or new pagination guarantees. Showcases retains existing query fields,
tag matching and sort comparators. The complete project-detail/comment page is
byte-identical to Version 38.

Independent component and exact-union source review, production typechecking/
build and static artifact/archive checks passed. Deployment succeeded on
17 October 2026 at 23:24:43 UTC. At 23:25-23:26 UTC bounded published reads
passed in both directories. Resources search/category and Showcases search/sort
retained their control values and one result after opening a detail and Browser
Back. Reload and the exact UI URL in a temporary same-browser tab retained the
same context and result in each directory. Keyboard reset cleared the URL and
filter state and focused the corresponding stable search input. No data write
was performed. Concrete search contents, record/account identifiers and
screenshots are excluded from this documentation.

Tags, larger result sets/paging, unknown/repeated parameters, independent
Forward transitions, delayed reads, error recovery, mobile and account
transitions remain separate live acceptance gates. The dated curated roadmap
remains byte-identical at its Version 32 base.

## Version 40 scoped project-comment plain-text web links

Version 40 changes the project-comment output line/import and adds one scoped
plain-text link renderer. Explicit HTTP(S) candidates use the existing safe URL
helper, rejecting credentials and unsupported schemes. Bare hostnames remain
text. Prose punctuation is separated without discarding balanced URL brackets;
backslashes, control/bidi/format characters and misleading token prefixes are
rejected as whole tokens. The reviewed final V2 includes U+061C and FEFF handling.
Ordinary comment text remains React text, with no HTML interpretation.

Accepted links retain their visible label, underline, wrapping and keyboard
focus styling; they open a new tab with noopener/noreferrer and an accessible
new-tab description. The existing comment bytes, server API, sanitizer, account
scope, draft-revision/unmount guards, header and project actions are unchanged.
No content migration, automatic fetch or backend mutation is added.

Independent exact V2 source review, production typechecking/build and static
artifact/archive checks passed. Deployment succeeded on 17 October 2026 at
23:30:31 UTC. At 23:31 UTC a bounded published read of an unchanged existing
comment showed exactly one correct HTTPS roadmap link, underline, new-tab
attributes/description and noopener/noreferrer. Native keyboard focus showed a
2-pixel outline. Reload retained the same text and link; the 1180-by-757-pixel
view had no horizontal overflow. No content write or external link opening was
performed. Actual external/new-tab navigation, narrow-layout and further URL
variants remain unverified live. Unicode, punctuation, unsupported-scheme and
credential rejection are source-reviewed; no malicious/race fixture was posted
for this backup. No comment contents, record identifiers, account details or
screenshots are committed.
Earlier bounded acceptance and outstanding flow limits remain as documented.
The curated roadmap stays byte-identical at its dated Version 32 base.

## Version 41 project-edit pending guards and comment newlines

Version 41 combines two independently reviewed source changes in two files.
The existing project-edit dialog captures an immutable submitted snapshot,
including tags, selected file, target project and draft/dialog revisions. A
synchronous single-pending guard disables editable fields and save while leaving
Close available. Source-level generation and active-view checks isolate delayed
responses across dismissal/reopen/unmount. Errors are inline; a selected file
name can remain visible, and success clears only the submitted revision/file
and closes only the matching open dialog. No cross-tab conflict or exactly-once
guarantee is added.

The comment POST route selects the existing newline-preserving comment-text
sanitizer instead of the general whitespace-collapsing text sanitizer. It strips
markup, normalizes CRLF/CR to LF and preserves internal line breaks. The shared
sanitizer implementation and all other comment API bytes are unchanged.
Existing stored comments are not rewritten. Version 40's link renderer and the
complete Version 37 project-header block remain byte-identical. No project or
comment content was changed by the implementation or backup.

Independent component and exact-union source review, production typechecking/
build and static artifact/archive checks passed. Deployment succeeded on
17 October 2026 at 23:41:23 UTC. A subsequent published read-only form check
verified opening, existing values and cancel without a PUT. It also found two
open UX gaps: an existing rich description appears as raw HTML in the textarea,
and Cancel/Escape returns focus to BODY rather than the opener. Those findings
are not a completed edit-flow acceptance result or a data-loss finding.
Separate corrections are planned.

A positive PUT, pending/double-submit or close/reopen race, file replacement,
late unmount/account transition, error path and a newly submitted multiline
comment remain unverified live. The pending/lifecycle and newline behavior is
source-reviewed only; ordinary opening/cancel does not prove it. No synthetic
comment or project rewrite was made for these checks. Private field contents,
record/account identifiers and screenshots are excluded from this backup.
The curated roadmap remains byte-identical at its dated Version 32 base.

## Version 42 resource-edit pending guards

Version 42 changes only the Resources directory page. The existing edit form
captures an immutable target/title/URL snapshot, with a synchronous pending gate
before the request. Native fields/save are disabled while pending, Close stays
available, and another resource cannot replace the active pending target.
Target/draft/dialog revisions and an active-view guard isolate late responses
across close/reopen and unmount. Failures retain the draft with inline errors;
success updates only the submitted resource and closes only the matching
unchanged dialog, otherwise a status notice can preserve the open draft.

Existing resource API, PUT payload shape, authentication, permissions and server
behavior are unchanged. The existing directory URL-state and create-pending
source are retained. There is no cross-tab/exactly-once guarantee or server-side
cancellation promise. The project page, comment API and plain-text link renderer
remain byte-identical to Version 41. The separate project rich-editor and focus
correction is not included; the prior raw-HTML and dismissal-focus gaps remain
open.

Independent exact-path source/integration review, production typechecking/build
and static artifact/archive checks passed. Deployment succeeded on 17 October
2026 at 23:53:06 UTC. A published read-only form check showed unchanged title
and URL values and initial focus on the title. Cancel and Escape dismissed the
form without a PUT. Dismissal focus returned to BODY instead of the Actions
trigger; that remains an open UX gap, not a full focus acceptance pass. Positive
PUT/persistence, pending/double-submit, close/reopen, target/account transition
and error-path races remain source-reviewed only. A normal read or passed build
does not establish those scenarios. No resource content was changed by
implementation or backup. Private field contents, account/record identifiers and screenshots
are excluded. The curated roadmap remains byte-identical at its Version 32 base.

## Version 43 opt-in project rich editor and dialog dismissal focus

Version 43 combines the final independently reviewed ProjectEditor V2 and the
Resources focus patch, three frontend files in total. Superseded V1 was never
integrated. The project description uses the existing rich editor with an
explicit root-document-change opt-in, controlled-content synchronization without
emitting an edit callback, and an initial/pending inert lock. Selection/focus or
editable-configuration synchronization is not treated as a user draft change.
Other Editor callers keep the default non-opt-in mode.

The project and Resources dialogs record their actual opener and restore focus
only if that opener is still connected, the viewer remains active and the dialog
has not reopened. This source increment addresses the raw-HTML description and
BODY-focus findings recorded for Versions 41/42. It does not itself establish
successful published behavior or a full accessibility pass.

Untouched description bytes are retained; genuine rich-text edits use the
existing schema, without an arbitrary legacy-HTML roundtrip guarantee. The
comment API, shared sanitizer, plain-text link renderer and directory URL helper
are unchanged. There is no server-write, schema, authentication, upload,
dependency or stored-content change in this release.

Independent final V2/component and exact-union review, production typechecking/
build and static artifact/archive checks passed. Deployment succeeded on
18 October 2026 at 00:01:28 UTC. At 00:02 UTC bounded published read-only
acceptance passed. Resources Cancel and Escape returned focus to the exact
original Actions button. The project description displayed its two existing
paragraphs as rich text rather than HTML, with initial title focus and keyboard
Tab into the editor. Project Cancel and Escape restored focus to its Edit
button. All values remained unchanged; no typing or PUT was performed.
Positive project/resource PUT, pending locks, Undo/IME/paste, close/reopen and
unmount/account races, genuine rich-text modification/new saving and legacy-
content variants remain unverified live. This bounded readback addresses the
checked Versions 41/42 presentation/focus findings without proving full edit
acceptance; earlier historical checks retain their release-specific scope.
Private descriptions, resource fields, account/record identifiers and
screenshots are excluded. The curated roadmap stays byte-identical at its
dated Version 32 base.

## Version 44 member-directory URL-state

Version 44 changes the existing member page and adds one pure URL-state helper.
Search, repeated skill/role selections, sort key and direction are represented
in the local directory URL. Search removes control characters and is capped at
120 characters; scalar repeats use defaults and repeated filters are deduplicated.
Sort/direction are allowlisted. Dynamic skill/role choices remain intact while
loading or on read failure and are validated only after the existing complete
successful member read.

The URL drives the view through native popstate subscriptions. Typing replaces
the current history entry; deliberate filter/sort/reset actions push entries.
Updates merge with the actual current URL to avoid stale rapid toggles/Back
state, retaining an accepted local fragment. Reset clears query/skill/role
filters and returns focus to the stable search input while preserving the
existing sort/direction semantics. Profile/inspector selection and grid/list
layout remain local; no member identity is added as directory state.

Existing member reads, filtering/comparators, profile behavior, authentication,
permissions, APIs, contact/membership data and scoring are unchanged. No member
data, concrete search words, profile identifiers or screenshots are included in
this backup, and no profile or data write was made.

Independent exact-path source review, production typechecking/build and static
artifact/archive checks passed. Deployment succeeded on 18 October 2026 at
00:12:14 UTC. At 00:13 UTC a bounded published UI-created query/role/sort/order
combination survived opening the own profile and Browser Back with the same
values and one result. Reload retained the context. Keyboard reset removed
query and role and focused the stable member-search input; the sort/direction
remained as designed. No data write was performed. Skill filters, independent
Forward, exact new-tab shared-link behavior, multiple selections, unknown or
repeated parameters, delayed/error reads, larger datasets, mobile and account
transitions remain unverified live. Concrete member identities and search text
are excluded. The project and Resources edit source is byte-identical to
Version 43; its bounded read-only acceptance and untested write/race variants
retain their prior scope. The separate roadmap refresh below is an additional
curated documentation exception, not part of the Sites source.

## Version 44 documentation-only refresh

On 18 October 2026 the user-requested roadmap was replaced by the reviewed
00:15 UTC Version 44 edition, and this guide received the bounded member-read
result reported after the original backup. Only these two documents changed.
All other curated path bytes/modes, the published Sites source pin, runtime
content, deployment, configuration and workflow triggers are unchanged. The
roadmap is product documentation, not another Sites release or full runtime
acceptance. It retains explicit write/race, private-mission/access and metadata
blocker limits. No build, functional test or new GitHub CI run accompanies this
documentation-only update.

## Version 45 native D1 poll list/detail reads

Version 45 changes two backend source files. Existing poll list/detail reads
delegate to one protected primary D1 SELECT per request, retaining stored access
and hidden-content boundaries, caller-only own vote, aggregate option counts,
current DTOs and 10-plus-1 keyset pagination. Typed key/poll/option rows have
pretransport byte budgets and strict date/key/projection checks; malformed
cursors cannot expose content before current access is checked.

No voter identities or durable receipts are selected or exposed. Aggregate
changes in small groups can still permit inference; this is not an anonymity
guarantee. Existing API routes, cursor parser, mutation helpers and shared
access/read helpers are unchanged. Poll Create, Vote and Moderate still use
legacy callback transactions and remain outside this read-only port.

Independent exact-path source review, production typechecking/build and static
artifact/archive checks passed. Deployment succeeded on 18 October 2026 at
00:24:44 UTC. At 00:25 UTC a bounded directory/session read showed zero Spaces
without alerts or horizontal overflow. No poll was reachable: this is explicitly
not positive poll GET acceptance. Existing genuine poll list/detail, private,
hidden/revocation, caller vote/count and pagination behavior remain unverified
live. No Space, poll or vote was created to manufacture a passing fixture; no
local SQL/application/functional execution was performed for this backup.

The curated roadmap remains byte-identical to the separately reviewed v44
edition dated 18 October 2026, 00:15 UTC. Its v44 poll-read source blocker is
historical: v45 ports list/detail GET only, not poll creation, voting, moderation,
or a complete Space/mission flow. Other roadmap blockers and bounded live-QA
limits remain separate; no updated application flow is inferred from the
retained roadmap date/base. No private content, voter/account identifiers or
screenshots are included.

## Version 46 bounded native D1 poll creation

Version 46 changes only the createPoll delegation and its new native helper,
two backend files. Current stored ADMIN/readable-space authority, scoped
creator/digest receipt replay before both rolling 24-hour quotas, and creation
of a Poll with 2-8 Options are fenced with exact atomic snapshots and bounded
response assertions. Replay is a zero-write current projection, including
hidden/closed state, within the scoped receipt's lifetime. There is no permanent
deduplication or lifetime exactly-once guarantee.

Only proved rollback or an exact scoped receipt conflict plus a changed fresh
authorized snapshot can retry. Unknown commit/network, invariant, unrelated
UUID/FK failures and postcommit transport handling cannot repeat the mutation.
Native reads, Vote/Moderate, parsers, routes, shared helpers, schema and UI remain
byte-identical; Vote and Moderate still require separate ports.

Independent exact-path review, production typechecking/build and static artifact/
archive checks passed. Deployment succeeded on 18 October 2026 at 00:36:17 UTC.
At 00:36:43 UTC a directory/session read showed zero Spaces without alerts.
No poll was created; this is explicitly not positive CreatePoll acceptance.
Positive Create/replay/quota/concurrency/private/hidden acceptance is unverified;
source/build checks are not a positive live write test.
No local SQL/application/functional execution or new engagement data is part of
this backup. Poll read/privacy/pagination acceptance also remains open.
The refreshed v44 roadmap is retained byte-identically at its dated base; the
new read/Create source ports do not establish a complete polling or Space flow.

## Version 47 bounded native D1 poll Vote

Version 47 changes only votePoll delegation and its native helper, two backend
files. Current visibility/membership, scoped receipt replay, own-vote revision
CAS, person/minute quotas, receipt insertion and fresh caller-only counts/DTO
share exact atomic snapshot fences. Only an existing matching receipt replays
without a write; a new same-option request advances revision and quotas.
Ambiguous commit/network/invariant errors cannot automatically retry. Reads,
Create, Moderate, parsers/routes/shared/schema/UI remain byte-identical;
Moderate still uses the legacy callback. No new anonymity or scoring rule.

Independent source review, production typechecking/build and static artifact/
archive checks passed. Deployment succeeded on 18 October 2026 at 00:43:56 UTC.
At 00:44:16 UTC the directory/session regression showed zero Spaces and no
alerts, explicitly not a Vote test. No vote was cast. Positive Vote/replay/quota/
CAS-race/private/hidden/closed acceptance remains unverified live. No local
SQL/app/functional execution or artificial engagement data was used. Prior
read/Create limits and the byte-identical dated v44 roadmap remain in force.

## Version 48 bounded native D1 poll moderation

Version 48 changes only moderatePoll delegation and its native helper, two
backend files. Readable-Space 404 precedes stored ADMIN 403 and exact-poll 404.
Close retains its first timestamp without changing the moderation revision;
same-state hide/unhide is zero-write before revision checking, real changes
CAS-increment once. Authority, complete bounded DTO and raw snapshots are
fenced atomically. No reopen, receipts, quotas, rewards or new powers. Same-state
idempotency does not promise lasting exactly-once effects. Only a proved
preguard rollback plus a changed freshly authorized snapshot can retry;
unknown commit/network/invariant/constraint failures cannot. Native Reads,
Create, Vote, parsers/routes/shared/schema/UI remain byte-identical.

Independent source review, production typechecking/build and static artifact/
archive checks passed. Deployment succeeded on 18 October 2026 at 00:51:46 UTC.
At 00:52:04 UTC the directory/session read showed zero Spaces and no alerts;
this supplies no positive poll acceptance. No poll mutation was performed.
Positive Admin/noop/CAS/close/hidden/private/concurrency acceptance remains
unverified live, as do prior positive poll read/Create/Vote gates. No local
SQL/app/functional execution or artificial engagement data was used. The
byte-identical dated v44 roadmap describes its historical base, not v48 scope.

## Version 49 bounded native D1 Mission creation

Version 49 changes three backend files: createMission delegation, its native
helper and append-only pure reader adapters. Original reader SQL/projector/
read functions remain byte-identical. PRIVATE access and stored ADMIN checks,
scoped creator/digest receipt replay, one-open state and database-clock weekly
insertion fences share exact native-batch assertions. Replay precedes week/
open checks and returns the complete current consent/profile/participant/
contribution/bookmark-access projection, without creating participation,
bookmarks, invitations or notifications. Known scoped receipt/one-open UNIQUE
failures enter sticky replay-only fallback; no receipt cannot cause a fresh
INSERT. Week validation precedes open conflict. Snapshot retries require a
changed freshly authorized state; known clock rollback reevaluates ordinary
week input. Unknown commit/network/global-ID/FK/invariant failures never retry.
Total batch attempts are bounded to four. Other mutations, parsers, weekly
clock, schema, routes/UI and poll ports remain unchanged.

Independent source review, production typechecking/build and static artifact/
archive checks passed. Reviewed SQL-size metadata is 15,120/17,595 bytes;
this corrects an earlier estimate without changing source or scope digest.
Deployment succeeded on 18 October 2026 at 01:06:16 UTC. At 01:06:34 UTC the
directory/session read showed zero Spaces and no alerts, providing no positive
Mission acceptance. No Mission or other engagement data was created. Positive
Create/replay/week-rollover/DST/one-open/privacy/race acceptance remains open.
No local SQL/app/functional execution was used. The byte-identical v44 roadmap
retains its dated base; the source port does not establish full mission flows.

## Version 50 bounded native D1 Mission close

Version 50 changes only closeMission delegation and its native helper, two
backend files. Current PRIVATE/stored ADMIN authority does not require creator
identity or membership. First close sets its timestamp; repeat close
retains it while still clearing all mission bookmark settings and scoped
invitation notices, invitations, request and access rows. Notice absence is
asserted before the invitation identity set is deleted. No participation,
contribution, global bookmark-access epoch or invitation-attempt counter is
changed. Exact pre/post snapshots and the bounded current detail DTO are
fenced in the same native batch; current profile/consent projection is retained.
Only the named SQL-qualified first-guard rollback with a changed freshly
authorized snapshot may retry. Unknown commit/network/constraint/invariant
failures and malformed successful results cannot replay. Existing reader,
Create, other mutations, parsers/routes/clock/schema/UI and poll ports are
byte-identical. This source port does not establish full mission flows.

Static bounds are 10 statements for open and 8 for already-closed batches,
at most four attempts: a conservative 45 submitted statements including all
failed-batch statements and reads. A first-guard-abort execution count is not
the submitted bound or a provider billing/cost claim; cleanup database work
can grow and time out. Independent review, production typechecking/build and
static artifact/archive checks passed. Deployment succeeded on 18 October 2026
at 01:17:10 UTC. The 01:17:33 UTC directory/session read showed zero Spaces and
no alerts; no Close or purge was performed. Positive Close/repeat/private/
foreign-creator/notice-cleanup/concurrency acceptance remains open. No local
SQL/app/functional execution or artificial engagement data was used. The dated
v44 roadmap remains byte-identical, with prior positive live gates still open.

## Version 51 bounded native D1 normal Mission participation

Version 51 changes only normal setMissionParticipation delegation and its native
helper, two backend files. Current PRIVATE access, USER/member join authority,
consent epoch, duplicate-active replay, closed/capacity and leave precedence
are preserved. Successful joins settle incoming pending invitations; leaves
settle outgoing ones, including expired/invalid pending records. Notices are
cleared before identity scrubbing, and every matching revision is checked.
Repeated/no-op success still performs scoped settlement. No new invitation
acceptance port: its shared transaction-local join core remains byte-identical.

A local hypothetical reader view substitutes exactly seven Participation
references to derive the complete bounded After projection, including legacy
six-to-five leave exposure. The actual final guard uses original reader SQL.
Stable operation time and exact pre/post fences cover consent, profiles,
contributions and own metadata. Only the named first-guard rollback plus a
changed freshly authorized snapshot retries; unknown commits, transport,
UNIQUE/FK/CAS/end-invariant and malformed successful results never replay.
Batches submit 8 statements on change, 6 on replay, at most four attempts and
37 submitted statements including failed batches/reads. Cleanup work may grow;
this is no provider cost or full-flow guarantee. Reader/Create/Close, other
mutations, parsers/routes/shared/schema/UI and poll ports remain byte-identical.

The initial typecheck caught a narrowing error; final V2 uses an already
validated string key, preserving runtime semantics and every SQL byte.
Independent final review, production typechecking/build and static artifact/
archive checks passed. Deployment succeeded on 18 October 2026 at 01:31:13 UTC.
At 01:31:38 UTC the directory/session read showed zero Spaces and no alerts;
no join, leave, settlement or other data mutation was performed. Positive
consent/epoch/capacity/replay/settlement/privacy/race acceptance remains open.
No local SQL/app/functional execution was used. The dated v44 roadmap remains
byte-identical and does not assert these later ports or positive live gates.

## Version 52 bounded native D1 own Mission contributions

Version 52 changes only contributeToMission/withdrawMissionContribution
delegation and their native helper, two backend files. Add preserves current
PRIVATE access, USER/member consent, receipt/digest/visibility, closed, target,
live-kind and lifetime precedence. Withdraw requires readable PRIVATE access
and the exact own historical contribution/epoch, without imposing current
join/open/learner gates. Each batch changes at most one Contribution row.
Foreign BUILD_ON rows are never changed; dependent visibility, progress and
own metadata are fully reprojected. No audit, notifications or reward writes.

A helper-local five-reference Contribution view derives bounded hypothetical
After; the final fence uses the genuine original actual reader. UUID/time stay
stable. Only a named SQL-qualified first-guard rollback or exact scoped request/
live-kind UNIQUE plus changed freshly authorized state can recover. UNIQUE
sets sticky replay-only mode; unknown commits, global UUID/FK/CAS/end-invariant,
transport and malformed successful results never replay. Write/replay batches
have 4/2 statements, at most four attempts and a conservative 21 submitted
statements including reads/failed batches. This is no provider cost guarantee.
Reader/Create/Close/Participation, moderation, invitations, bookmarks, parser/
sanitizer/routes/shared/schema/UI and poll ports remain byte-identical.

A function-arity issue was corrected before the final source freeze; final
static maximum arity is 28. Independent final review, production typechecking/
build and static artifact/archive checks passed. Deployment succeeded on
18 October 2026 at 01:43:42 UTC. The 01:44:12 UTC directory/session read showed
zero Spaces and no alerts, with no Add/Withdraw test or other data mutation.
Positive Add/receipt/target/lifetime/historical withdrawal/replay/privacy/race
acceptance remains open. No local SQL/app/functional execution was used. The
dated v44 roadmap remains byte-identical; full mission-flow QA is not implied.

## Version 53 bounded native D1 Mission-contribution moderation

Version 53 changes only moderateMissionContribution delegation and its native
helper, two backend files. Current PRIVATE/stored ADMIN, scoped mission/target,
same-state and raw historical live-kind rival rules are preserved. A change
writes only the target hiddenAt; same-state replay is write-free and retains
the existing timestamp. Unhide never reverses withdrawal, reactivates consent/
epoch or changes foreign BUILD_ON rows. Dependent visibility/progress is
reprojected. No receipts, quotas, revisions, rewards or other resource writes.

A mission-local five-reference Contribution view derives the complete bounded
After; the genuine original actual reader supplies the final atomic fence.
Stable time cannot manufacture changed-snapshot retry evidence. Only the named
SQL-qualified first-preguard rollback plus changed freshly authorized state
may retry. Exact live-kind UNIQUE is terminal 409, without replay fallback;
unknown commits, other constraints/CAS/end-invariant/transport and malformed
successful results never replay. Write/same-state batches use 4/2 statements,
at most four attempts and 21 conservative submitted statements including
reads/failed batches; these are no provider billing/cost assurances. Original
reader/Create/Close/Participation/Add/Withdraw, invitations/bookmarks, parser/
sanitizer/routes/shared/schema/UI and poll ports remain byte-identical.

Independent final review, production typechecking/build and static artifact/
archive checks passed. Deployment succeeded on 18 October 2026 at 01:51:53 UTC.
At 01:52:14 UTC the directory/session read showed zero Spaces and no alerts;
no moderation or other data mutation was performed. Positive moderation/noop/
historical-rivalry/target-visibility/privacy/concurrency acceptance remains
open. No local SQL/app/functional execution was used. The dated v44 roadmap
remains byte-identical; full mission-flow or historical-content QA is not implied.

## Version 54 bounded native D1 Mission bookmark PUT

Version 54 changes only setMissionBookmark delegation and its native helper,
two backend files. Current live account 401 precedes open PRIVATE Mission and
actual membership 404, for every role. Fixed client global accessEpoch and
exact own setting absence/revision preserve stale 409 behavior. Each accepted
PUT increments own revision, even for the same saved value; Save overwrites
savedAt, Unsave retains a NULL tombstone. Global Access is materialized at zero
or same-epoch CAS, never reset. No auto-advancing client versions or consent,
participation, invitation, reward or notification writes.

One bounded nine-scalar snapshot and six-statement atomic batches assert live
authority and exact final own savedAt/revision/accessEpoch before commit. Four
attempts submit at most a conservative 29 statements including failed batches/
reads, without provider cost assurances. Only the named first-preguard SQL
rollback or exact own first-create UNIQUE plus changed freshly authorized
snapshot may recover. Unknown commits, other constraints/CAS/end-invariant,
transport or malformed successful results never retry. Parser/OwnBookmark/
readOwn/bookmarkTransaction/revokeSpaceMissionBookmarks remain byte-identical,
as do all other Mission ports, APIs/reader/schema/UI and poll ports. Member/
account revocation callback chains are unchanged and separately unported;
this PUT port does not prove end-to-end global revocation.

Independent final review, production typechecking/build and static artifact/
archive checks passed. Deployment succeeded on 18 October 2026 at 02:00:54 UTC.
At 02:01:12 UTC the directory/session read showed zero Spaces and no alerts;
no bookmark or other data mutation was performed. Positive Save/Unsave/stale/
global-revocation/concurrency acceptance remains open. No local SQL/app/
functional execution was used. The dated v44 roadmap remains byte-identical;
full mission-flow or member/account revocation acceptance is not implied.

## Version 55 bounded native D1 PRIVATE member Add/Remove

Version 55 changes three files: a dedicated native helper and the existing
member POST/DELETE delegates. Stored ADMIN precedes PRIVATE scope. Add requires
a live target; duplicate membership is write-free and preserves joinedAt
without reading/validating that date. Re-add never resets revocation fences.
Remove is coupled and effectful for live nonmembers/repeated DELETE: the sole
current open Mission's InvitationAccess and complete pending/notice settlement,
global BookmarkAccess plus all this-Space settings including closed-Mission
tombstones, all this-Space active participation optout, then membership deletion.
Missing target retains the existing bookmark-cleanup early return. Explicit
overflow/error order and fail-closed multiple-open legacy state are retained.

Whole sets use no ID list, loop, quota LIMIT or partial commit chunks. Notices
are asserted absent before source identity scrubbing; exact final authority,
fences and no-remainder assertions share one atomic batch. Other-Space settings,
contribution content and existing non-NULL optout timestamps remain untouched.
Only named SQL first-guard rollback or exact eligible first-create UNIQUE plus
changed fresh authority/state may recover. Unknown commits, other constraints/
CAS/end-invariant/transport and malformed successful results never retry.
Remove submits at most 43 helper statements; including at most two unchanged
authentication SELECTs gives a source-derived bound of 45, not measured runtime
queries, billing or cost. Set-based database work may grow and time out.

Native member GET/cursors/candidate search, parsing/auth/response blocks and
all existing Mission/invitation/bookmark/participation/close/account/role/schema
helpers remain byte-identical. Account/role and invitation-decision callbacks
are separate, unported flows. Independent final review, production typechecking/
build and static artifact/archive checks passed. Deployment succeeded on
18 October 2026 at 02:13:33 UTC. At 02:13:57 UTC the directory/session read showed
zero Spaces and no alerts, with no member or revocation test/data mutation.
Positive Add/Remove/revocation/privacy/overflow/concurrency acceptance remains
open. No local SQL/app/functional execution was used. The dated v44 roadmap
remains byte-identical; full member/account revocation acceptance is not implied.

## Version 56 bounded native D1 invitation detail/target reads

Version 56 changes two backend files: append-only detail/target native readers
and their facade delegates with resolver documentation. The original 12,044-byte
reader/list/Preference GET/cursor prefix is intact, as is the facade write prefix
and decision implementation. Current USER/private membership precedes detail;
authorized closed Mission returns unavailable before own-invitation lookup.
Terminal own outcomes are minimal and lazy, without pending settings/timestamps/
profiles. Pending uses one complete current epoch/membership/expiry/setting
predicate; capacity FULL changes canAccept only. No new signing requirement.

Detail uses one bounded primary SELECT. A nonempty resolver uses one primary
SELECT for at most 50 targets, retaining the original pre-deduplication length
check outside the sanitized reporting boundary. It returns only effective own
ID-based actions, without profiles, titles or capacity queries. Escaped/raw
projection and bind budgets fail closed. No invitation, notification-read mark,
notice transaction, preference or engagement writes are introduced. Candidate
search, token/signing/secret configuration, all write/decision paths, APIs/DTOs/
errors and existing Mission/member/poll ports remain byte-identical. Remaining
global notification/account/role callbacks are not claimed repaired.

Independent final review, production typechecking/build and static artifact/
archive checks passed. Deployment succeeded on 18 October 2026 at 02:24:28 UTC.
The bounded 02:24-02:25 UTC read regression showed zero Spaces and empty
All/Unread notification views without alerts; Mark all was disabled. No notice
was opened or created. This supplies no positive detail/resolver acceptance.
No invitation, notice or other data action was performed. Positive published
pending/terminal/closed/full/revocation/privacy/50-target acceptance remains
open. No local SQL/app/functional execution was used. The dated v44 roadmap
remains byte-identical; these read ports imply no write or full-flow acceptance.

## Version 57 bounded native D1 invitation candidate reads, final V2

Version 57 changes two backend files: append-only authority/candidate readers
and invitationCandidates import/body. The existing 28,436-byte reader prefix,
all list/preference/detail/resolver paths and other facade/pure/write/API/parser/
DTO/schema bytes remain intact. Authority-only primary SELECT precedes the
unchanged q parser and existing key check. A second primary SELECT revalidates
all authority and supplies every consumed sender/recipient fence together.
Live 401, USER/private/member 404, closed 409 then active-consent 404 precedence
is retained, including nonnegative legacy consent epoch zero for candidates.

Unescaped %q% retains wildcard %, _, literal backslash and ASCII folding.
Native LIKE is selected only for complete patterns up to 50 UTF-8 bytes; longer
patterns use correlated, NUL-aware code-point greedy matching without extra
name-size filters, recursion LIMIT, partial results or retries. Final V2 fixes
four decoder comparisons after the initial review blocker; it uses SQLite's
same UTF-8 code-point decoder for literals. V1 is superseded. Database resource
or timeout errors remain failures, without promising measured latency.

Eleven-match lookahead suppresses recipient profiles/fences before their
budgets are checked. No receiving-optin, prior-invite, capacity or quota filter
is added. Existing secret lookup, selection MAC/token matcher and 13-element
MAC tuple remain unchanged; no secret was read/logged/changed for this work.
No persistent access, invitation or notification write is ported here.
Independent final V2 review, production typechecking/build and static artifact/
archive checks passed. Deployment succeeded on 18 October 2026 at 02:36:25 UTC.
At 02:36:46 UTC the directory/session read showed zero Spaces and no alerts;
no candidate search, live token, invitation or other data action was performed.
Positive candidate/LIKE/NUL/privacy/race/latency acceptance remains open. No
local App/SQL/matcher/crypto/functional execution or new CI was used. The dated
v44 roadmap remains byte-identical; write/full-flow acceptance is not implied.

## Version 58 bounded native D1 invitation preference toggle

Version 58 changes two backend files: a dedicated preference helper and only
setInvitationPreference import/delegation. Live account 401 then stored USER
404 and fixed expectedRevision precede same-value behavior. Absent false/zero
and same-value requests remain write-free, including same-value MAX revision.
Genuine toggles increment revision once while preserving accountEpoch, even
at MAX. Only true-to-false revokes every incoming PENDING invitation across
all Missions and deletes its SYSTEM invitation notices. Notice absence is
asserted before ten nullable identity/fence fields are scrubbed. Setting
overflow precedes pending overflow. No access/participation/bookmark/request/
Mission-attempt or global-account-epoch write is introduced.

One native batch has 3 statements enabling or 7 disabling. Four attempts and
five bounded scalar preflight reads submit at most 33 helper statements, or
35 including the unchanged source-auth bound of two SELECTs. These are source
bounds, not measured runtime/billing costs. Cleanup has no row limit, ID list,
per-row loop or partial commits; large sets may hit native limits and fail
closed. Only the named first-guard SQL rollback or eligible own first-create
UNIQUE plus changed fresh authority/state may recover. Client versions never
catch up automatically; unknown commits, other constraints/CAS/end-invariant,
transport and malformed successful results never retry or prove cleanup.

Native reads/candidates, signing/pure helpers, Send/Decide and every other API/
parser/DTO/member/close/account/schema/UI path remain byte-identical. Other
write and account-wide revocation contracts remain separate. Independent final
review, production typechecking/build and static artifact/archive checks passed.
Deployment succeeded on 18 October 2026 at 02:45:47 UTC. The bounded 02:46 UTC
read regression retained session, zero-Space directory and unchanged Settings.
Normal Missions-to-own-invitations navigation showed the existing opted-out
presentation, unchecked consent, disabled switch and empty inbox without alerts.
This supplies no positive toggle/cleanup acceptance. No preference toggle,
opt-in/out, invitation, token or other production data action was performed.
Positive preference/noop/revision/overflow/all-Mission-cleanup/privacy/race
acceptance remains open. No local App/SQL/crypto/functional execution or new CI
was used. The dated v44 roadmap remains byte-identical; full-flow QA is not implied.

## Version 59 bounded native D1 invitation Send, final V2

Version 59 changes only a dedicated native Send helper and sendMissionInvitation
import/body delegation, two backend files. Current USER/private actual member/
open/active sender consent and exact own input fences precede receipt replay;
matching digest replay precedes caps, key and target. Fresh work reserves an
attempt and target-free receipt. The existing trusted verifier closure keeps
key material out of SQL/snapshots/DTOs and is requested after replay/cap gates,
before target branches. Invalid targets remain masked; valid targets receive
four materialized/no-op-CAS fences. Existing MAC tuple and uniform ACK remain.

Eligible delivery performs complete cross-Mission incoming expiry/revocation
cleanup, asserts matching SYSTEM notices absent before ten-field scrubbing,
then applies caps and atomically creates the seven-day Invitation plus one
generic Notice. Sampling classifications are revalidated at the first atomic
preguard; no second cleanup/selection clock is imposed at commit. Numeric zero
and supported absolute-date/fraction/offset cases retain their source contract.
One first-primary session does not mean each later SELECT independently forces
primary; the atomic preguard revalidates every consumed stage fact.

Only qualified snapshot/clock/applicable scoped-first-create SQL rollback plus
changed fresh authorized facts may recover. Request UNIQUE enters sticky
receipt-only fallback. Generated clocks/IDs do not manufacture database-change
evidence. Unknown commits, unrelated constraints/CAS/end-invariant/transport or
malformed successful results never retry or read back as success. Up to two
5/10/14/18-statement batches and staged reads give 45 helper/47 including auth
source submissions, not measured runtime/billing costs. Full set-based cleanup
is uncapped and may fail the entire batch under native resource limits.

V1 typecheck TS2367 found an unreachable redundant ACK branch; V2 removes it
with every SQL byte unchanged. Independent final V2 source review plus separate
Privacy/Clock/Retry review passed, as did final production types/build and
static artifact/archive checks. Native reads/candidates/preference, signing/
secret helpers, Decide/acceptance/revocation, API/parser/schema/UI remain
byte-identical. Deployment succeeded on 18 October 2026 at 03:12:45 UTC. The
bounded 03:13 UTC directory/session and empty-notification read showed no alerts;
Read all was disabled. This supplies no positive delivery/cleanup/token proof.
No live
invitation, token, secret or other data action was performed. Positive Send/
replay/suppression/cleanup/clock/quota/overflow/privacy/race acceptance remains
open. No local App/SQL/crypto/functional execution or new CI was used. The dated
v44 roadmap remains byte-identical; source reviews/build are not runtime proof.

## Version 60 bounded native D1 invitation Accept/Decline, final V2

Version 60 changes only the dedicated decision helper and decideMissionInvitation
import/body delegate, two backend files. Current USER/private actual membership/
open/scoped-owned invitation precedes exact terminal same-decision expected+1
write-free replay; other cases require pending/exact revision. Initial invalid
atomically latches terminal state and clears exact SYSTEM notices before ten-field
scrub, then maps to generic 404 without four fence writes. Initially valid gets
all four materialization/no-op-CAS fences and a fresh expiry sample before own
conditional Join or notice cleanup. Late expiry retains fences, commits EXPIRED
then maps to 404. ACCEPT uses allowDuplicate=false epoch/active/max/capacity
semantics, never the ordinary Join wrapper. The unconditional genuine-reader
endguard forbids any transient staged PENDING state from committing.

Beyond those fences, only the target Invitation, own Participation and exact
notices change. Reader/
normal Join wrapper/core, Read/Send/Preference/Candidates/signing/secret/State/
revocation/API/parser/schema/UI stay byte-identical. Seven local Participation
references derive full hypothetical After; actual final readset uses the original
reader, including current profiles, future-epoch content, hidden own metadata,
peer BUILD_ON targets, progress, bookmarks/global epoch and soft-window fields.
Existing reader invalidState, row/response budgets and manifest strictly below
1.5 MB remain; no trimmed DTO or arbitrary malformed-legacy parity is promised.
Derived SQL createdAtMs is bounded and raw dates separately validated, without
an added JS-truncation/SQL-round equality barrier or reader/sort change.

Malformed/relative/NUL expiresAt reaching the helper is initial-invalid/nonexpired
and may be REVOKED, not a universal date-validation abort. Old Prisma decoder
admission of such raw values is not fully established; no malformed live datum
is alleged. Noninteger raw numeric dates may fail strict scalar validation.
A profile/readset rollback crossing expiry cannot retry from time-only projection
disappearance without changed scalar evidence: conservative availability remains.
Only own qualified first-snapshot/applicable missing-row UNIQUE rollback plus
changed freshly authorized facts allows at most two batch attempts. Domain
markers map only proved SQL rollback. CAS/end-invariant/FK/other constraints,
transport, unknown commit and successful-result decode never retry or imply
success by readback. One first-primary session does not independently force every
later SELECT primary; consumed facts are revalidated by the atomic preguard.
Accept/Decline/initial-invalid batches have 15/13/5 statements, 32 helper or
34 including unchanged auth source submissions, not measured billing/latency.
Complete operations can exceed native limits and fail atomically.

V1 is superseded solely by a 36-byte TypeScript keyof cast fixing TS7053/TS2322;
all 154 expanded SQL texts remain unchanged. Both independent final V2 source
and Privacy/Clock/Retry passes, production types/build and static artifact/archive
checks passed. Deployment succeeded on 18 October 2026 at 03:38:56 UTC. Bounded
03:39:32 UTC published reload/navigation retained session and empty notifications/
open-Mission overview without visible error. No decision, participation, token,
secret or data action occurred. Positive Accept/Decline/replay/initial-invalid/
late-expiry/fence/capacity/future-epoch/privacy/race acceptance remains open.
No local App/SQL/crypto/functional execution or new CI was used.

The README's added branch-scope section and replacement USER_FLOW_ROADMAP.md
are separately requested, privacy-reviewed user documentation, not Sites source.
The roadmap is dated to actual v60 and distinguishes delivered code, bounded
observations, open acceptance, remaining callback/DNS blockers and proposals.
Existing main setup/gallery bytes stay intact; no new competitor research or
full mission-flow acceptance is claimed.

## Version 61 bounded native D1 discussion/reply moderation, final V2

Version 61 changes only the dedicated content-moderation helper and two existing
moderation PATCH route imports/body delegates, three backend files. Reversing
exactly those sections reconstructs the previous routes byte-for-byte. Stored
ADMIN 403 precedes raw caller-ID-format/Space 404; Space dates normalize before
the mode-specific target 404. ADMIN needs no membership or visibility-enum
filter. Discussion/Reply scope includes its parent Space, without a hidden-parent
or author filter. The full current-author DTO includes all visible-only replyCount
for discussions, without request/digest/private fields. Same-state checks raw
hiddenAt NULL presence and preserves exact hiddenAt/updatedAt with no UPDATE.
A genuine change sets only target hiddenAt and explicit updatedAt using one
stable operation time or NULL; no monotonic/equal-original-clock guarantee.
There is no parent/Space bump, cascade, report, reward, audit, notice, receipt,
revision, edit/delete feature or new moderation authority. All other source
reads/creates, polls/missions/invitations, shared helpers, schema and UI are intact.

Prevalidated full DTO, native snapshot guard/CAS/changes-one and actual final
projection guard share one atomic batch; no partial/truncated response. Bounded
native row/response budgets remain explicit legacy limits: unsupported/oversized
data fail closed, without arbitrary malformed-database parity. Absolute dates
support date-only UTC midnight, missing-zone UTC, space-to-T, +HH normalization
and compact +HHmm, variable fractions, zoned minute precision and valid 24:00
within finite shared JavaScript conversion. Finite numeric milliseconds,
including fractions/zero, stay raw in snapshot/CAS; only the DTO uses TimeClip.
Flags/counts remain integers. This adds no unused derived-SQL createdAtMs
restriction, calendar/offset narrowing, content/author-ID regex or create sanitizer.
Date strings are bounded to 1,024 bytes; numeric dates to finite absolute
8,640,000,000,000,000 ms. Existing native row/response bounds apply as well.

Only own SQL-qualified first-preguard rollback plus actually changed freshly
authorized facts allows one retry, at most two snapshots/batches. A second
proven own conflict maps to 409 without a third read. Whole-cause-chain deny-first
classification and exact D1_/SQLITE_ allowlist exclude invariant, constraints/FK,
unknown markers, RPC/TLS/DNS/network, unknown commit and successful-result decode;
there is no readback-success inference. One first-primary session has an initial
primary read and subsequent session consistency; each later SELECT is not
independently forced primary. All consumed authority/scope/date/content/profile/
count facts are atomically revalidated before writes.

Independent exact-aggregate source bounds cover all 37 expanded SQL texts:
7,853 maximum SQL bytes, highest slot/trimmed binds 25, arity 2, compound terms 5,
18 snapshot/19 final columns, four discussion/five reply rows. Change/noop batches
submit four/two statements. At most ten helper or twelve including unchanged
auth source submissions is a conservative bound, not measured cost or latency.
Native limits can still fail the complete operation atomically. V1 is superseded
only by bounded local absolute DateTime normalization; all 37 SQL texts stay
byte-identical. Final V2 source GO, independent aggregate counterpass, production
types/build and static artifact/archive checks passed. Deployment succeeded on
18 October 2026 at 03:56:00 UTC. Bounded published 03:56:15/27 UTC reload and
observed navigation retained session and empty Mission/Space overviews without
visible errors. No moderation, fixture, hide/unhide cycle or data action occurred.
Positive ADMIN/private/hidden-parent/same-state/date/race/demotion/rollback/
visibility acceptance remains open. No local App/SQL/function tests or new CI.

The user-facing roadmap is a separate curated documentation exception, updated
to actual v61 and moderation delivered/QA-open scope. README scope/setup/gallery
bytes and all previously approved documentation facts are preserved. No blanket
mission/feature completion or new competitor-research claim is made.

## Version 62 bounded native D1 normal Pathway participation, final V2

Version 62 adds only a dedicated helper and the existing participation POST/DELETE
route import/body delegate, two backend files. Reversing exactly those sections
reconstructs the entire route. Origin 403 precedes session 401 outside its try;
raw caller/requested IDs, ignored body, errors/status/no-store stay intact.
Current stored USER and non-test checks give 403 for both methods, sealed-target
absence 404. First/rejoin alone preserves the source-proven existing Prisma.join([])
generic 500 on zero-course definitions, then missing Course 409 before non-NULL
publication 409. Duplicate-active Join and every Leave bypass those availability
checks. This retained empty-definition error is source-derived, not a new live finding.

Every request reconciles ALL own private participations, including other,
unsealed and opted-out paths, using complete raw course sets and active
COURSE_COMPLETED ledger facts. Only Participation/Change rows are written:
no new/recomputed course reward, enrollment, public UserBadge, progress, notice
or certificate. First Join inserts version-zero defaults then optional private
AWARDED version one, returning 201. Rejoin updates joinedAt/clears opt-out,
preserving firstAward/history/version absent a badge transition, returning 200.
Leave retains its row/tombstone/firstAward; an active private badge clears with
opt-out and one increment plus REVOKED/OPTED_OUT event, never a second generic
reconciliation revoke. Qualification needs current eligible User, active
participation, at least two raw courses and every credit. There is no added
upper-four-course, course availability or enrollment gate on reconciliation.
Int32 MAX is legal without an increment; a planned overflow fails 500. New
version is old+1, never history maximum. Full histories remain except appended
events. Complete Before mismatch wins before global UUID/own pair-version
collision checks; collisions fail closed before writes without relying on live
UNIQUE/trigger installation.

The full target DTO retains immutable ordered course snapshots, current truthy
publication availability (NULL/empty unavailable), enrollment/active credits,
participation dates/private badge and newest twenty target events version-DESC.
It omits User/creator/change IDs, versions, other-user fields and public badges.
No target participation plus unavailable maps 404 only after qualified final
domain abort rolls back complete matched own After/events, never postcommit read.
SQL budgets the complete typed authority, availability, own cohort, courses,
reward semantic facts and history before private transport. Cardinality and
bidirectional scalar-IS anti-joins compare whole raw Before/After sets through
bounded manifests, including own additions/removals. Target insert precedes
FK history; events use plain INSERT; exact-old-state combined updates, immediate
changes assertions and actual complete After/Event/DTO endguard are atomic.
A context row keeps missing-target assertions nonempty. No row-loop, prefix
truncation, domain cohort cap or broad malformed-legacy parity is introduced.

Bounded absolute DateTime conversion retains reviewed date-only UTC, ISO/UTC
defaults, minute precision, variable fractions, valid 24:00, +HH/+HHmm/+HH:mm
offsets and finite fractional epoch milliseconds including zero. Raw dates stay
in scalar-IS/no-op fences. There is no unused derived-SQL-ms barrier, monotonic
clock or equal-original-time guarantee. Complete raw SQL row/result limits are
200,000/1,200,000 bytes; typed manifest 1,400,000 bytes, bindings strictly below
1,500,000 bytes, with existing bounded response/date/Int/version gates. Unsupported,
corrupt or oversized legacy inputs fail closed before writes; no partial reconcile.
All own cohorts can grow without a domain cap and full operations can hit native
time/DB limits and fail atomically. Live custom SQLite 0013 retention/sealing/
append-only trigger/CHECK installation is unknown; generated Drizzle omits them.
The helper directly preserves these invariants without any schema installation
or live DDL claim. The pre-existing Mein Lernweg/Journey, native overview,
Admin Pathway definitions, course rewards and all other APIs/schema/UI stay intact.

At most four snapshots/four batches. Only own first-preguard SQL-qualified
rollback plus genuinely changed freshly authorized complete snapshot permits
retry; final proved conflict is 409 with no fifth read. Bounded whole-cause-chain
deny-first classification excludes history/UUID/trigger P2004, any constraint/FK,
BUSY/locked, CAS/endguard, transport/unknown commit and successful-result decode.
Unknown commit outranks nested domain markers; no readback-success inference.
One first-primary handle has an initial primary snapshot, then session consistency;
later SELECTs are not separately forced primary. Atomic preguard revalidates all
consumed facts. No request receipt/client epoch is added: delayed POST can rejoin
and delayed DELETE opt out a currently active row. Badge-only stateVersion does
not provide client freshness or ABA protection.

Independent full aggregate counterpass bounds all seven unique SQL statements:
15,123 maximum UTF-8 SQL bytes, highest bind slot six, arity three, snapshot/final
columns 29/30, budget-implied transport rows at most 292 including context.
All syntactic branches, including unreachable combinations, are bounded to
2/4/4/6/4/6/6/8 batch statements. At most 36 helper or 38 including unchanged auth
source submissions is a conservative bound, not runtime/billing/latency cost.
V1 was blocked; final V2 corrects snapshot-before-collision CASE priority, two
type-only row casts and the source-proven zero-course first/rejoin generic 500.
No new retry class or two-to-four course cap. Exact V2 source GO, independent full
aggregate counterpass, production types/build and static artifact/archive passed.
Deployment succeeded on 18 October 2026 at 04:15:46 UTC. Bounded published
04:16:04/08 UTC session reload and observed Lernpfade navigation retained empty
Space/Pathway overviews without visible error. No Join/Leave/badge/reward/fixture
or data action occurred. Positive first/rejoin/leave/same-state/cross-path badge/
history/availability/role/test/race/version/rollback/privacy acceptance remains
open. No local App/SQL/function/date/crypto tests, new CI or browser work by this
backup. The curated user roadmap records v62 as delivered with those QA gates
open, preserving Admin definition callback scope and prior approved facts;
README scope/setup/gallery bytes stay unchanged.

## Version 63 bounded native D1 ADMIN Pathway-definition Create

Version 63 adds only one create helper and the existing admin POST import/body
delegate, two backend files. Exact reversal reconstructs every old route byte.
GET/definitionView, canonical 4,096-byte body/input handling, origin/session/error/
no-store, pure validators, shared readers, rewards/schema/UI and all other APIs
stay intact. Origin 403 then session 401 are outside the try; body/shape 400
precedes stored-current ADMIN 403. No new ID regex/test/instructor/member gate.

Global request UUID is the immutable definition receipt. Every plan/replay checks
current stored ADMIN and exact canonical creator/title/description/badgeLabel,
sealed presence and FULL historical ordered course-ID count/sequence before ANY
fresh course/material eligibility. A matching receipt returns original ordered
titles/positions/createdAt, 200, without repairing noncontiguous historical
positions, writing the receipt, rerunning course checks or creating rewards.
Conflicting/unsealed/foreign receipt gives 409; absent sticky receipt gives the
existing creation-changed 409. New snapshots use positions zero through N-1.
New-only existence of ALL input courses precedes input-order eligibility:
truthy publication, free/null/nonpositive price, rewardEligible, truthy approval
revision, unchanged valid-quiz-leaf and exact fingerprint checks. Earlier source
errors precede irrelevant lower-stage payload budgets. Complete active live
CourseContent id/course/parent/type/content/order sets retain original pure
courseLeaves/contentQuiz/quiz-validation/approval-revision semantics for orphan,
cycle, QUIZ/malformed quiz-like and ASSIGNMENT material. No publication DAG,
payload normalization, reward/participation write or prefix material limit.
Canonical sorting for retry evidence occurs only AFTER source pure eligibility.

One native atomic batch guards exact current ADMIN, occupied UUID, full Course
including title and full material; inserts unsealed header, asserts exact one;
inserts all two-to-four child snapshots set-based, asserts exact N/full children;
sets seal only, asserts exact one/full sealed header, then unconditional actual
receipt/complete source-After. Missing target cannot skip assertions. Counts,
unique IDs and scalar comparisons detect additions/deletions/archive/reparent/
type/content/order changes without relying on live immutability triggers. Only
LearningPathway/LearningPathwayCourse change. Full raw receipt/public DTO are
prevalidated before mutation; actual receipt JSON is CASE-gated behind complete
After and compared outside retry catch.

The original separate postcommit Prisma availability query and definitionView
remain unchanged. Non-NULL postread availability differs from truthy new-course
eligibility. Read/serialization/availability can still return 500 AFTER known
commit or receipt resolution. This is no atomic response-availability or delivery
guarantee. There is no automatic new create; a later explicit same-UUID client
retry can resolve the durable retained receipt.

Operational availability is reduced to THREE complete native attempts versus
the old four. Each full plan uses at most six reads/eight batch statements.
Only own qualified first SQL-snapshot rollback plus actually changed freshly
authorized COMPLETE consumed source manifest permits another plan; timestamps
are excluded from change evidence. Third ordinary snapshot exhaustion gives
generic 500 without another read. An own attributed occupied-request marker
has separate priority after current ADMIN and ALWAYS allows exactly one sticky
current-ADMIN/full-receipt-only read, including on final attempt three. No Course/
material/new creation follows occupancy. Whole bounded cause-chain deny-first
classification excludes unknown commit/network/BUSY, any constraint/trigger P2004,
UUID/FK, CAS/end-invariant/other markers; there is no generic UNIQUE retry class.
Malformed success decode and postcommit failures never trigger write retry or
readback-inferred success. One first-primary handle establishes the first primary
read; later stage reads have session consistency rather than separate primary
force. Atomic complete preguard is authoritative before writes.

Native raw-row/read budgets are 200,000/1,200,000 bytes, escaped typed manifest
1,400,000, binding strictly below 1,500,000 and complete batch wire 8,000,000 bytes.
Bounded absolute dates retain reviewed date-only UTC, minute precision, fractions,
valid 24:00, +HH/+HHmm/colon offsets and finite fractional epoch milliseconds
including zero, with raw equality preserved. No derived-ms gate, original equal
createdAt/sealedAt or monotonic-clock guarantee. Complete material has no domain
row cap; operational native limits can fail the whole operation. Unsupported,
oversized/corrupt legacy values fail closed without truncation or arbitrary
unbounded-data parity. Custom SQLite 0013 seal/retention/append-only triggers and
CHECK installation on live D1 are unknown; generated Drizzle omits migration-only
protections. Direct invariants do not install schema or prove live DDL.

Both exact immutable source passes, including independent Receipt/Privacy/
Authority/Retry, passed. Twelve SQL shapes have maximum 4,909 UTF-8 bytes, six
dense bindings, function arity sixteen, two compound terms, seven result columns
and eight batch statements. Three plans plus one sticky receipt read bound
43 helper + two source-auth + one unchanged postread = 46 source queries;
this is not measured runtime/billing/latency cost. Production types/build and
static artifact/archive checks passed. Deployment succeeded on 18 October 2026
at 04:33:18 UTC. Bounded published 04:33:34 UTC reload retained session and settled
empty Pathway overview without error or forms/dialogs. No definition, approval,
material/reward/participation fixture or data action occurred. Positive legitimate
ADMIN/create/replay/conflict/material/order/final-attempt collision/trigger/race/
rollback/postcommit-availability acceptance remains open. No local App/SQL/pure/
date/crypto/function tests, CI or browser work by this backup. The separately
curated roadmap updates v63 Create-delivered/QA-open scope and retains all prior
approved facts; README scope/setup/gallery bytes remain unchanged.

## Version 64 bounded native D1 Follow POST

Version 64 adds only a narrow helper and original POST callback replacement plus
import, two backend files. Exact reversal reconstructs every prior route byte.
Original params await outside try, session/self and Prisma pair-duplicate read,
success/error interpolation, complete GET/DELETE and global proxy remain intact.
Existing proxy origin/cookie handling is unchanged; no new handler Origin/body/
ID-format/nonempty/role/test/preference/quota gate. Both living Users are required
by the existing FK-connect contract. Session 401, self 400, original duplicate
400 precede the native mutation. No profile/email/role/key data are transported.

Follow and exactly the old FOLLOW Notification commit in one first-primary native
six-statement batch. Unconditional throwing preguard fences duplicate pair, both
Users, nullable current target-name type/budget and generated global ID collisions.
Plain Follow INSERT, immediate changes-one/exact ID/full row/pair cardinality,
plain Notice INSERT and changes-one/exact full new Notice precede unconditional
actual final guard of both living Users/full Follow/Notice/current target-name
projection. Missing rows cannot suppress assertions. Session-name notice text
interpolation, including literal null/undefined, is passed unchanged, without
reread/sanitize/fallback. Success retains current nullable target-name interpolation,
including literal null. No REPLACE/upsert/IGNORE, old-notice query/repair/delete,
counter/history/reward/receipt or newly invented engagement operation.

There are NO automatic retries, preflight/helper reads, postcommit readback, UUID
regeneration or receipts. Duplicate successful POST stays 400 without another
Notice even if an old Notice is missing. True unfollow/refollow can create another
historical Notice; there is no lifetime exactly-once guarantee. Follow absence
after an ambiguous result cannot prove failure because DELETE may race while the
Notice remains. Only own SQL-qualified firstguard markers through bounded whole-
cause deny-first/same-detail D1_ERROR/SQLITE_ERROR classification mint original
P2002/400 (duplicate/generated ID collision) or P2025/404 (missing User). Foreign/
mixed/constraint/invariant/timeout/transport/unknown-commit failures stay generic
500 without top-level Prisma code. Malformed-success decode remains outside catch,
never retries or creates a successful receipt. A500 may follow known/uncertain
commit; no readback-success inference or automatic reconciliation by absence.

Two UUIDs and one stable valid ISO UTC+00:00 operation timestamp are chosen once.
No stored-date parsing or original equal-clock guarantee is introduced. Raw
row/input 200,000-byte, complete result/route-response 1,200,000-byte and complete
SQL/bind wire 8,000,000-byte ceilings are fail-closed operational limits, not product
name rules or platform allowances. Whole escaped result/response is bounded before
writes; nothing is shortened/truncated. Unsupported/oversized legacy names can
500 before writes. Live DDL/FK/index/custom-trigger installation remains unknown;
owned exact cardinality guards do not prove arbitrary extra trigger side effects
absent or repair historical notice consistency.

Both exact source passes, including independent Privacy/Domain/NoRetry, passed.
Six SQL shapes total 4,146 bytes, maximum 2,170; max binds 33, arity two, compound
one, two result columns. Six helper statements plus unchanged auth two/duplicate
read one = nine source statements, not measured runtime/billing/latency cost.
Production types/build and static artifact/archive checks passed. Deployment
succeeded on 18 October 2026 at 04:51:39 UTC. Bounded published 04:51:55 UTC reload
retained session and settled empty Pathway overview without errors/forms/dialogs.
No Follow/unfollow/Notice/contact/engagement fixture or data action occurred.
Positive legitimate Follow+Notice/duplicate/missing/nullable-name/race/unfollow-
refollow/rollback/privacy acceptance remains open. No local App/SQL/pure/date/
crypto/function tests, new CI or browser work by this backup.

## Historical callback source map, separately curated documentation

The [v63 callback source map](D1_CALLBACK_SOURCE_MAP_V63.md) retains its exact
historical source base and all 63 intended exposed route/method records plus five
obsolete compatibility methods. It is a compact public documentation exception,
not additional Sites source or a live failure log. Follow POST is specifically
annotated as ported since v64; no wholesale completion or 63 live errors are claimed.
Repository-relative source links are present in this backup; private paths and
unshipped investigation-artifact links are omitted. Chat/native authoring/formatting,
filesystem/codec upload leads and independent retention gates remain separated.
The curated user roadmap links the same map and updates actual v64 scope while
retaining previous approved facts. README scope/setup/gallery bytes stay intact.

## Version 65 bounded native D1 Event RSVP

Version 65 adds only a dedicated helper plus one import and three facade bodies:
readEventParticipation/joinEvent/leaveEvent. Exact reversal reconstructs the old
facade; shared requireEventAccount/lock/promote/ownState and generic participation
wrapper remain intact. RSVP routes/parser/headers, Event UI/list/create/ICS,
notification target readers/auth/proxy/schema/other APIs stay byte-identical.
Admin Event PUT/DELETE still use the original callback-bound lock/promoter.
Current stored account absence is 401 before Event 404; no new role/test/member/
private/preference/ID-regex or receipt gate. Existing session-outside-try and
POST bodyless/only-waitlist 1,024-byte parsing order stay unchanged. ATTENDED
DELETE gives 409 before cleanup; fresh closed admission 409. Only own qualified
prewrite ID/Notice collision maps the existing concurrent-change 409; internally
duplicate generated IDs are checked before writes, other raw failures remain 500.

GET returns the same ten-field own state/booleans, aggregate counts, own ordinal,
capacity and final closure. All non-CANCELLED statuses including ATTENDED occupy
seats. Active attendance wins over stray own queue; WAITLISTED requires no active
attendance. No ticket identity/time, names/email/profile or foreign attendee data
leave the helper. GET uses one primary snapshot statement with strict decoder.

FIFO has no product/prefix cap. Independent SQL earliest-inactive-ticket-per-user
ranking derives the S-th distinct winner cutoff, or all when unlimited/underfilled.
DELETE removes every own ticket before ranking and subtracts its cancelled seat.
JavaScript independently consumes the entire selected prefix using an active-user
map; later repeated-owner tickets become active skips, not extra seats/notices.
Already-full/past promotion consumes none. Transport includes only full consumed
prefix/caller identities and relevant attendee facts, not irrelevant suffix
profiles/timestamps. Exact cutoff/set/multiplicity and scalar occupancy/suffix-
count/own-position facts are guarded. Final After uses the BEFORE prefix rather
than incorrectly recomputing an empty After prefix. No per-ticket SQL or chunks.

Each native atomic batch has unconditional exact preguard, Event.updatedAt
UPDATE/assert, optional grouped absent-attendee INSERT and existing-status UPDATE
with assertions, complete consumed/own queue DELETE/assert, exact grouped actual
winner Notice INSERT/assert, optional genuine caller AUTOINCREMENT queue INSERT
as LAST DML, then unconditional actual complete After/Notice/ticket/authority/DTO
guard. Missing joins cannot skip assertions. Existing attendee IDs/tombstones
remain. Queue creation sets no explicit/predicted ID, MAX+1 or sequence reset;
actual last_insert_rowid, positive Int32/global cardinality/pair/tail/time are
checked immediately and finally. INTEGER-PK/AUTOINCREMENT/nonreuse/FK/index/trigger
parity are unchanged source-DDL prerequisites, NOT verified installed live DDL.
sqlite_sequence is neither read nor edited; arbitrary extra trigger effects are
not ruled out. Only real FIFO winners get the old deterministic ticket-ID EVENT
notice. No notice for direct/queue join, cancel or active skip; no historic Notice
repair/delete, IGNORE/REPLACE/upsert, preferences, rewards or receipt.

Three distinct source clock stages are retained: A after small context/early
active replay; B immediately before full prefix snapshot, fixing the whole FIFO
decision; C sampled by bounded UTC-ms strftime in final SELECT AFTER all DML,
compared with already JavaScript-normalized Event milliseconds. No later future
barrier: A-future/B-past may still admit directly, earlier successful action can
return closed=true. FULL commits complete FIFO repairs and then raises 409 outside
retry catch; it has no C/state-DTO dependency. Successful replays update Event.updatedAt.
GET C belongs to its single snapshot SELECT. Raw dates are guarded without SQL
date parsing/derived-julianday ordering. Bounded absolute date-only/minute/second/
fraction/short/compact/colon-offset/SQLite-UTC and numeric zero/fraction-TimeClip
forms remain supported. Unused historical Event/queue timestamps are not gates.
New valid UTC+00:00 timestamps have no equal-original-clock/monotonic guarantee.

At most TWO complete native attempts versus original four is an explicit
availability reduction. Initial context-to-prefix mismatch conservatively gives
409 without retry/mutation. Only own SQL-qualified FIRST snapshot rollback plus
demonstrably changed freshly authorized complete relevant facts allows attempt
two; clock/read-shape alone is insufficient. Second actual conflict 409 has no
third read. ID/Notice collision never regenerates IDs or retries. Generic BUSY,
UNIQUE/FK/constraint/CAS/end-invariant/timeout/transport/unknown commit/result/
malformed success never retries or readback-infers success. Strict decoder and
commit-then-FULL409 are outside catch. No durable receipt, historic idempotency
or notice repair; explicit later POST after DELETE can rejoin anew.

Operational limits are raw/input records 200,000 bytes, context escape reserve
16,384, complete result 1,200,000, manifests 1,400,000 and complete wire 8,000,000;
bindings stay below 1,500,000 and at most 100 occurrences/SQL below 100,000 bytes.
Full FIFO work remains unbounded in rows, time and cost; native limits can fail
the complete batch. The unchanged v65 unconditional combined now + raw userId +
eventId input guard rejects over 200,000 bytes even on active POST replay and
full-event repair/commit-then-409 paths. This is an explicit conservative input/
legacy availability ceiling; v65 V1 source GO and bytes remain unchanged. Unsupported malformed/oversized legacy values fail closed,
never truncate or partially reconcile. Positive Int32 ticket, supported non-NULL
enum/capacity and bounded date domains apply, not arbitrary malformed-data parity.
Ambiguous own/relevant duplicate attendee-pair rows or inactive own repeated-ticket
projection fail closed; repeated foreign-owner tickets, active caller with retained
later duplicate and DELETE-all-own tickets are handled. Irrelevant active own
position uses internal zero/null DTO rather than becoming another legacy barrier.

Both exact source passes and production types/build/static artifact/archive gates
passed. Eighteen SQL templates/64 conservative topologies have maximum 12,795 SQL
bytes, binds 25, arity three, compound two, context fields 14/snapshot columns 21.
At most fourteen batch statements/two preflight reads per attempt give 32 helper
plus unchanged auth two = 34 SOURCE statements; GET helper one/auth total three.
These are unmeasured source bounds, not scanned/written-row, runtime/billing cost.
Deployment succeeded on 18 October 2026 at 05:19:23 UTC. Bounded published
05:19:58 UTC reload/navigation retained session, settled empty Pathways and Events
overview with no visible October/upcoming events, RSVP panels/forms/dialogs or
visible errors. No Event/RSVP/queue/cancel/promotion/Notice/contact/engagement
fixture or data action occurred. Positive legitimate status/direct/full/waitlist/
replay/ATTENDED/cancel/FIFO/duplicate-prefix/capacity/race/Notice/rollback/privacy/
clock acceptance remains open. No local App/SQL/pure/date/crypto/function tests,
new CI or browser work by this backup.

Roadmap adds v65 delivered/QA-open scope; historical v63 source-map method rows,
counts/base stay intact with only an explicit v65 RSVP annotation. No all-Events
or all-callbacks-fixed claim. README and prior approved facts stay intact.

## Version 66 bounded native D1 canonical course-asset GET/HEAD reads

Version 66 adds only one read helper and canonical asset-route import/call
replacement of its old callback/serialization-retry block, two source paths.
Exact reversal reconstructs the original route. Session/params/path-ID envelope,
404/catch/security/cache/GET/HEAD behavior stays intact. H5P chooser/access,
uploads/imports, private filesystem, asset-reference parsers, path/progress/grade
pure helpers, authoring/publication/auth/proxy/schema/UI remain byte-identical.
No unpublished H5P change is included.

Every potentially authorizing read uses a NEW first-primary session and ONE
coherent typed SELECT. Current live actor plus Course/same-course asset: instructor
identity or stored ADMIN gets author access without publication/enrollment/path.
Otherwise a truthy active pointer/matching current publication and original exact
asset-reference parsing are required. Cover takes absolute precedence, requires
exact live image URL and is intentionally anonymous. Content needs actual actor/
enrollment and an exact referenced published TEXT/explicit-null node with original
outer path unlocked, including parent/container references. No session-role/test
hint, public/member/reward/price gate or simplified ACL fallback is added.

Bootstrap never authorizes. Prior confirmed content context gates transport only;
each snapshot rechecks current authority/pointers/metadata/enrollment/material.
A bound revision manifest must exactly match freshly computed COMPLETE current
source manifest before its own grade bits can be used. Changed-source preparation
can recompute at most five snapshots; no mixed-snapshot grade evidence or stale
fallback. Unchanged publicationPathNodes/courseLeaves/assignment parser/revision/
coursePathAccess functions retain complete current id/parent/order topology only,
not equality of titles/types/content/course prose to publication payload. Current
live type/body defines revisions. Nonblank assignment prompt needs latest own
same-course/content/current-revision attemptNumber and latest decision sequence
GRADED with score >= stored submission passingScore. No best-grade, current prompt
threshold, publication-ID, quiz-attempt or progress-mirror shortcut. Other leaves
use current progress revision. Inner completion then outer release/prerequisite
passes remain separate; no shared completion hardening. Declared pair/attempt/
decision-sequence uniqueness underpins latest-grade parity; installed live DDL/
indexes/FK/triggers and corrupted duplicate ties remain unverified.

Inner original completion clock is sampled before each SELECT, with completion
release-independent. Outer release clock follows final coherent snapshot and
completion before unchanged full private-file read. Final fresh SELECT linearizes
ACL, no durable cached rights. Every future GET/HEAD freshly authorizes; no promise
that later revocation retroactively changes an already-authorized file read.
Original root/private/symlink/O_NOFOLLOW/MIME/stat/size/read checks stay unchanged;
HEAD still reads the complete validated file, omitting only response body. No
end-file release gate, R2/remote-fetch mapping, upload/token or storage change.
Actual file existence/persistence and image-byte delivery remain separate open
gates: removing this callback barrier does not establish functioning uploads.

All denied/concurrent/provider/oversized/storage paths retain route 404, including
the original missing-file/symlink handling. Session lookup outside try remains.
Provider errors are sanitized before existing logging, no private SQL/material
response. Only successful old asset bytes/type/size leave helper, never grade/
answer/profile/raw snapshot data. No database write or DB/storage/transport-error
retry. Planning ceiling is five fresh-primary reads, author/cover/early-deny normally
one and ordinary content preparation three. Auth maximum two gives SEVEN source
statements, not measured runtime/billing/network cost or preserved four retries.

One 10,073-byte SQL template serves every variant; max rows 502/columns 25, binds
nine, arity two, compound three. Existing publication 500-node/524,288-byte ceiling,
400,000 content bytes, 786,432 complete live bytes and 524,288 raw manifest bound
apply. Canonical manifest maximum 344,001 bytes; raw result row limit 1,945,600 and
escaped complete response limit 8,388,608. Actor/metadata fields have operational
1,024-byte bounds. Conservative raw-bound-values/request-wire reconstructions are
1,059,204/6,367,345 bytes, not platform allowance or measurement. Exact full same-
statement wire/rowset accounting avoids oversized intermediates; only valid branch
rows are projected. No prefix response, field shortening or arbitrary malformed/
oversized legacy parity. Author/cover avoid irrelevant topology/grade work. Full
grade/history scan work remains unbounded in rows/time/cost; provider limits fail
closed with the original 404 rather than a partial or weaker authorization.

Both exact source GOs and production types/build/static artifact/archive checks
passed. Deployment succeeded on 18 October 2026 at 05:55:07 UTC. Positive published
author/private-file/anonymous-cover/enrolled-content/release/prerequisite/current-
assignment-grade/GET/HEAD/body/header/revocation/privacy/storage acceptance is
OPEN. No image byte, HEAD, ACL or persistence pass is inferred from session or
overview checks. No local App/SQL/pure/date/crypto/function tests, new CI, browser
or live-data actions by this backup. The separate v65 input clarification changes
documentation only. User roadmap and historical source map add bounded v66 scope;
README bytes stay unchanged. This backup updates only cloudflare-sites.

## Keeping the branches separate

Keep Cloudflare-only dependencies, auth, D1 queries and deployment scaffolding
on `cloudflare-sites`. Do not merge this branch wholesale into main. Port a
shared product fix to main separately only after checking its standard runtime.
This branch leaves the repository's default branch and first-time setup intact.

Never commit real `.env` files, `.openai/hosting.json`, credentials, local
Wrangler/Miniflare state, database/WAL/SHM files, generated Prisma output,
`node_modules`, `dist`, `.next`, uploads, or private QA artifacts.
