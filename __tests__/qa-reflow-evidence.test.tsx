import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { render, screen } from '@testing-library/react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { insetQaReplyCapture, legacyQaReplyButtonClassName, probeLegacyQaReplyButton, readQaReflowEvidence } from '../e2e/qa-reflow-evidence'

const wrapping = 'h-auto min-h-11 min-w-0 max-w-full whitespace-normal [overflow-wrap:anywhere]'
function fixture(className: string | null = wrapping) {
  document.body.innerHTML = '<main id="page-content"><section aria-label="Frage und Antworten"><form><textarea id="qa-reply"></textarea><button type="submit">Private authored fixture text</button></form></section></main>'
  const main = document.querySelector('main')!; const region = document.querySelector('section')!; const reply = document.querySelector('button')!
  if (className !== null) reply.setAttribute('class', className)
  const legacy = () => reply.className === legacyQaReplyButtonClassName
  for (const [element, property, get] of [
    [main, 'clientWidth', () => 320], [main, 'scrollWidth', () => legacy() ? 420 : 320],
    [region, 'clientWidth', () => 256], [region, 'scrollWidth', () => legacy() ? 388 : 256],
    [reply, 'clientWidth', () => legacy() ? 388 : 256], [reply, 'scrollWidth', () => legacy() ? 388 : 256],
  ] as const) Object.defineProperty(element, property, { configurable: true, get })
  reply.getBoundingClientRect = jest.fn(() => ({ width: legacy() ? 388 : 256, height: legacy() ? 88 : 132 }) as DOMRect)
  jest.spyOn(window, 'getComputedStyle').mockImplementation(element => ({ whiteSpace: element.className === legacyQaReplyButtonClassName ? 'nowrap' : 'normal' }) as CSSStyleDeclaration)
  return { main, region, reply }
}
afterEach(() => { jest.restoreAllMocks(); document.body.innerHTML = '' })

it('pins the exact predecessor default reply classes used by the causal probe', () => {
  expect(legacyQaReplyButtonClassName).toBe(cn(buttonVariants()))
})

it('applies the local reflow recipe to the actual production reply submit without changing Button defaults', () => {
  const source = ts.createSourceFile('CourseQaWorkspace.tsx', readFileSync(join(__dirname, '../app/courses/[courseId]/qa/CourseQaWorkspace.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const matches: ts.JsxOpeningElement[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'Button' &&
        node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'disabled' && attribute.getText(source).includes('reply.trim().length < 2'))) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(source); expect(matches).toHaveLength(1)
  const attribute = matches[0].attributes.properties.find(value => ts.isJsxAttribute(value) && value.name.getText(source) === 'className') as ts.JsxAttribute
  expect(attribute && attribute.initializer && ts.isStringLiteral(attribute.initializer)).toBe(true)
  const className = (attribute.initializer as ts.StringLiteral).text
  expect(className).toBe(wrapping)
  render(<Button type="submit" className={className} disabled>Antwort veröffentlichen</Button>)
  const classes = screen.getByRole('button', { name: /^Antwort veröffentlichen$/ }).className.split(/\s+/)
  expect(classes).toEqual(expect.arrayContaining(wrapping.split(' ')))
  expect(classes).not.toContain('whitespace-nowrap'); expect(classes).not.toContain('h-11')
  expect(cn(buttonVariants()).split(' ')).toEqual(expect.arrayContaining(['whitespace-nowrap', 'h-11']))
})

it('records only bounded known-control and real-scrollport geometry, including hidden internal overflow', () => {
  const { reply } = fixture(legacyQaReplyButtonClassName)
  const evidence = readQaReflowEvidence(reply)
  expect(evidence).toEqual({ main: { scrollWidth: 420, clientWidth: 320 }, region: { scrollWidth: 388, clientWidth: 256 },
    reply: { width: 388, height: 88, scrollWidth: 388, clientWidth: 388, whiteSpace: 'nowrap' } })
  expect(JSON.stringify(evidence)).not.toContain('Private authored fixture text')
  expect(Object.keys(evidence)).toEqual(['main', 'region', 'reply'])
})

it('measures corrected, exact legacy, and restored states, restoring the exact class attribute', () => {
  const original = `${wrapping} preserved-extra-class`; const { reply } = fixture(original)
  const textbox = document.querySelector('textarea')!; textbox.value = 'Unpublished draft'; textbox.focus()
  const before = document.body.innerHTML
  const evidence = probeLegacyQaReplyButton(reply, legacyQaReplyButtonClassName)
  expect(evidence.corrected.main.scrollWidth).toBe(320); expect(evidence.legacy.main.scrollWidth).toBe(420)
  expect(evidence.legacy.region.scrollWidth).toBe(388); expect(evidence.legacy.reply.whiteSpace).toBe('nowrap')
  expect(evidence.restored).toEqual(evidence.corrected); expect(evidence.classRestored).toBe(true)
  expect(reply.getAttribute('class')).toBe(original)
  expect(document.body.innerHTML).toBe(before); expect(document.activeElement).toBe(textbox); expect(textbox.value).toBe('Unpublished draft')
})

it.each([null, ''])('preserves an original %p class attribute rather than inventing one', original => {
  const { reply } = fixture(original)
  expect(probeLegacyQaReplyButton(reply, legacyQaReplyButtonClassName).classRestored).toBe(true)
  expect(reply.getAttribute('class')).toBe(original)
})

it('restores the exact original class when the legacy geometry read throws', () => {
  const { reply } = fixture()
  const original = reply.getAttribute('class')
  reply.getBoundingClientRect = () => { if (reply.className === legacyQaReplyButtonClassName) throw new Error('geometry failed'); return { width: 256, height: 132 } as DOMRect }
  expect(() => probeLegacyQaReplyButton(reply, legacyQaReplyButtonClassName)).toThrow('geometry failed')
  expect(reply.getAttribute('class')).toBe(original)
})

it.each(['detached', 'wrong-region', 'outside-main', 'not-button', 'wrong-control', 'missing-reply-textbox'])('rejects %s targets before any class mutation', kind => {
  const { reply, region, main } = fixture()
  let target: Element = reply
  if (kind === 'detached') reply.remove()
  if (kind === 'wrong-region') region.setAttribute('aria-label', 'Other')
  if (kind === 'outside-main') document.body.appendChild(region)
  if (kind === 'wrong-control') reply.type = 'button'
  if (kind === 'missing-reply-textbox') document.querySelector('textarea')!.remove()
  if (kind === 'not-button') { target = document.createElement('div'); main.appendChild(target) }
  const original = target.getAttribute('class')
  expect(() => readQaReflowEvidence(target)).toThrow('requires')
  expect(() => probeLegacyQaReplyButton(target, legacyQaReplyButtonClassName)).toThrow('requires')
  expect(target.getAttribute('class')).toBe(original)
})

function captureFixture(bottom = 800.375, height = 152) {
  const { main, reply } = fixture()
  jest.replaceProperty(window, 'innerHeight', 800)
  main.getBoundingClientRect = () => ({ top: 225, bottom: 800 }) as DOMRect
  reply.getBoundingClientRect = () => ({ top: bottom - height - main.scrollTop, bottom: bottom - main.scrollTop, height }) as DOMRect
  main.scrollBy = jest.fn((options?: ScrollToOptions | number) => { if (typeof options === 'object') main.scrollTop += options.top ?? 0 })
  return { main, reply }
}

it.each([{ bottom: 800.375, delta: 9, after: 791.375 }, { bottom: 800, delta: 8, after: 792 }])('preserves strict viewport bounds with one bounded native focus inset: %j', ({ bottom, delta, after }) => {
  const { main, reply } = captureFixture(bottom)
  const textbox = document.querySelector('textarea')!; textbox.focus(); const before = document.body.innerHTML
  const evidence = insetQaReplyCapture(reply)
  expect(evidence).toMatchObject({ inset: 8, delta, before: { bottom }, after: { bottom: after }, visibleBounds: { top: 233, bottom: 792 } })
  expect(main.scrollBy).toHaveBeenCalledTimes(1); expect(main.scrollBy).toHaveBeenCalledWith({ top: delta, behavior: 'instant' })
  expect(evidence.after.bottom).toBeLessThanOrEqual(evidence.visibleBounds.bottom)
  expect(document.body.innerHTML).toBe(before); expect(document.activeElement).toBe(textbox)
})

it('does not scroll a control that already has the full focus inset', () => {
  const { main, reply } = captureFixture(790)
  expect(insetQaReplyCapture(reply).delta).toBe(0); expect(main.scrollBy).not.toHaveBeenCalled()
})

it.each([{ bottom: 805, height: 152, error: 'rounding bound' }, { bottom: 800, height: 600, error: 'cannot fit' }])('rejects unexpected framing instead of masking it: %j', ({ bottom, height, error }) => {
  const { main, reply } = captureFixture(bottom, height)
  expect(() => insetQaReplyCapture(reply)).toThrow(error); expect(main.scrollBy).not.toHaveBeenCalled()
})

it('never retries or invents geometry when the native scrollport cannot move', () => {
  const { main, reply } = captureFixture()
  main.scrollBy = jest.fn()
  const evidence = insetQaReplyCapture(reply)
  expect(main.scrollBy).toHaveBeenCalledTimes(1)
  expect(evidence.after.bottom).toBe(800.375)
  expect(evidence.after.bottom).toBeGreaterThan(800) // The unchanged real viewport assertion must still fail.
})

it('rejects a disconnected capture target before attempting native scroll', () => {
  const { main, reply } = captureFixture(); reply.remove()
  expect(() => insetQaReplyCapture(reply)).toThrow('connected real reply'); expect(main.scrollBy).not.toHaveBeenCalled()
})
