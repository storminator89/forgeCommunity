# Experimental Cloudflare / Sites branch

This guide applies only to the `cloudflare-sites` branch. The default
[`main` branch](https://github.com/storminator89/forgeCommunity/tree/main) keeps
the standard Next.js self-hosted setup, including Docker with SQLite or
PostgreSQL. First-time users should start there.

This branch is a separate, partial adaptation for Cloudflare Workers and Sites:
Vinext/Vite, a request-scoped Prisma D1 adapter, app-owned session cookies, and
D1-specific SQL for selected flows. Its source snapshot starts from upstream
`c442bb09e0e46684f19bb6d6dff061e13078111d`; it does not import Sites history or
runtime data. This GitHub snapshot backs up the published Version 57 source
`271ab20145634328407b5c0c68ff2a54f2f7afd6`. Version 57 deployed successfully on
18 October 2026 at 02:36:25 UTC. Native D1 invitation candidate reads, final V2,
are live; positive candidate/LIKE/NUL/privacy/race/latency acceptance remains
unverified. Existing signing/write/global-notice paths remain separate and
unchanged. The curated roadmap retains its dated v44 base.
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

The published Version 57 source includes the existing bounded ports below,
inherited from Version 56, plus native D1 invitation candidate reads described
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
Positive Space/Mission mutation acceptance remains open. Invitation creation/
acceptance, account/role changes and other mission mutation flows remain
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

## Keeping the branches separate

Keep Cloudflare-only dependencies, auth, D1 queries and deployment scaffolding
on `cloudflare-sites`. Do not merge this branch wholesale into main. Port a
shared product fix to main separately only after checking its standard runtime.
This branch leaves the repository's default branch and first-time setup intact.

Never commit real `.env` files, `.openai/hosting.json`, credentials, local
Wrangler/Miniflare state, database/WAL/SHM files, generated Prisma output,
`node_modules`, `dist`, `.next`, uploads, or private QA artifacts.
