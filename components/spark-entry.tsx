'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useSparkVisibility } from '@/hooks/useSparkVisibility';

/** The existing resting Blender render. Entry points never request a clip. */
export function SparkStaticFigure() {
  const [failed, setFailed] = useState(false);
  return <span aria-hidden="true" className="block size-[64px] shrink-0" data-spark-entry-figure="">
    {!failed && <Image src="/images/forge-spark-preview.webp" width={64} height={64} alt=""
      unoptimized className="block size-[64px] object-contain" onError={() => setFailed(true)} />}
  </span>;
}

/** A quiet decorative entry figure. Visibility is controlled in Settings. */
export function SparkEntry({ className = '' }: { className?: string }) {
  const { visible } = useSparkVisibility();
  if (!visible) return null;
  return <div className={`flex min-h-[64px] min-w-0 items-center ${className}`} data-spark-entry="">
    <SparkStaticFigure />
  </div>;
}
