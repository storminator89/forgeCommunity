import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { serializeReaderEvidence } from '../e2e/reader-evidence-budget'
import { restoreReaderTextSize } from '../e2e/reader-layout-readiness'

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

it('prioritizes failed-settle first/last samples and false-gate reasons within the unchanged ceiling', () => {
  const first = { state: { fontStatus: 'loaded', fontReady: false, fontStackReady: false, fontPrimaryLoaded: true, time: 1 },
    fonts: { checks: { inter: { refreshLabel: { ready: false, error: false } }, interFallback: { defaultSpace: { ready: false, error: false } } }, familyFaces: { interFallback: { unloaded: 1 } } } }
  const last = { ...first, state: { ...first.state, time: 120 } }
  const summary = { outcome: 'frame-budget', frames: 120, readyFrames: 0, geometryChanges: 0,
    falseFlags: { fontReadyFalse: 120 }, changedFields: {}, first, last }
  const transitions = Array.from({ length: 8 }, (_, index) => ({ frame: index + 2, fields: ['boxes.header.rect.height'], padded: 't'.repeat(26 * 1024) }))
  const payload = { evidence: { milestones: [{ reason: 'original-verdict', owners: [{ main: true }] }],
    rows: Array.from({ length: 30 }, () => ({ event: 'rAF', padded: '測'.repeat(1000) })) },
  overflowEvidence: { rows: [{ control: 'remove-complete', padded: 'l'.repeat(47 * 1024) }] },
  readinessEvidence: { guard: { stable: null, unsafe: false, settleEvidence: { ...summary, transitions } } } }
  const json = serializeReaderEvidence(payload)
  const result = JSON.parse(json)
  expect(Buffer.byteLength(json)).toBeLessThanOrEqual(192 * 1024)
  expect(result.truncation.eventRowsRemoved).toBe(30)
  expect(result.truncation.intermediateSettleTransitionsRemoved).toBeGreaterThan(0)
  expect(result.readinessEvidence.guard.settleEvidence).toMatchObject(summary)
  expect(result.readinessEvidence.guard.settleEvidence.transitions[0].frame).toBe(2)
  expect(result.readinessEvidence.guard.settleEvidence.transitions.at(-1).frame).toBe(9)
  expect(result.overflowEvidence).toEqual(payload.overflowEvidence)
  expect(payload.readinessEvidence.guard.settleEvidence.transitions).toHaveLength(8)
})

// Execute the actual certificate orchestration without importing/registering
// the browser spec or running a server. Its page operations are mocked only at
// the browser boundary; evidence serialization and cleanup are the real code.
it.each(['none', 'attachment', 'reset', 'both'] as const)('retains a failed certificate settle and its original error when %s observation/cleanup fails', async failure => {
  const source = ts.createSourceFile('reader.pw.ts', readFileSync(join(process.cwd(), 'e2e/course-reader-continue.pw.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const declaration = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'captureCertificateReflow')!
  const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const originalError = new Error('certificate readiness frame budget')
  const resetError = new Error('text reset unavailable')
  const first = { state: { time: 1, fontReady: false, fontStatus: 'loaded', fontPrimaryLoaded: false }, fonts: { familyFaces: { inter: { unloaded: 1 } } } }
  const last = { ...first, state: { ...first.state, time: 120 } }
  const guard = { stable: null, unsafe: false, settleEvidence: { outcome: 'frame-budget', frames: 120,
    falseFlags: { fontReadyFalse: 120 }, first, last, transitions: [] } }
  const summary = { ready: true, sequence: 4 }
  const reset = jest.fn(async () => { if (failure === 'reset' || failure === 'both') throw resetError })
  const locator = {
    getByRole: () => locator,
    click: async () => {},
    evaluate: async (callback: { toString: () => string }, value?: unknown) => {
      if (typeof value === 'string') { await reset(); return }
      return callback.toString().includes('parseFloat') ? 16 : ''
    },
  }
  const capturePage = {
    goto: async () => {}, locator: () => locator, getByRole: () => locator,
    screenshot: jest.fn(async () => {}),
    evaluate: async (callback: { toString: () => string }) => {
      if (callback.toString().includes('.settle()')) throw originalError
      if (callback.toString().includes('.finish()')) return guard
    },
  }
  const context = { newPage: async () => capturePage, close: jest.fn(async () => {}) }
  const page = { url: () => 'http://127.0.0.1:3013/synthetic', context: () => ({ storageState: async () => ({}), browser: () => ({ newContext: async () => context }) }) }
  const info = { outputPath: (name: string) => name, attach: jest.fn(async () => { if (failure === 'attachment' || failure === 'both') throw new Error('attachment unavailable') }) }
  const successfulAssertion = { toBe: async () => {}, toHaveAttribute: async () => {}, toBeGreaterThanOrEqual: async () => {} }
  const browserExpect = Object.assign(() => successfulAssertion, { poll: () => successfulAssertion })
  const capture = new Function('expect', 'origin', 'observeReaderRequests', 'installReaderLayoutGuard', 'serializeReaderEvidence', 'restoreReaderTextSize', 'candidateSha', `${compiled}\nreturn captureCertificateReflow;`)(
    browserExpect, 'http://127.0.0.1:3013', () => () => summary, () => {}, serializeReaderEvidence, restoreReaderTextSize, 'a'.repeat(40))
  const output = jest.spyOn(console, 'info').mockImplementation(() => {})
  try {
    await expect(capture(page, info, ['synthetic-course'], 'synthetic-learner', 'entry-disabled')).rejects.toBe(originalError)
    expect(info.attach).toHaveBeenCalledTimes(1)
    const [name, attachment] = info.attach.mock.calls[0] as unknown as [string, { body: Buffer; contentType: string }]
    expect(name).toBe('reader-certificate-entry-disabled-text200-light-readiness')
    expect(attachment.contentType).toBe('application/json')
    expect(attachment.body.byteLength).toBeLessThanOrEqual(192 * 1024)
    expect(JSON.parse(attachment.body.toString())).toMatchObject({ originalFailed: true, phase: 'certificate-whole-layout-readiness',
      readinessEvidence: { guard, finalData: summary } })
    expect(capturePage.screenshot).toHaveBeenCalledTimes(1)
    expect(reset).toHaveBeenCalledTimes(1)
    expect(context.close).toHaveBeenCalledTimes(1)
    if (failure === 'attachment' || failure === 'both') expect(output).toHaveBeenCalledWith('Reader certificate readiness evidence unavailable:', 'Error')
    if (failure === 'reset' || failure === 'both') expect(output).toHaveBeenCalledWith('Reader certificate text-size reset failed after retained original failure')
  } finally { output.mockRestore() }
})
