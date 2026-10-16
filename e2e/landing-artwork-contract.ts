/** Pinned derivatives of the commissioned original, checked against provenance. */
export const artworkCandidates = [
  { width: 480, bytes: 17162 },
  { width: 768, bytes: 34956 },
  { width: 1440, bytes: 93712 },
] as const;

/** A bounded delivery contract, not a claim that an over-delivery is optimal. */
export function artworkCandidateBounds(slotWidth: number, devicePixelRatio: number) {
  if (![slotWidth, devicePixelRatio].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Artwork geometry and device pixel ratio must be finite and positive.');
  }
  const uncappedDemand = slotWidth * devicePixelRatio;
  const maximumWidth = artworkCandidates[artworkCandidates.length - 1].width;
  const cappedDemand = Math.min(uncappedDemand, maximumWidth);
  // One source pixel accommodates fractional CSS layout rounding.
  const adequateIndex = artworkCandidates.findIndex(candidate => candidate.width + 1 >= cappedDemand);
  const allowedWidths = artworkCandidates.slice(adequateIndex, adequateIndex + 2).map(candidate => candidate.width);
  return {
    uncappedDemand,
    cappedDemand,
    sourceLimited: uncappedDemand > maximumWidth,
    smallestAdequateWidth: artworkCandidates[adequateIndex].width,
    allowedWidths,
  };
}
