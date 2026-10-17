/** Pinned derivatives of the commissioned original, checked against provenance. */
export const artworkCandidates = [
  { width: 480, bytes: 17162 },
  { width: 768, bytes: 34956 },
  { width: 1440, bytes: 93712 },
] as const;

/** Active delivery policy: one fixed source; CSS alone provides responsive sizing. */
export const fixedArtworkDelivery = {
  path: '/images/home/forge-workbench-1440.webp',
  width: 1440,
  height: 960,
  bytes: 93712,
  maximumBytes: 100 * 1024,
  mobileExtraBytes: { 480: 76550, 768: 58756 },
} as const;
