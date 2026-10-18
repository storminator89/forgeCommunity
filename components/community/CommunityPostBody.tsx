import { useMemo, useSyncExternalStore } from 'react'
import { sanitizeRichHtml } from '@/lib/sanitize-html'
import styles from './community-post-body.module.css'

const subscribe = () => () => {}
const clientSnapshot = () => true
const serverSnapshot = () => false

export function CommunityPostBody({ content }: { content: string }) {
  // Match the server and first hydration render before using the browser-only
  // sanitizer. Client-loaded feed rows can render their body immediately.
  const isClient = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot)
  const body = useMemo(() => {
    // Stored editor documents are rich HTML. Sanitize before examining their
    // structure; a legacy text-only fragment stays escaped React text.
    if (!isClient || typeof document === 'undefined') return null
    const html = sanitizeRichHtml(content)
    const fragment = document.createElement('template')
    fragment.innerHTML = html
    return fragment.content.childElementCount === 0
      ? { text: fragment.content.textContent ?? '', html: null }
      : { text: null, html }
  }, [content, isClient])

  if (!body) return <div className={styles.body} aria-busy="true" />
  if (body.html === null) return <div className={`${styles.body} ${styles.plainText}`}>{body.text}</div>
  return <div className={styles.body} dangerouslySetInnerHTML={{ __html: body.html }} />
}
