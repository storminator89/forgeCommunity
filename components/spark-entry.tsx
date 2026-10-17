'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { useSparkVisibility } from '@/hooks/useSparkVisibility';

/** The existing resting Blender render. Entry points never request a clip. */
export function SparkStaticFigure() {
  const [failed, setFailed] = useState(false);
  return <span aria-hidden="true" className="block size-[64px] shrink-0" data-spark-entry-figure="">
    {!failed && <Image src="/images/forge-spark-preview.webp" width={64} height={64} alt=""
      unoptimized className="block size-[64px] object-contain" onError={() => setFailed(true)} />}
  </span>;
}

/** A quiet in-flow preference, kept out of the shared navigation/header. */
export function SparkEntry({ className = '' }: { className?: string }) {
  const { visible, toggle } = useSparkVisibility();
  return <div className={`flex min-h-[64px] min-w-0 items-center gap-2 ${className}`} data-spark-entry="">
    <span className="block size-[64px] shrink-0" aria-hidden="true">{visible && <SparkStaticFigure />}</span>
    <Button type="button" variant="ghost" size="sm" className="h-auto min-h-11 min-w-0 max-w-full whitespace-normal py-2 text-left [overflow-wrap:anywhere] sm:h-auto"
      onClick={toggle}>{visible ? 'Spark ausblenden' : 'Spark anzeigen'}</Button>
  </div>;
}
