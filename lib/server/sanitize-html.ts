import 'server-only';

import createDOMPurify from 'dompurify';

import {
  RICH_HTML_ALLOWED_ATTR,
  RICH_HTML_ALLOWED_TAGS,
} from '@/lib/html-sanitize-config';

let DOMPurifyInstance: ReturnType<typeof createDOMPurify> | null = null;

function getServerWindow() {
  if (typeof globalThis.window !== 'undefined' && globalThis.window.document) {
    return globalThis.window;
  }

  const { JSDOM } = require('jsdom') as typeof import('jsdom');
  return new JSDOM('').window;
}

function getDOMPurify() {
  if (!DOMPurifyInstance) {
    const windowLike = getServerWindow();
    DOMPurifyInstance = createDOMPurify(windowLike as unknown as any);
    DOMPurifyInstance.addHook('afterSanitizeAttributes', (node) => {
      if ((node as Element).getAttribute?.('target') === '_blank') {
        node.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  return DOMPurifyInstance;
}

export function sanitizeRichHtmlServer(html: string | null | undefined) {
  return getDOMPurify().sanitize(html ?? '', {
    ALLOWED_TAGS: [...RICH_HTML_ALLOWED_TAGS],
    ALLOWED_ATTR: [...RICH_HTML_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
  });
}

export function sanitizeTextServer(value: string | null | undefined) {
  return getDOMPurify().sanitize(value ?? '', {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
  })
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeHtmlPreviewServer(html: string | null | undefined, maxLength?: number) {
  const preview = sanitizeTextServer(html);

  if (!maxLength || preview.length <= maxLength) {
    return preview;
  }

  return `${preview.slice(0, maxLength).trimEnd()}...`;
}

export function sanitizeCourseTextContentServer(value: string | null | undefined) {
  const content = value ?? '';

  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && 'questions' in parsed) {
      return content;
    }
  } catch {
    // Ignore and sanitize as rich text below.
  }

  return sanitizeRichHtmlServer(content);
}
