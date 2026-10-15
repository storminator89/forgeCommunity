import Image from 'next/image';
import styles from './JourneyMascot.module.css';

/** Replaceable, decorative slot. These WebP poses are compressed from original
 * Blender PNG renders in mascot-forge-spark-v3; the native source stays with the
 * mascot deliverable while its appearance is reviewed.
 */
export function JourneyMascot({ complete, animating, ambientMotion }: { complete: boolean; animating: boolean; ambientMotion: boolean }) {
  return <span className={`relative block size-28 shrink-0 ${animating ? styles.celebrate : ''}`} aria-hidden="true">
    <Image
      src={complete ? '/images/forge-spark-celebrate.webp' : '/images/forge-spark-preview.webp'}
      width={112} height={112} alt="" priority={false} className="size-28 object-contain"
    />
    {!complete && ambientMotion && <Image
      src="/images/forge-spark-blink.webp" width={112} height={112} alt="" priority={false}
      className={`absolute inset-0 size-28 object-contain ${styles.blink}`}
    />}
  </span>;
}
