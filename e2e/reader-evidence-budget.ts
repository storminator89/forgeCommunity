type Data = Record<string, any> // Diagnostic JSON only; never external DTOs.

// Keep the original 192KiB ceiling. Drop redundant event-ring samples before
// decisive milestones, leaf geometry, failed-settle first/last samples and the
// retained final layout verdict. Never discard the failed readiness summary.
export function serializeReaderEvidence(input: Data, maxBytes = 192 * 1024) {
  const payload: Data = JSON.parse(JSON.stringify(input))
  const truncation = { maxBytes, eventRowsRemoved: 0, intermediateDriftsRemoved: 0, intermediateSettleTransitionsRemoved: 0, duplicateStableRemoved: false, milestoneAncestorsRemoved: 0, compactFallback: false }
  payload.truncation = truncation
  const encode = () => JSON.stringify(payload)
  const bytes = () => Buffer.byteLength(encode())
  const rows = payload.evidence?.rows
  while (bytes() > maxBytes && rows?.length) { rows.shift(); truncation.eventRowsRemoved++ }
  if (bytes() > maxBytes && payload.readinessEvidence?.enlarged?.stable && payload.readinessEvidence?.guard?.stable) {
    delete payload.readinessEvidence.enlarged.stable
    payload.readinessEvidence.enlarged.stableReference = 'guard.stable'
    truncation.duplicateStableRemoved = true
  }
  const changes = payload.readinessEvidence?.guard?.changes
  while (bytes() > maxBytes && changes?.length > 2) { changes.splice(1, 1); truncation.intermediateDriftsRemoved++ }
  const settleTransitions = payload.readinessEvidence?.guard?.settleEvidence?.transitions
  while (bytes() > maxBytes && settleTransitions?.length > 2) { settleTransitions.splice(1, 1); truncation.intermediateSettleTransitionsRemoved++ }
  if (bytes() > maxBytes) {
    for (const milestone of payload.evidence?.milestones || []) {
      const owners = milestone.owners || []
      milestone.owners = owners.filter((owner: Data) => owner.target || owner.main || owner.outline || owner.reader || owner.tag === 'header')
      truncation.milestoneAncestorsRemoved += owners.length - milestone.owners.length
    }
  }
  if (bytes() > maxBytes) {
    // Last resort retains the bounded leaf scan and first/final drift, plus the
    // original final verdict. It is explicitly marked, never silently dropped.
    truncation.compactFallback = true
    const milestones = payload.evidence?.milestones || []
    payload.evidence = { limits: payload.evidence?.limits, milestones: milestones.length ? [milestones[0], milestones[milestones.length - 1]] : [],
      rows: [], droppedRows: payload.evidence?.droppedRows }
    if (payload.readinessEvidence?.guard) {
      payload.readinessEvidence.guard.changes = changes?.length > 1 ? [changes[0], changes[changes.length - 1]] : changes
    }
  }
  const json = encode()
  if (Buffer.byteLength(json) > maxBytes) throw new Error('Required bounded Reader evidence exceeds its unchanged output ceiling')
  return json
}
