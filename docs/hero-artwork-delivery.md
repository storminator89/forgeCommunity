# Hero artwork delivery

The landing Hero uses one existing local image, `/images/home/forge-workbench-1440.webp`, with intrinsic dimensions 1440×960. CSS keeps its full uncropped 3:2 composition responsive. The image has no `srcset`, `sizes`, alternate `source`, browser-dependent asset selection, JavaScript fallback or additional image preload. The native `picture` wrapper retains the installed React renderer's suppression of automatic image head hints. Loading remains eager, high priority and asynchronously decoded.

## Deliberate performance tradeoff

The fixed WebP is 93,712 bytes (91.52 KiB), below the existing 100 KiB single-image budget. The preserved 480px derivative is 17,162 bytes and the 768px derivative is 34,956 bytes. A mobile visitor therefore pays an intentional additional 76,550 bytes (74.76 KiB) versus 480px or 58,756 bytes (57.38 KiB) versus 768px. The original and all derivatives and their provenance remain unchanged.

This prioritizes one predictable source for one Hero over per-device byte minimization. In CI run 38983908157, the preceding responsive candidate still produced an actually blank Hero capture at 375px, despite decoded observations on both sides. A separate fresh 390px/2× delivery observed both the 1440px and 768px HTTP 200 responses, totaling 128,668 image-body bytes, with zero Hero head preloads. Those observations motivate the simpler delivery contract; they do not establish the browser or paint defect's underlying cause, or prove the fixed source resolves it.

## Strict verification

Each cold viewport/DPR delivery must select exactly the fixed URL, issue exactly one real image request and produce one matching image resource-timing entry. The response must be HTTP 200 WebP with exactly 93,712 body bytes and matching encoded-body size; the decoded natural dimensions must be 1440×960. The full-width CSS slot must match the frame's content width without cropping or changed aspect ratio. The static and streaming SSR tests require no Hero head hint, and the hydration test preserves the server image and its attributes in place.

The existing single-original-PNG blank-interior and spatial-composition checks, decode checks and document geometry checks remain strict. Spark captures additionally require the exact fixed source before, immediately after and after the independently settled observation. There are no new screenshot retries, waits, pixel edits or alternate captures. Only actual CI delivery evidence and original browser pixels can establish the new implementation's runtime result.
