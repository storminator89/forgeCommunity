# Forge Spark V3 source

Forge Spark is an optional, project-original mascot made for forgeCommunity. This softer, rounded V3 revision has geometry, materials, and Idle, Blink, and Celebrate animation tracks built from Blender primitives by `build_mascot.py`; no third-party model is used. `forge-spark.blend` is the editable V3 source, saved with Blender 4.3.2. Its preview output path was normalized to be relative to the file.

To regenerate with Blender 4.3.2 from the repository root:

```sh
blender --background --factory-startup --python assets/source/forge-spark/build_mascot.py
```

The script writes the `.blend`, a `.glb` export, and three PNG previews beside itself. These generated exports and previews are intentionally not versioned here. Regeneration overwrites the tracked `.blend`, so review its diff before committing it. The editable `.blend` and script stay outside `public/` and do not ship to the browser; separate optimized static pose exports, such as WebP images, can be used by the optional Journey UI.

Keep the mascot decorative and optional wherever it appears. If animation is added, provide a motion-off/static-pose choice, and automatically disable Idle, Blink, and Celebrate motion when the user requests reduced motion (`prefers-reduced-motion: reduce`). The mascot must not carry information needed to use the app.

## Journey celebration export

The optional Journey completion clip is a raster export of this V3 model's genuine Blender `Celebrate` track, not a CSS transform of a still or a browser-side 3D runtime:

- `public/images/forge-spark-celebrate-once.webp`: 224 × 224 RGBA, 25 frames at 80 ms each, 2,000 ms total, one total playback (`ANIM` loop count 1), 134,882 bytes. SHA-256: `e2c4c7024d1f8d068a67081296bf5f1800035d068094b53110054eea04613e32`.
- `public/images/forge-spark-celebrate-final.webp`: the matching final resting frame, 224 × 224 RGBA, 6,102 bytes. This is a non-animated fallback/end pose.

Provenance: the original Blender 4.3.2 V3 scene was rendered at frames 100, 102, …, 148 with Cycles on CPU, 96 samples, denoising off, 320 × 320 pixels and transparent film. Its model, materials and animation construction match `build_mascot.py`; the checked-in source uses portable output filenames. The frames were resized to 224 × 224 with Lanczos, composited at `(0, 8)` onto a transparent 224 × 224 canvas, then encoded as animated WebP with quality 70, method 6, mixed compression and size minimization. All non-transparent pixels fit within the canvas across the whole clip. The final frame was also encoded separately at quality 80.

Only a newly observed incomplete-to-complete transition for the same course publication may mount/request the clip. Visibility, the independent motion preference and operating-system reduced motion are checked when the progress response settles. Each eligible event receives a document-local counter in its `?play=` URL, because re-mounting the same once-loop WebP URL can reuse an ended browser-decoded animation clock. The token contains no account, content or timestamp information, and is allocated only after all gates pass. The UI keeps a static pose during loading, removes it while the transparent animation plays, then restores it after the two-second load-relative window. An eight-second load deadline and image-error fallback prevent late or lost requests from keeping a pending celebration alive. Leaving the view or changing preferences disposes the timer and consumes the event.

`journey-spark-assets.test.ts` verifies the shipped clip hash, alpha/canvas metadata, frame durations and one-shot loop count. The focused UI suites cover lifecycle and preference combinations, including cached Next Image loading under StrictMode. `e2e/journey-spark-celebration.pw.ts` exercises the real image source, network gating, changing browser-decoded frames, delayed loads, image failure, keyboard controls and static completion screenshots in the disposable CI browser fixture.
