import type { SparkClips } from '@/components/SparkCharacter';

// Genuine articulated Blender MCP exports. These files are static atlases,
// not animated WebPs, and contain no browser-side 3D/runtime dependencies.
const atlas = (name: string, frameCount: number) => ({
  source: `/images/forge-spark/${name}-atlas.webp`,
  frameCount, columns: 8, rows: Math.ceil(frameCount / 8), fps: 12, cellSize: 160,
});

export const SPARK_REST = '/images/forge-spark/rest.webp';
export const SPARK_CLIPS = {
  idle: atlas('idle', 48),
  blink: atlas('blink', 24),
  thinking: atlas('thinking', 36),
  positive: atlas('positive', 30),
  retry: atlas('retry', 30),
  answer: atlas('answer', 30),
} satisfies SparkClips;
