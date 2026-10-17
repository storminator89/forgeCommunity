export type QaReflowEvidence = {
  main: { scrollWidth: number; clientWidth: number }
  region: { scrollWidth: number; clientWidth: number }
  reply: { width: number; height: number; scrollWidth: number; clientWidth: number; whiteSpace: string }
}

// Serialized into the real page. No text, URLs, account identifiers, or authored
// content is recorded. The known reply control and both real scrollports suffice.
export function readQaReflowEvidence(reply: Element): QaReflowEvidence {
  const region = reply.closest('section[aria-label="Frage und Antworten"]')
  const main = document.getElementById('page-content')
  if (!(reply instanceof HTMLButtonElement) || reply.type !== 'submit' || !reply.form?.querySelector('#qa-reply') || !region || !main?.contains(region) || !reply.isConnected) {
    throw new Error('Q&A reflow evidence requires the connected reply button in its real discussion and main')
  }
  const rect = reply.getBoundingClientRect()
  return {
    main: { scrollWidth: main.scrollWidth, clientWidth: main.clientWidth },
    region: { scrollWidth: region.scrollWidth, clientWidth: region.clientWidth },
    reply: { width: rect.width, height: rect.height, scrollWidth: reply.scrollWidth,
      clientWidth: reply.clientWidth, whiteSpace: getComputedStyle(reply).whiteSpace },
  }
}

// The exact default Button class combination at predecessor 9a917f10. Only the
// reply submit used this without local overrides. A browser regression probe
// temporarily restores it, then restores the exact original attribute in finally.
export const legacyQaReplyButtonClassName = 'fc-button inline-flex cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-sm font-semibold ring-offset-background transition-[color,background-color,border-color,box-shadow,translate,transform] duration-150 ease-out active:translate-y-px focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-100 disabled:bg-muted disabled:text-muted-foreground disabled:border-input disabled:active:translate-y-0 data-[state=loading]:cursor-progress data-[state=loading]:opacity-100 bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-4 py-2'

export function probeLegacyQaReplyButton(reply: Element, legacyClassName: string) {
  if (!(reply instanceof HTMLButtonElement) || reply.type !== 'submit' || !reply.form?.querySelector('#qa-reply') || !reply.closest('section[aria-label="Frage und Antworten"]') ||
      !document.getElementById('page-content')?.contains(reply) || !reply.isConnected) {
    throw new Error('The legacy Q&A probe requires the connected real reply button')
  }
  const original = reply.getAttribute('class')
  const measure = () => {
    const main = document.getElementById('page-content')!
    const region = reply.closest('section[aria-label="Frage und Antworten"]')!
    const rect = reply.getBoundingClientRect()
    return { main: { scrollWidth: main.scrollWidth, clientWidth: main.clientWidth },
      region: { scrollWidth: region.scrollWidth, clientWidth: region.clientWidth },
      reply: { width: rect.width, height: rect.height, whiteSpace: getComputedStyle(reply).whiteSpace } }
  }
  const corrected = measure()
  let legacy: ReturnType<typeof measure>
  try { reply.setAttribute('class', legacyClassName); legacy = measure() }
  finally { if (original === null) reply.removeAttribute('class'); else reply.setAttribute('class', original) }
  return { corrected, legacy, restored: measure(), classRestored: reply.getAttribute('class') === original }
}

// Native scrollIntoView(end) can leave a fractional CSS-pixel remainder because
// scrollTop is rounded. Reserve visible focus-ring space with one measured,
// bounded vertical scroll. This does not focus, restyle, clip, or retry anything.
export function insetQaReplyCapture(reply: Element) {
  const main = document.getElementById('page-content')
  if (!(reply instanceof HTMLButtonElement) || reply.type !== 'submit' || !reply.form?.querySelector('#qa-reply') ||
      !reply.closest('section[aria-label="Frage und Antworten"]') || !main?.contains(reply) || !reply.isConnected) {
    throw new Error('Q&A capture inset requires the connected real reply button')
  }
  const inset = 8
  const pane = main.getBoundingClientRect(); const before = reply.getBoundingClientRect()
  const top = Math.max(0, pane.top) + inset; const bottom = Math.min(innerHeight, pane.bottom) - inset
  if (before.height > bottom - top) throw new Error('Q&A reply control cannot fit within the capture focus inset')
  const delta = Math.max(0, Math.ceil(before.bottom - bottom))
  if (delta > inset + 1) throw new Error('Q&A reply capture is outside the expected native end-alignment rounding bound')
  if (delta) main.scrollBy({ top: delta, behavior: 'instant' })
  const after = reply.getBoundingClientRect()
  return { inset, delta, before: { top: before.top, bottom: before.bottom }, after: { top: after.top, bottom: after.bottom },
    visibleBounds: { top, bottom }, scrollTop: main.scrollTop, scrollLeft: main.scrollLeft }
}
