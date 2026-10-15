# Design color contrast regression check

## Result and scope

The source-level check reproduces 11 below-threshold mode/state pairs at application commit `8ab8eb05a695d995baf65887a15511b64583b3f6`. The same 52 checked pairs have identical results at local integration base `5e3c1d0`. With this patch, all 52 pass their numeric thresholds.

This is a curated source-color calculation and component-state regression test, not a rendered-browser audit, screenshot review, or WCAG conformance assessment. It uses the actual HSL tokens in `app/globals.css`, the installed Tailwind v3 palette, and selected utility classes from the components. Hover backgrounds are alpha-composited over the card surface in sRGB. Threshold comparisons use unrounded values; the report rounds only for display.

## Criteria

- Normal-size text is checked against 4.5:1 under [W3C WCAG 2.2 Understanding 1.4.3, Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Its relative-luminance formula and 0.04045 sRGB transfer threshold are used directly.
- Input boundaries, meaningful close icons, and focus indicators are checked against 3:1 under [W3C WCAG 2.2 Understanding 1.4.11, Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Decorative separators and disabled states are not treated as required controls.
- [W3C WCAG 2.2 Understanding 2.4.7, Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) explains the need for a visible keyboard-focus indicator. Here only the specified indicator colors and component classes are verified; keyboard navigation, clipping, occlusion, and focus appearance in a browser remain unverified.

## Concrete failures and fixes

| Component/state | Mode | Original exact CSS pair | Original ratio | Change | New ratio |
| --- | --- | --- | --- | --- | --- |
| Shared input boundary against its background | Light | `hsl(42 12% 55%)` / `hsl(42 31% 97%)` | 2.928 | Input lightness 55% → 52% | 3.215 |
| Destructive badge hover text | Light | `#fff` / `hsl(0 76% 44% / .8)` over `hsl(40 33% 99%)` | 4.446 | Hover opacity .8 → .9 | 5.206 |
| Profile validation messages | Light | `#ef4444` / `hsl(40 33% 99%)` | 3.692 | `text-destructive`: `hsl(0 76% 44%)` | 5.790 |
| Profile validation messages | Dark | `#ef4444` / `hsl(220 19% 14%)` | 4.265 | `text-destructive`: `hsl(0 80% 70%)` | 5.740 |
| Correct quiz result text | Light | `#16a34a` / `hsl(40 33% 99%)` | 3.234 | Green 600 → green 700 (`#15803d`) | 4.921 |
| Legacy notification count | Light | `#fff` / `#ef4444` | 3.763 | Destructive badge variant: `#fff` / `hsl(0 76% 44%)` | 5.901 |
| Legacy notification count | Dark | `#fff` / `#ef4444` | 3.763 | Destructive badge variant: `hsl(220 24% 10%)` / `hsl(0 80% 70%)` | 6.392 |
| Destructive toast close icon | Dark | `#fca5a5` / `hsl(0 80% 70%)` | 1.473 | `text-destructive-foreground`: `hsl(220 24% 10%)` | 6.392 |
| Destructive toast close hover icon | Dark | `#fef2f2` / `hsl(0 80% 70%)` | 2.556 | Same semantic foreground | 6.392 |
| Destructive toast close focus ring | Light | `#f87171` / `hsl(0 76% 44%)` | 2.133 | `ring-destructive-foreground`: `#fff` | 5.901 |
| Destructive toast close focus ring | Dark | `#f87171` / `hsl(0 80% 70%)` | 1.011 | `ring-destructive-foreground`: `hsl(220 24% 10%)` | 6.392 |

The input token keeps its hue and saturation. A deliberate 3.2:1 regression reserve now covers both controlled input surfaces: light/background 3.215, light/card 3.340, dark/background 3.569, and dark/card 3.213. Dark input lightness changes from 45% to 46%; its original card pairing was already above 3:1 but had little reserve.

The profile name/contact field error borders now use the same semantic destructive token. The toast close control has an accessible German name, stays fully opaque without requiring hover or focus, and its ordinary icon uses the already-established muted text token. The persistent affordance is a source/class regression check; no touch-browser observation is claimed. The existing primary/background/card focus-ring pairs remain above 3:1 in both themes without changing the global ring or primary palette.

Source locations:

- `app/globals.css`, `components/ui/input.tsx`: shared input/background and focus tokens
- `components/profile/ProfileEditForm.tsx`: both validation messages and error borders inside the profile card
- `app/courses/[courseId]/contents/QuizRenderer.tsx`: per-question correct-result feedback
- `components/ui/badge.tsx`: destructive hover state
- `components/notification-badge.tsx`: legacy count component; no current production import was found. The active sidebar already uses the passing primary token pair.
- `components/ui/toast.tsx`: destructive close icon, hover, and focus state

## Reproduce

```sh
# Returns 1 and reports the original failures; requires the referenced Git history.
node scripts/check-color-contrast.js --ref 8ab8eb05a695d995baf65887a15511b64583b3f6
node scripts/check-color-contrast.js --ref 5e3c1d0

# Patched sources: returns 0; add --json for structured results.
node scripts/check-color-contrast.js

npm test -- --runInBand __tests__/design-color-contrast.test.js __tests__/contrast-component-states.test.tsx __tests__/notification-badge.test.tsx __tests__/course-quiz.test.tsx
npm run typecheck
npm run lint
```

Focused verification: 4 suites, 88 tests passed. Typecheck and full lint passed. Tailwind CLI compilation also succeeded and emitted the green-700, destructive hover, and destructive close icon/focus-ring utilities. The implementation followed the installed Next 16.3.8 CSS, Tailwind v3, and Jest guidance.

This check does not infer the full CSS cascade, every caller override or backdrop, image/gradient contrast, all chart colors, browser geometry, or every interactive state. Full light/dark browser and keyboard QA remains a separate release check. No database, live account data, publication, merge, deployment, or dependency audit was involved.
