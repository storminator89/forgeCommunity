# Experimental Cloudflare / Sites branch

This guide applies only to the `cloudflare-sites` branch. The default
[`main` branch](https://github.com/storminator89/forgeCommunity/tree/main) keeps
the standard Next.js self-hosted setup, including Docker with SQLite or
PostgreSQL. First-time users should start there.

This branch is a separate, partial adaptation for Cloudflare Workers and Sites:
Vinext/Vite, a request-scoped Prisma D1 adapter, app-owned session cookies, and
D1-specific SQL for selected flows. Its source snapshot starts from upstream
`c442bb09e0e46684f19bb6d6dff061e13078111d`; it does not import Sites history or
runtime data. Its frozen Sites source is
`0e31b1b9474f4eab2e2f6e758a1d9e02bf0b32b6`. It is experimental and does not
claim feature parity with main.

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

The current Version 20 source includes these bounded ports. Live QA is ongoing;
source implementation and publication do not establish complete runtime or
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
- Public publication/content-ID preconditions for learner writes and
  foreground-aware polling for chat, notifications and selected directories
- Centrally loaded notification CSS, replacing nested runtime CSS imports
- Article category selection and inline validation, preserved form input and
  error feedback, browser navigation, and public About content
- Repository-owned Inter font assets with relative CSS URLs and their OFL
  license, replacing checkout-origin font references

This remains a partial adaptation. Course deletion, assignments and grading,
formative practice, course Q&A creation/replies/moderation/solution writes,
course analytics, and Space/mission mutation flows are unported. Other workflows may still use Prisma transaction patterns that D1
does not support. Do not infer support for every write flow from this scope.

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

Avatar/profile images, post-file uploads, course assets and H5P package storage
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
Its production typechecking/build passed; its published UI read-check is
still in progress. It makes no codec or API change. No new local
test suite or GitHub CI run is
part of this work. The inherited standard pipeline is unchanged: pushes run
only for main/master, and no pull request is opened for this branch. Recheck
workflow triggers before opening any future pull request. A passed build is
not evidence that untested product flows work. Record live checks separately,
without committing account data, cookies, screenshots containing private
data, or database files.

## Keeping the branches separate

Keep Cloudflare-only dependencies, auth, D1 queries and deployment scaffolding
on `cloudflare-sites`. Do not merge this branch wholesale into main. Port a
shared product fix to main separately only after checking its standard runtime.
This branch leaves the repository's default branch and first-time setup intact.

Never commit real `.env` files, `.openai/hosting.json`, credentials, local
Wrangler/Miniflare state, database/WAL/SHM files, generated Prisma output,
`node_modules`, `dist`, `.next`, uploads, or private QA artifacts.
