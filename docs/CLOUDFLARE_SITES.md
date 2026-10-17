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
`6a6b1d7f0cedc28cec2e47e76e575ef87ec8e7a2`. It is experimental and does not
claim feature parity with main.

## Requirements and setup

- Node.js 24 and npm, following the checked-in lockfile.
- Your own Sites project and its deployment access. A generic `wrangler deploy`
  setup and standalone Cloudflare account deployment are not provided here.
- A D1 binding named `DB`. The `BUCKET` R2 binding is declared by the hosting
  template, but existing upload code is not yet migrated to durable R2 storage.
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

The current Version 13 source includes these bounded ports. Live QA is ongoing;
source implementation and publication do not establish complete runtime or
all-page visual coverage.

- D1-backed private course creation and draft editing, authoring-list/detail
  reads, review, publication, learner content reads, enrollment, progress,
  quizzes and certificates
- Comment reads and atomic comment-plus-notification writes for other post
  authors; comment counts are derived from stored comment rows
- Latest own quiz-attempt display on reopening, with an explicit repeat action
- Embedded licensed certificate fonts and bounded wrapping for names/titles
- Post/comment text formatting, multiline content and composer presentation
- Protected Space/mission reads, privacy-scoped mission overview and personal
  learning-pathway reads
- Public publication/content-ID preconditions for learner writes and
  foreground-aware polling for chat, notifications and selected directories
- Centrally loaded notification CSS, replacing nested runtime CSS imports
- Article category selection and inline validation, preserved form input and
  error feedback, browser navigation, and public About content
- Repository-owned Inter font assets with relative CSS URLs and their OFL
  license, replacing checkout-origin font references

This remains a partial adaptation. Course deletion, assignments and grading,
formative practice, course Q&A/analytics, and Space/mission mutation flows are
unported. Other workflows may still use Prisma transaction patterns that D1
does not support. Do not infer support for every write flow from this scope.

Persistent image uploads, private chat/course assets, and H5P package storage
still depend on Node filesystem/native image-processing APIs. They are not
supported as durable Workers storage. Declaring R2 does not make those paths
R2-backed. No PostgreSQL or ordinary file-backed SQLite runtime is supported on
this branch. Managed-Linux helper scripts depend on external Sites tooling;
their standalone wrapper is not part of this source snapshot. The inherited
`db:seed` script and standard-runtime test fixtures are also unported and may
still import native bcrypt or NextAuth dependencies absent from this branch.

Validation for this work is limited to the published Site and the exact source
build reported with its release. Version 13 passed production typechecking
and its build; live regression checking is still in progress. No new local
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
