# ForgeCommunity · individual navigation icons

Generated individually on 17 October 2026 with the built-in ImageGen tool at the user's explicit request. Each of the 20 subjects has its own generation call and transparent PNG in `individual/`. The exact prompt set and original generated file paths are recorded in `individual/prompts.json`.

- Current source: `individual/<name>.png`, one complete icon per file.
- Export: `node scripts/prepare-navigation-outline.mjs`.
- Current runtime assets: `public/images/navigation/outline-v2/*.webp`, lossless 96 × 96 px.
- Every export uses explicit `fit: contain`, a source-space guard around the full visible contour and 8px transparent output gutters. No square cover resize or sprite slicing is used.
- `individual/geometry.json` records the source bounds and margins. The asset regression test checks retained silhouette proportions and transparent gutters.
- Runtime: 22px sidebar boxes, 16px quick-search boxes; theme-aware monochrome masks. A subtle zero-blur subpixel reinforcement keeps the ink legible at small UI sizes. The glyph uses CanvasText in forced colors.
- The original ForgeCommunity logo remains byte-for-byte unchanged in `public/images/brand/forge-community-mark.webp`.

The previous `atlas.png`, `prompt.txt` and `public/images/navigation/outline/` files are historical source material. The current navigation registry points exclusively to `outline-v2`; versioned URLs avoid stale browser copies of the former set. No routes, role rules or labels are added by this artwork.
