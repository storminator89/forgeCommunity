'use client';

/**
 * Client-side only HTML sanitization
 * This file uses DOMPurify only on the client side to avoid JSDOM issues in standalone builds
 */

import { useEffect, useState } from 'react';

// Type for DOMPurify
type DOMPurifyType = {
    sanitize: (html: string, config?: object) => string;
};

let DOMPurifyInstance: DOMPurifyType | null = null;

// Initialize DOMPurify on the client side only
if (typeof window !== 'undefined') {
    import('dompurify').then((module) => {
        DOMPurifyInstance = module.default;
    });
}

/**
 * Sanitize HTML content - returns empty string on server, sanitized content on client
 */
export function sanitizeHtml(html: string): string {
    if (typeof window === 'undefined') {
        // Server-side: return a basic escaped version or empty
        return html
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    if (DOMPurifyInstance) {
        return DOMPurifyInstance.sanitize(html, {
            ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre', 'span', 'div'],
            ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel']
        });
    }

    // Fallback: basic escape
    return html
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Hook for client-side sanitization
 */
export function useSanitizedHtml(html: string): string {
    const [sanitized, setSanitized] = useState('');

    useEffect(() => {
        import('dompurify').then((DOMPurify) => {
            setSanitized(DOMPurify.default.sanitize(html, {
                ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                    'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre', 'span', 'div'],
                ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel']
            }));
        });
    }, [html]);

    return sanitized;
}
