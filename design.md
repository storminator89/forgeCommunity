# ForgeCommunity design system

This is the shared visual contract for the multi-page redesign. Preserve existing routes, German copy intent, authorization, data workflows, and content. The visual language should feel like a calm, useful place to work with other people, not a marketing template.

## October 2026 screenshot direction

The user supplied community, member, project and event-calendar references and requested the same design across every page. All 49 App Router page routes are mapped in `artifacts/redesign/page-coverage.md`: 47 rendered views plus two redirect routes. Shared wrappers, learner/author variants, public/auth pages and staff views all participate. These references supersede earlier preferences for open, ruled directories and decorative clay navigation. Keep Inter, real data, permissions and all existing workflows. Use the shared `HeroBanner`, `PageContainer` and `SurfaceCard` in `components/discovery.tsx`, alongside existing shadcn controls. App discovery pages may use a compact mint/blue banner; the community banner includes an original decorative vector landscape. Forms and reading surfaces stay white and quiet. Keep the original `/images/brand/forge-community-mark.webp` logo unchanged. Use individually generated ImageGen outline artwork as theme-aware monochrome masks in the sidebar, a selected mint navigation row, compact white entity cards and contextual member previews with existing fields only. Do not display invented online indicators or message actions.

The active anchors are petrol `#075B63`, ink approximately `#142E3B`, background `#F6FAFB`, white, mint and pale blue. Semantic HSL channels remain in `app/globals.css`; `tokens.css` contains shared spacing, radii, shadows, banner/landscape colors and motion. This preserves the established Tailwind/shadcn and chart contracts. The reference table below follows the active palette; runtime CSS is authoritative.

- Layout: discovery workbench with a stable 264px collapsible sidebar, compact topbar and up to 1600px content canvas. Community uses a feed and activity column; directories use filter toolbars and cards; editors use quiet sections.
- Type: existing Inter, 400 body / 600–650 headings, compact tracking. Page titles 28–32px, banner headlines 26–36px, card titles 18–20px.
- Visual review: match the references' spacing and hierarchy without adding unsupported controls, counters or backend behavior. Use the same surface language in dark mode.
- Page families: discovery banners for directories; entity-led mint/blue headers for profiles and details; bounded white reading/forms/editor surfaces; task-specific chat, calendar, course workspaces and administrative tables. Preserve scrollports in fixed-height app layouts.
- Events: month/week/list, real upcoming previews, synchronized category selectors, timezone-aware period filters, and a right filter/help column. Calendar export uses the existing per-event ICS download. The reference’s subscription control is not shown without a supported subscription endpoint.
- Search: reveal the active category by moving only its horizontal strip; never scroll the document on mount or change the first keyboard destination.
- Navigation artwork: one transparent source per icon under `assets/source/navigation-outline/individual/`; explicit contain export and 8px safety gutters in 96px lossless assets under `outline-v2`. Preserve each silhouette’s proportions. Sidebar boxes are 22px; quick search is 16px. A subtle zero-blur subpixel reinforcement keeps small contours legible.

## Current brief and design process

The latest brief calls for less default prose, a friendly and distinctive product, and playful optional motion. Apply the [pinned frontend-design guidance](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md): first write a compact palette/type/layout plan, critique it against the actual task, then build and inspect real screenshots. This contract does not claim a fresh Hallmark runtime audit.

Lead with the person's job: find a course, continue the next available learning step, find someone, or make a deliberate private choice. Avoid repeating the app title as an oversized slogan before the task. Decorative all-caps eyebrows, arbitrary numbered categories and single-fragment headline accents are not a default page template. A meaningful real person, learning figure, path, ballot or seat can carry the page's character; no illustration is required on every page.

The palette deliberately changes to deep petrol, warm coral and targeted sunny reward accents. The installed Inter family and existing task-specific layouts retain continuity; no new font dependency or unrelated decorative kit is required. Light and dark colors have separately tested semantic pairs. Required consent, privacy, retention, inference, exit and publication facts remain understandable at the relevant decision; supporting detail can be disclosed on demand.

## Direction

- **Genre:** a collaborative learning workshop. Quiet surroundings with a friendly, purposeful visual focus.
- **Theme:** cool daylight surfaces and deep-water dark mode, with petrol for actions/progress, coral for cooperation and sunny accents for existing earned rewards. Avoid generic gradients, floating glass and repeated card grids. Original product-specific artwork and the existing native learning figure are welcome where they support the task; do not paste mascots onto every page.
- **Typography:** Inter for display and body through the existing `next/font` setup. Headings are roman, not italic. Use weight, width, and spacing for distinction; no new font dependency.
- **Macrostructure:**
  - Public pages: an editorial opening with strong typographic lead, concise proof of what a user can do, and one clear action. `/` is an introduction, not a dashboard.
  - Auth pages: a focused form beside concise product context on large screens, single column on narrow screens.
  - App pages: stable navigation rail and a compact workbench header; filters and primary action belong near the page title. Content pattern varies by task: feed, directory, calendar, composer, editor, conversation, or table.
  - Content pages: quiet reading column with metadata, clear hierarchy, and related actions in a restrained utility area.

## Canonical tokens

`app/globals.css` owns these semantic HSL channels because Tailwind and shadcn already consume them through `hsl(var(--token))`. Do not scatter raw brand colors through page classes. When a role is missing, add a named token first.

The six visual anchors are petrol `#075B63`, coral `#EF8D75`, sun `#F2C75C`, cool daylight `#F6FAFB`, deep water `#08252F` and ink `#142E3B`. The table gives reference sRGB hex values; runtime values remain numeric HSL channels.

| Role | Light reference | Dark reference | Intent |
| --- | --- | --- | --- |
| `--background` / `--foreground` | `#F6FAFB` / `#142E3B` | `#08252F` / `#E8F5F2` | quiet canvas and body ink |
| `--card`, `--popover` / foreground | `#FFFFFF` / `#142E3B` | `#10333D` / `#E8F5F2` | reading and tool surfaces |
| `--primary`, `--progress`, `--ring` | `#075B63` | `#72D0CC` | action, actual progress and external focus |
| primary/progress foreground | `#FFFFFF` | `#08252F` | text on solid action fill |
| `--secondary` / foreground | `#F4F8FA` / `#243F50` | `#183E47` / `#E8F5F2` | quiet warm secondary surface |
| `--accent` / foreground | `#E2F3F1` / `#075B63` | `#164B55` / `#A7E7E0` | selected interactive surface |
| `--muted` / foreground | `#F0F5F8` / `#53697B` | `#183E47` / `#ADC8CA` | supporting regions and text |
| `--border` / `--input` | `#DDE9ED` / `#63868A` | `#365E68` / `#83A7AB` | quiet separator / visible control boundary |
| `--coral` / foreground | `#A54130` / `#FFFFFF` | `#F3A18D` / `#08252F` | social text or paired solid fill |
| `--coral-highlight` / foreground | `#EF8D75` / `#14343D` | `#F3A18D` / `#08252F` | bright artwork and avatar fill |
| `--reward` / foreground | `#F2C75C` / `#14343D` | `#F2C75C` / `#08252F` | existing earned reward fill |
| `--reward-ink` | `#846112` | `#F2C75C` | small reward text/icons only |
| `--success` / foreground | `#1E7257` / `#FFFFFF` | `#8BD8AF` / `#08252F` | confirmed success plus wording/check |
| `--warning` / foreground | `#8B5A0A` / `#FFFFFF` | `#F0C270` / `#08252F` | warning plus wording/icon |
| `--info` / foreground | `#126A7A` / `#FFFFFF` | `#82D5E4` / `#08252F` | informational state |
| `--destructive` / foreground | `#B72E4A` / `#FFFFFF` | `#FF8AA4` / `#08252F` | error/destructive action plus text/icon |
| `--chart-1` to `--chart-5` | `#075B63`, `#A54130`, `#8B6A0C`, `#357D73`, `#52616B` | `#72D0CC`, `#F3A18D`, `#F2C75C`, `#9BC8B0`, `#B7C6D3` | reserved plot strokes; retain labels/tooltips and other cues |

Bright coral and yellow do not support white small text. Use their paired dark foregrounds, and use `reward-ink` for small reward text rather than yellow text on a light surface. Reading or visiting content is progress, not an earned award; preserve the actual badge/point eligibility conditions. Existing Spark artwork retains its amber/copper, mint, graphite and ivory colors, assets and voluntary motion controls.

Measure actual alpha compositing and interaction surfaces. In dark mode, destructive text on solid accent/secondary and coral text on solid secondary do not meet the normal-text target; use the paired surface foreground or the measured status-specific `/10` state. Shared disabled controls use opaque muted pairs, while loading labels retain full paired contrast. Source contrast checks cover named pairings and do not certify every possible page/state or authored content.

Persisted project/resource colors and authored third-party content keep their own intentional colors. Isolated embed chrome must still use an explicit readable opaque pair without weakening its security boundaries. Imported local H5P packages deliberately retain a light isolated canvas and color scheme; their own loading/error status uses the opaque daylight/ink pair in either outer app theme. External embeds keep their existing presentation. Surface hierarchy comes from quiet surfaces, subtle rules and whitespace before shadow; spend saturation where it explains a real action, social object or reward.

## Type, spacing, and geometry

- Body: `text-sm` to `text-base` depending on density; important reading text is at least `text-base` with relaxed line-height. Avoid 10px text for meaningful labels.
- Page title: `clamp(1.65rem, 1.1rem + 2vw, 2.35rem)` in app pages; public display can reach `clamp(2.5rem, 1.5rem + 4vw, 4.75rem)`. Wrap long words with `overflow-wrap: anywhere`.
- Subheads: 1.1–1.4rem, semibold. One h1 per rendered screen; headings follow a useful h2/h3 outline.
- Spacing: follow the existing 4px Tailwind scale. Default page gutters 16px mobile, 24px tablet, 32px desktop. Reading widths 68–75ch; data/workbench max width around 1440–1600px.
- Radius: controls 10px, panels 14–16px, small chips fully rounded only when genuinely a chip. Borders are one quiet pixel. Avoid nested card-in-card stacks.
- A panel is for a bounded tool or object. Discovery entities use white cards; supporting metadata uses quiet inset surfaces. Keep editors free of decorative gradients.

## Navigation and component voice

- Keep the sidebar/navigation destinations and exact URL behavior. The current mobile Sheet, skip link, active state, and collapsed rail are good foundations.
- Sidebar groups should be readable at 12px or larger; nav items should have 44px minimum comfortable touch height. Active destination uses a quiet accent surface plus clear ink/petrol cue, not color alone.
- A page header includes page title, optional one-line purpose, and at most one primary action. Move secondary actions into a tidy utility cluster; collapse/reflow before labels wrap on mobile.
- Search, the first real result or the next available learning action should take priority over introductory prose and statistics. Do not invent an activity metric to decorate a directory; counts and progress labels must describe their actual data.
- Primary buttons are solid petrol, secondary buttons are quiet outlined or text. Labels use a single line. Destructive actions are explicit, visually separate, and have confirmation when irrecoverable.
- Search and filter controls have persistent accessible names. Filter state is exposed with `aria-pressed`, native checked state, or Radix selection. Empty states explain the next useful action.
- Every interactive row/card is a real link or button. Never use a mouse-only clickable `div`, `tr`, or card. Avoid nested interactive controls.
- Loading, error, empty, success, disabled, hover, focus-visible, and active states are part of each component's design. Reuse `PageState` where it fits.

## Responsive and access floor

- Verify 320, 375, 414, and 768px CSS widths. `html` and `body` use `overflow-x: clip`; the page itself must still reflow rather than relying on clipping.
- One column at 320px. No page-wide horizontal overflow. Wide data tables get a usable mobile view or a clearly bounded horizontal scroll region. Image-bearing grids use `minmax(0, 1fr)`.
- Primary nav, buttons, breadcrumbs, and tabs remain single-line; parent rows reflow instead of labels wrapping. Long dynamic titles and values can wrap safely.
- Keyboard order matches visual order. Every screen has a functional skip target and a main landmark; dialogs manage focus; selected and loading states are announced appropriately.
- Keep a visible two-pixel focus treatment and WCAG AA text/control contrast. Color is never the only status signal. Preserve `lang="de"`.
- Honor `prefers-reduced-motion`: no animated entrance dependency; transitions become effectively immediate. Hover reveals also work by keyboard and touch.
- Motion explains a person's action or confirmed change and is finite. No idle blink/float loops or new heavy 3D. Preserve explicit animation-off and figure-off controls; reduced motion wins. Existing once-only server-confirmed completion feedback must not restart on initial load, reload or account switch, and never turns reading into measured progress.

## Page-family variation

- Community: feed with clear composer, post rhythm, and supporting activity separated from the primary stream.
- Directory pages (members, skills, courses, resources, projects): filter rail or toolbar suited to the data, varied list/card treatments, visible result count and reset path.
- Events: calendar/list toggles with selection/state semantics and a readable small-screen agenda.
- Chat: channel picker, conversation, and composer remain distinct; mobile moves between channel list and conversation without hiding navigation access.
- Knowledge base: article index, article reading, drafts, and editors share typography but have different layouts appropriate to browse/read/write.
- Admin: denser information hierarchy and practical table controls; no nested landmarks or mouse-only row actions.

## Verification contract

For each changed page, check light/dark mode at desktop and 320/375/414/768 widths, keyboard-only navigation, focus visibility, zoom to 200%, long German strings, empty/loading/error states, reduced motion, and no horizontal document scroll. Run repository lint, typecheck, focused tests, and the full test/build checks when dependencies and environment permit. Record any checks that cannot run; do not infer a pass.

No production file deletions are part of this design system. Record the actual source, type, behavioral and browser checks performed; a design skill is guidance, not proof of a functional or accessibility audit. Existing product behavior stays intact.
