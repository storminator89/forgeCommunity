# Forge Spark V3 source

Forge Spark is an optional, project-original mascot made for forgeCommunity. This softer, rounded V3 revision has geometry, materials, and Idle, Blink, and Celebrate animation tracks built from Blender primitives by `build_mascot.py`; no third-party model is used. `forge-spark.blend` is the editable V3 source, saved with Blender 4.3.2. Its preview output path was normalized to be relative to the file.

To regenerate with Blender 4.3.2 from the repository root:

```sh
blender --background --factory-startup --python assets/source/forge-spark/build_mascot.py
```

The script writes the `.blend`, a `.glb` export, and three PNG previews beside itself. These generated exports and previews are intentionally not versioned here. Regeneration overwrites the tracked `.blend`, so review its diff before committing it. The editable `.blend` and script stay outside `public/` and do not ship to the browser; separate optimized static pose exports, such as WebP images, can be used by the optional Journey UI.

Keep the mascot decorative and optional wherever it appears. If animation is added, provide a motion-off/static-pose choice, and automatically disable Idle, Blink, and Celebrate motion when the user requests reduced motion (`prefers-reduced-motion: reduce`). The mascot must not carry information needed to use the app.
