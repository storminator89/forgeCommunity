import Image from 'next/image';

/** A compact symbol beside the readable HTML wordmark, never a duplicate name. */
export function ForgeBrandMark() {
  return <Image src="/images/brand/forge-community-mark.webp" width={36} height={36}
    alt="" aria-hidden="true" className="h-9 w-9 shrink-0 object-contain"
    draggable={false} loading="eager" unoptimized />;
}
