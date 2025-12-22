'use client';

import { useEffect, useState, useRef } from 'react';

interface SanitizedHtmlProps {
    html: string;
    className?: string;
}

/**
 * Client-side only HTML rendering component
 * Uses native DOMPurify (not isomorphic-dompurify) to avoid JSDOM issues in standalone builds
 */
export function SanitizedHtml({ html, className }: SanitizedHtmlProps) {
    const [sanitizedHtml, setSanitizedHtml] = useState<string>('');
    const [isClient, setIsClient] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setIsClient(true);

        // Use the browser's native DOMPurify library
        // We need to dynamically load it since it's a client-side only library
        const loadAndSanitize = async () => {
            try {
                // Use dompurify directly (not isomorphic-dompurify)
                const DOMPurify = (await import('dompurify')).default;
                const clean = DOMPurify.sanitize(html, {
                    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                        'ul', 'ol', 'li', 'a', 'img', 'blockquote', 'code', 'pre', 'span', 'div'],
                    ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel']
                });
                setSanitizedHtml(clean);
            } catch (error) {
                // Fallback: basic HTML escape if DOMPurify fails
                console.error('Failed to load DOMPurify:', error);
                const escaped = html
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
                setSanitizedHtml(escaped);
            }
        };

        loadAndSanitize();
    }, [html]);

    // During server rendering, show a loading placeholder
    if (!isClient) {
        return <div className={className} />;
    }

    return (
        <div
            ref={containerRef}
            className={className}
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
    );
}
