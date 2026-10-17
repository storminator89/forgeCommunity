import 'server-only';

import sanitizeHtml from 'sanitize-html';

import {
  isSafeRichHtmlUrl,
  RICH_HTML_ALLOWED_ATTR,
  RICH_HTML_ALLOWED_TAGS,
} from '@/lib/html-sanitize-config';

// A token-based sanitizer needs neither a browser DOM nor filesystem assets,
// both of which jsdom assumes are available in a traditional Node server.
const nonTextTags = ['style', 'script', 'textarea', 'option', 'xmp', 'noscript', 'template', 'svg', 'math', 'iframe', 'object'];

export function sanitizeRichHtmlServer(html: string | null | undefined) {
  return sanitizeHtml(html ?? '', {
    allowedTags: [...RICH_HTML_ALLOWED_TAGS],
    allowedAttributes: { '*': [...RICH_HTML_ALLOWED_ATTR] },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https'] },
    allowProtocolRelative: false,
    parseStyleAttributes: false,
    nonTextTags,
    transformTags: {
      '*': (tagName, attributes) => {
        for (const attribute of ['href', 'src'] as const) {
          if (attribute in attributes && !isSafeRichHtmlUrl(attributes[attribute], attribute)) delete attributes[attribute];
        }
        if (attributes.target === '_blank') attributes.rel = 'noopener noreferrer';
        return { tagName, attribs: attributes };
      },
    },
  });
}

export function sanitizeTextServer(value: string | null | undefined) {
  return sanitizeHtml(value ?? '', {
    allowedTags: [],
    allowedAttributes: {},
    parseStyleAttributes: false,
    nonTextTags,
  })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Plain comment text keeps authored line breaks; never accepts rich HTML. */
export function sanitizeCommentTextServer(value: string | null | undefined) {
  return sanitizeHtml((value ?? '').replace(/\r\n?/g, '\n'), {
    allowedTags: [],
    allowedAttributes: {},
    parseStyleAttributes: false,
    nonTextTags,
  })
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
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
