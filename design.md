# ForgeCommunity design system

This is the shared visual contract for the multi-page redesign. Preserve existing routes, German copy intent, authorization, data workflows, and content. The visual language should feel like a calm, useful place to work with other people, not a marketing template.

## Current brief and design process

The latest brief calls for less default prose, a friendly and distinctive product, and playful optional motion. Apply the [pinned frontend-design guidance](https://github.com/anthropics/skills/blob/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/frontend-design/SKILL.md): first write a compact palette/type/layout plan, critique it against the actual task, then build and inspect real screenshots. This contract does not claim a fresh Hallmark runtime audit.

Lead with the person's job: find a course, continue the next available learning step, find someone, or make a deliberate private choice. Avoid repeating the app title as an oversized slogan before the task. Decorative all-caps eyebrows, arbitrary numbered categories and single-fragment headline accents are not a default page template. A meaningful real person, learning figure, path, ballot or seat can carry the page's character; no illustration is required on every page.

The existing palette and installed Inter family provide continuity. Keep their semantic dark-mode/contrast behavior rather than introduce an unrelated rebrand or new font dependency. Distinctiveness must come from real content and task-specific composition, not another decorative kit. Required consent, privacy, retention, inference, exit and publication facts remain understandable at the relevant decision; supporting detail can be disclosed on demand.

## Direction

- **Genre:** a collaborative learning workshop. Quiet surroundings with a friendly, purposeful visual focus.
- **Theme:** warm paper and charcoal ink with the existing blue used sparingly for active state, primary action, and focus. Avoid generic gradients, floating glass and repeated card grids. Original product-specific artwork and the existing native learning figure are welcome where they support the task; do not paste mascots onto every page.
- **Typography:** Inter for display and body through the existing `next/font` setup. Headings are roman, not italic. Use weight, width, and spacing for distinction; no new font dependency.
- **Macrostructure:**
  - Public pages: an editorial opening with strong typographic lead, concise proof of what a user can do, and one clear action. `/` is an introduction, not a dashboard.
  - Auth pages: a focused form beside concise product context on large screens, single column on narrow screens.
  - App pages: stable navigation rail and a compact workbench header; filters and primary action belong near the page title. Content pattern varies by task: feed, directory, calendar, composer, editor, conversation, or table.
  - Content pages: quiet reading column with metadata, clear hierarchy, and related actions in a restrained utility area.

## Canonical tokens

`app/globals.css` owns these semantic HSL channels because Tailwind and shadcn already consume them through `hsl(var(--token))`. Do not scatter raw brand colors through page classes. When a role is missing, add a named token first.

| Role | Light HSL | Dark HSL | Intent |
| --- | --- | --- | --- |
| `--background` | `42 31% 97%` | `220 21% 10%` | warm paper / dark canvas |
| `--foreground` | `218 23% 17%` | `42 22% 94%` | body ink |
| `--card` | `40 33% 99%` | `220 19% 14%` | raised surface |
| `--secondary`, `--muted` | `42 21% 93%` | `220 16% 19%` | quiet controls and regions |
| `--muted-foreground` | `218 12% 39%` | `220 13% 71%` | supporting text; check contrast in situ |
| `--border` | `42 16% 83%` | `220 15% 29%` | separators |
| `--input` | `42 12% 52%` | `220 14% 46%` | tested control boundary |
| `--primary` | `225 75% 43%` | `224 88% 76%` | sparing brand blue / action |
| `--primary-foreground` | `0 0% 100%` | `220 24% 10%` | primary-action text |
| `--accent` | `225 66% 93%` | `225 28% 23%` | selected surface |
| `--accent-foreground` | `225 75% 34%` | `224 88% 87%` | selected text |
| `--ring` | `225 75% 43%` | `224 88% 76%` | keyboard focus |

Use the existing semantic destructive/chart tokens, adjusting their contrast if a tested screen needs it. Surface hierarchy comes from paper, subtle rules, and whitespace before shadow. Keep blue to roughly 5% of a viewport; avoid blue-tinted cards throughout a page.

## Type, spacing, and geometry

- Body: `text-sm` to `text-base` depending on density; important reading text is at least `text-base` with relaxed line-height. Avoid 10px text for meaningful labels.
- Page title: `clamp(1.65rem, 1.1rem + 2vw, 2.35rem)` in app pages; public display can reach `clamp(2.5rem, 1.5rem + 4vw, 4.75rem)`. Wrap long words with `overflow-wrap: anywhere`.
- Subheads: 1.1–1.4rem, semibold. One h1 per rendered screen; headings follow a useful h2/h3 outline.
- Spacing: follow the existing 4px Tailwind scale. Default page gutters 16px mobile, 24px tablet, 32px desktop. Reading widths 68–75ch; data/workbench max width around 1440–1600px.
- Radius: controls 10px, panels 14–16px, small chips fully rounded only when genuinely a chip. Borders are one quiet pixel. Avoid nested card-in-card stacks.
- A panel is for a bounded tool or object. Use open sections and rules for content lists; don't put every element in a card.

## Navigation and component voice

- Keep the sidebar/navigation destinations and exact URL behavior. The current mobile Sheet, skip link, active state, and collapsed rail are good foundations.
- Sidebar groups should be readable at 12px or larger; nav items should have 44px minimum comfortable touch height. Active destination uses a quiet accent surface plus clear ink/blue cue, not color alone.
- A page header includes page title, optional one-line purpose, and at most one primary action. Move secondary actions into a tidy utility cluster; collapse/reflow before labels wrap on mobile.
- Search, the first real result or the next available learning action should take priority over introductory prose and statistics. Do not invent an activity metric to decorate a directory; counts and progress labels must describe their actual data.
- Primary buttons are solid blue, secondary buttons are quiet outlined or text. Labels use a single line. Destructive actions are explicit, visually separate, and have confirmation when irrecoverable.
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
