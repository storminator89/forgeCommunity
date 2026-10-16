import { useLayoutEffect, useRef, useState } from 'react'

type FocusIntent = {
  origin: HTMLElement
  target: HTMLElement
  disabled: boolean
  settled: boolean
  stop: () => void
}

// Local to a comment action. A body focus alone is not proof that the user
// stayed here: remember intervening navigation, even if it later blurs too.
export function useCommentActionFocus(postId: string, currentUserId: string | undefined, isLoading: boolean) {
  const intentRef = useRef<FocusIntent | null>(null)
  const [, renderCompletion] = useState(0)

  useLayoutEffect(() => () => {
    intentRef.current?.stop()
    intentRef.current = null
  }, [postId, currentUserId])

  useLayoutEffect(() => {
    const intent = intentRef.current
    if (!intent) return
    if (isLoading) {
      intent.disabled ||= intent.origin.matches(':disabled')
      return
    }
    if (!intent.settled) return
    intent.stop()
    intentRef.current = null
    if (intent.disabled && document.activeElement === document.body &&
        intent.origin.isConnected && intent.target.isConnected && !intent.target.matches(':disabled')) {
      intent.target.focus({ preventScroll: true })
    }
  })

  function begin(origin: HTMLElement, target: HTMLElement | null = origin) {
    intentRef.current?.stop()
    intentRef.current = null
    if (!target || document.activeElement !== origin) return null

    const cancel = () => {
      intent.stop()
      if (intentRef.current === intent) intentRef.current = null
    }
    const movedFocus = (event: FocusEvent) => {
      if (event.target !== origin && !(event.target === document.body && origin.matches(':disabled'))) cancel()
    }
    const pointer = (event: PointerEvent) => { if (event.target instanceof Node && !origin.contains(event.target)) cancel() }
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Tab') cancel() }
    const hidden = () => { if (document.visibilityState === 'hidden') cancel() }
    const intent: FocusIntent = { origin, target, disabled: false, settled: false, stop: () => {
      document.removeEventListener('focusin', movedFocus, true)
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('keydown', keyboard, true)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('blur', cancel)
    } }
    document.addEventListener('focusin', movedFocus, true)
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('blur', cancel)
    intentRef.current = intent
    return intent
  }

  function complete(intent: FocusIntent | null) {
    if (intent && intentRef.current === intent) {
      intent.settled = true
      renderCompletion(previous => previous + 1)
    }
  }

  return { begin, complete }
}
