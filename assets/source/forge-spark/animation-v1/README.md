# Spark articulated animation V1

Editable animation source for the existing project-original Forge Spark V3 character. Geometry, camera, materials and identity are retained. The original forge-spark.blend and build_mascot.py remain unchanged.

The new scene was created and rendered with genuine execute_blender_code calls through the unmodified community mcp-for-blender 2.2.0 server, with its code safe-mode validation enabled and all telemetry disabled. A temporary localhost-only Blender lifecycle supplied a main-thread command queue pump; it did not replace MCP with direct CLI scene editing or rendering. No external model, image generator, credentials or paid service was used.

Local pivot controls articulate torso breathing, head, arms/hands, wings and antennae independently. Eye geometry and highlights follow blinks. The root and boots stay planted: this is character animation, not a CSS transform of a rendered still.

Timeline clips, 12fps:
- Idle: frames 1–48, 4 seconds, loopable breathing and one blink.
- Blink: frames 60–83, 2 seconds.
- Thinking: frames 100–135, 3 seconds, finite thoughtful tilt/gaze/hand gesture.
- Success: frames 150–179, 2.5 seconds, finite open-handed positive response.
- Encouragement: frames 200–229, 2.5 seconds, finite supportive tilt and gesture.
- Answer: frames 240–269, 2.5 seconds, finite presenting gesture.

Each control has named NLA tracks; strips have no extrapolation outside their own clip. Every clip begins and ends at the neutral pose. Open the new .blend to inspect the tracks and timeline markers. To regenerate the tracks, open the original V3 scene with scripts disabled, then send animate_character_mcp.py to the Blender MCP execute_blender_code tool. It writes a separate scene inside animation-v1; do not run it on an already-animated scene.

Shipped browser assets are lossless, transparent 160px frame atlases, 8 cells wide, with a matching static rest image. Asset packing does not repaint or warp the renders. Clips are decorative: respect the Spark off switch, motion preference and operating-system reduced motion, request atlases only in view, stop while the document is hidden, and trigger positive outcomes only on newly confirmed events. Historical completion must not replay celebration. No browser 3D runtime is required.

CPU rendering used 64 Cycles samples and 2 threads. Denoising is disabled because this Blender build lacks OpenImageDenoise. Functional application checks are reserved for the published Sites version; local checks are type/build only.
