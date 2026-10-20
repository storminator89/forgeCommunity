'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';

export type SparkClipName = 'idle' | 'blink' | 'thinking' | 'answer' | 'positive' | 'retry';
export type SparkReaction = { id: string; kind: 'thinking' | 'answer' | 'positive' | 'retry' };
export type SparkAtlas = {
  /** Same-origin static WebP atlas containing genuine Blender-rendered poses. */
  source: string;
  frameCount: number;
  columns: number;
  rows: number;
  fps: number;
  cellSize: number;
};
export type SparkClips = Partial<Record<SparkClipName, SparkAtlas>>;

type Props = {
  visible: boolean;
  /** The caller combines both existing independent browser motion choices. */
  motionEnabled: boolean;
  clips: SparkClips;
  staticSource?: string;
  activity?: 'idle' | 'blink' | 'thinking';
  /** Explicit fresh-event token, never inferred from historical result state. */
  reaction?: SparkReaction | null;
  size?: number | '100%';
  className?: string;
};

const legacyRest = '/images/forge-spark-preview.webp';
// Document-local tokens never enter a URL, storage, an account, or analytics.
// Keeping consumption outside the component prevents route/visibility remounts
// from reviving the same completion. A fresh event has a fresh scoped token.
const consumedReactions = new Set<string>();

function subscribeReducedMotion(callback: () => void) {
  const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  media?.addEventListener('change', callback);
  return () => media?.removeEventListener('change', callback);
}
function reducedMotionSnapshot() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
}
function subscribePageVisible(callback: () => void) {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}
function pageVisibleSnapshot() {
  return document.visibilityState === 'visible';
}

function validAtlas(clip: SparkAtlas | undefined): clip is SparkAtlas {
  return Boolean(clip && /^\/images\/forge-spark\/[a-z-]+\.webp$/.test(clip.source)
    && Number.isInteger(clip.frameCount) && clip.frameCount > 1 && clip.frameCount <= 96
    && Number.isInteger(clip.columns) && clip.columns > 0 && clip.columns <= 8
    && Number.isInteger(clip.rows) && clip.rows > 0 && clip.rows <= 12
    && clip.frameCount <= clip.columns * clip.rows
    && Number.isFinite(clip.fps) && clip.fps >= 8 && clip.fps <= 24
    && Number.isInteger(clip.cellSize) && clip.cellSize >= 64 && clip.cellSize <= 256);
}

/** One finite articulated gesture per viewport entry, then rest. No bitmap
 * wobble, canvas, WebGL, or unpausable infinite public-page motion.
 */
export function SparkCharacter({ visible, motionEnabled, clips, staticSource = legacyRest,
  activity = 'idle', reaction = null, size = 80, className = '' }: Props) {
  const wrapper = useRef<HTMLSpanElement>(null);
  const [viewport, setViewport] = useState({ known: false, visible: false });
  const [pendingReaction, setPendingReaction] = useState<SparkReaction | null>(null);
  const [activeReaction, setActiveReaction] = useState<SparkReaction | null>(null);
  const [ambientConsumed, setAmbientConsumed] = useState(false);
  const systemReduced = useSyncExternalStore(subscribeReducedMotion, reducedMotionSnapshot, () => true);
  const pageVisible = useSyncExternalStore(subscribePageVisible, pageVisibleSnapshot, () => false);
  const canAnimate = visible && motionEnabled && !systemReduced && pageVisible;
  const allowed = canAnimate && viewport.known && viewport.visible;

  useEffect(() => {
    setViewport({ known: false, visible: false });
    if (!visible || !wrapper.current) return;
    // Without a trustworthy visibility signal, retain the static pose.
    if (typeof IntersectionObserver === 'undefined') {
      setViewport({ known: true, visible: false });
      return;
    }
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      setViewport({ known: true, visible: entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.05) });
    }, { threshold: 0.05 });
    observer.observe(wrapper.current);
    return () => { active = false; observer.disconnect(); };
  }, [visible]);

  useEffect(() => {
    // Interrupted gestures are consumed, never paused for later replay.
    if (!allowed) {
      setActiveReaction(null);
      setAmbientConsumed(false);
    }
    if (!canAnimate || (viewport.known && !viewport.visible)) setPendingReaction(null);
  }, [allowed, canAnimate, viewport.known, viewport.visible]);

  useEffect(() => {
    if (!reaction || consumedReactions.has(reaction.id)) return;
    consumedReactions.add(reaction.id);
    if (canAnimate && validAtlas(clips[reaction.kind])) setPendingReaction(reaction);
  }, [reaction, canAnimate, clips]);

  useEffect(() => {
    // Parent event cancellation must win even if a rapid off/on pair is
    // batched and the final motion snapshot never renders as disabled.
    setPendingReaction(current => current && current.id !== reaction?.id ? null : current);
    setActiveReaction(current => current && current.id !== reaction?.id ? null : current);
  }, [reaction?.id]);

  useEffect(() => {
    if (!pendingReaction || !viewport.known) return;
    if (allowed && reaction?.id === pendingReaction.id) {
      setActiveReaction(pendingReaction);
      // Do not chain another automatic idle onto a completed gesture.
      setAmbientConsumed(true);
    }
    setPendingReaction(current => current?.id === pendingReaction.id ? null : current);
  }, [pendingReaction, viewport.known, allowed, reaction]);

  if (!visible) return null;
  const currentReaction = activeReaction?.id === reaction?.id ? activeReaction : null;
  const requested = currentReaction?.kind ?? activity;
  const clip = clips[requested];
  const identity = currentReaction ? `${currentReaction.kind}:${currentReaction.id}` : activity;
  return <span ref={wrapper} aria-hidden="true" data-spark-character="" data-spark-clip={requested}
    data-spark-motion={allowed} className={className}
    style={{ display: 'block', position: 'relative', width: size, height: size, flexShrink: 0 }}>
    {allowed && (currentReaction || !ambientConsumed) && validAtlas(clip) ? <SparkAtlasFrames key={`${identity}:${clip.source}`} clip={clip}
      staticSource={staticSource} size={size}
      onFinish={() => {
        setAmbientConsumed(true);
        setActiveReaction(current => current?.id === currentReaction?.id ? null : current);
      }} />
      : <SparkRestingPose key={staticSource} source={staticSource} size={size} />}
  </span>;
}

function SparkRestingPose({ source, size }: { source: string; size: number | '100%' }) {
  const [failed, setFailed] = useState(false);
  const [allFailed, setAllFailed] = useState(false);
  if (allFailed) return null;
  const currentSource = failed ? legacyRest : source;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={currentSource} width={typeof size === 'number' ? size : 160}
    height={typeof size === 'number' ? size : 160} alt="" loading="lazy" decoding="async"
    onError={() => { if (failed || source === legacyRest) setAllFailed(true); else setFailed(true); }}
    style={{ display: 'block', width: '100%', height: '100%', objectFit: 'contain' }} />;
}

function SparkAtlasFrames({ clip, onFinish, staticSource, size }: {
  clip: SparkAtlas; onFinish: () => void; staticSource: string; size: number | '100%';
}) {
  const element = useRef<HTMLSpanElement>(null);
  const callback = useRef(onFinish);
  callback.current = onFinish;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    let active = true;
    const image = new window.Image();
    image.decoding = 'async';
    const fail = () => {
      if (!active || finished.current) return;
      setFailed(true);
      finished.current = true;
      callback.current();
    };
    const deadline = setTimeout(fail, 8000);
    image.onload = () => {
      clearTimeout(deadline);
      if (!active || finished.current) return;
      if (image.naturalWidth !== clip.columns * clip.cellSize || image.naturalHeight !== clip.rows * clip.cellSize) {
        fail();
        return;
      }
      setReady(true);
    };
    image.onerror = () => { clearTimeout(deadline); fail(); };
    image.src = clip.source;
    return () => {
      active = false;
      clearTimeout(deadline);
      image.onload = null;
      image.onerror = null;
    };
  }, [clip.source, clip.columns, clip.rows, clip.cellSize]);

  useEffect(() => {
    if (!ready || failed || finished.current) return;
    let handle = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let start: number | null = null;
    let previousFrame = -1;
    const duration = clip.frameCount * 1000 / clip.fps;
    const draw = (now: number) => {
      start ??= now;
      const elapsed = now - start;
      if (elapsed >= duration) {
        finished.current = true;
        setDone(true);
        callback.current();
        return;
      }
      const frame = Math.floor(elapsed * clip.fps / 1000);
      if (frame !== previousFrame && element.current) {
        const column = frame % clip.columns;
        const row = Math.floor(frame / clip.columns);
        element.current.style.backgroundPosition = `${clip.columns === 1 ? 0 : column * 100 / (clip.columns - 1)}% ${clip.rows === 1 ? 0 : row * 100 / (clip.rows - 1)}%`;
        previousFrame = frame;
      }
      // Wake only for the next rendered frame, then align the DOM write with
      // paint. A 12fps Spark does not run 60/120 callbacks per second.
      const nextFrameAt = start + (Math.floor(elapsed * clip.fps / 1000) + 1) * 1000 / clip.fps;
      timer = setTimeout(() => { handle = requestAnimationFrame(draw); }, Math.max(4, nextFrameAt - performance.now()));
    };
    handle = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(handle);
      if (timer !== null) clearTimeout(timer);
    };
  }, [ready, failed, clip]);

  if (!ready || failed || done) return <SparkRestingPose key={staticSource} source={staticSource} size={size} />;
  const style: CSSProperties = {
    position: 'absolute', inset: 0, display: 'block',
    // Fully transparent atlas cells replace, rather than overlay, the pose.
    backgroundImage: `url("${clip.source}")`, backgroundRepeat: 'no-repeat',
    backgroundSize: `${clip.columns * 100}% ${clip.rows * 100}%`, backgroundPosition: '0% 0%',
  };
  return <span ref={element} data-spark-atlas="" style={style} />;
}
