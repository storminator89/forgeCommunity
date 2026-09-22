import DOMPurify from 'dompurify';

import {
  isSafeRichHtmlUrl,
  RICH_HTML_ALLOWED_ATTR,
  RICH_HTML_ALLOWED_TAGS,
} from '@/lib/html-sanitize-config';

let hookRegistered = false;

function ensureHooks() {
  if (hookRegistered) {
    return;
  }

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof Element && node.getAttribute('target') === '_blank') {
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });

  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if ((data.attrName === 'href' || data.attrName === 'src') && !isSafeRichHtmlUrl(data.attrValue, data.attrName)) {
      data.keepAttr = false;
    }
  });

  hookRegistered = true;
}

export function sanitizeRichHtml(html: string | null | undefined) {
  ensureHooks();

  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: [...RICH_HTML_ALLOWED_TAGS],
    ALLOWED_ATTR: [...RICH_HTML_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
  });
}

export function sanitizeTextPreview(html: string | null | undefined, maxLength?: number) {
  ensureHooks();

  const plainText = DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  })
    .replace(/\s+/g, ' ')
    .trim();

  if (!maxLength || plainText.length <= maxLength) {
    return plainText;
  }

  return `${plainText.slice(0, maxLength).trimEnd()}...`;
}
