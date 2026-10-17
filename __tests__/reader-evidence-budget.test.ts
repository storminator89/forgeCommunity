import { serializeReaderEvidence } from '../e2e/reader-evidence-budget'

it('keeps milestones, exact leaf scan and final unsafe verdict while trimming a drift-rich event ring', () => {
  const before = { time: 1, boxes: { main: { scrollWidth: 536, clientWidth: 320 } } }
  const payload = {
    state: 'completed-with-next', mode: 'light', originalCompleted: false, phase: 'remaining-original-assertions',
    evidence: { milestones: [{ reason: 'before-text-zoom', owners: [{ main: true, rect: before }] }, { reason: 'original-verdict', owners: [{ target: true, rect: before }] }], rows: Array.from({ length: 40 }, () => ({ event: 'rAF', padded: '測'.repeat(1500) })) },
    overflowEvidence: { rootFont: '32px', rows: [{ control: 'remove-complete', scrollWidth: 504, clientWidth: 504, padded: 'x'.repeat(47 * 1024) }] },
    readinessEvidence: { enlarged: { stable: before }, guard: { stable: before, unsafe: true, changes: Array.from({ length: 8 }, (_, index) => ({ index, classification: 'unexpected-post-input-layout-drift', before, after: { ...before, padded: 'x'.repeat(6000) } })) } },
  }
  const json = serializeReaderEvidence(payload)
  const result = JSON.parse(json)
  expect(Buffer.byteLength(json)).toBeLessThanOrEqual(192 * 1024)
  expect(result.truncation.eventRowsRemoved).toBeGreaterThan(0)
  expect(result.evidence.milestones).toEqual(payload.evidence.milestones)
  expect(result.overflowEvidence).toEqual(payload.overflowEvidence)
  expect(result.readinessEvidence.guard.unsafe).toBe(true)
  expect(result.readinessEvidence.guard.changes[0].index).toBe(0)
  expect(result.readinessEvidence.guard.changes.at(-1).index).toBe(7)
  expect(payload.evidence.rows).toHaveLength(40)
})

it('retains first and final drift when a ring-free payload needs further bounded prioritization', () => {
  const stable = { padded: 's'.repeat(20 * 1024) }
  const leaf = { rows: [{ control: 'remove-complete', padded: 'l'.repeat(47 * 1024) }] }
  const payload = { evidence: { milestones: [{ reason: 'original-verdict', owners: [{ main: true, padded: 'm'.repeat(50 * 1024) }] }], rows: [] },
    overflowEvidence: leaf, readinessEvidence: { enlarged: { stable }, guard: { stable, unsafe: true,
      changes: Array.from({ length: 8 }, (_, index) => ({ index, before: { padded: 'b'.repeat(8 * 1024) }, after: { padded: 'a'.repeat(8 * 1024) } })) } } }
  const json = serializeReaderEvidence(payload)
  const result = JSON.parse(json)
  expect(Buffer.byteLength(json)).toBeLessThanOrEqual(192 * 1024)
  expect(result.truncation.duplicateStableRemoved).toBe(true)
  expect(result.truncation.intermediateDriftsRemoved).toBeGreaterThan(0)
  expect(result.overflowEvidence).toEqual(leaf)
  expect(result.readinessEvidence.guard.unsafe).toBe(true)
  expect(result.readinessEvidence.guard.changes[0].index).toBe(0)
  expect(result.readinessEvidence.guard.changes.at(-1).index).toBe(7)
})
