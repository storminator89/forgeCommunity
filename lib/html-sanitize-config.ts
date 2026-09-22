export const RICH_HTML_ALLOWED_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'u',
  'ul',
] as const;

export const RICH_HTML_ALLOWED_ATTR = [
  'alt',
  'class',
  'href',
  'rel',
  'src',
  'target',
  'title',
] as const;

/**
 * DOMPurify permits some data URLs by default. Rich text only needs regular
 * web links, local relative paths, and (for anchors) mail/tel links.
 */
export function isSafeRichHtmlUrl(value: string, attribute: 'href' | 'src') {
  const candidate = value.trim();
  if (!candidate || /[\u0000-\u001f\u007f\\]/.test(candidate) || candidate.startsWith('//')) {
    return false;
  }

  const scheme = candidate.match(/^([a-z][a-z0-9+.-]*):/i)?.[1].toLowerCase();
  if (scheme) {
    return attribute === 'href' ? ['http', 'https', 'mailto', 'tel'].includes(scheme) : ['http', 'https'].includes(scheme);
  }

  // Relative links are safe after sanitization; protocol-relative links were
  // rejected above because they can silently change the destination origin.
  return candidate.startsWith('/') || candidate.startsWith('#') || !candidate.includes(':');
}
