/**
 * Security utilities for URL validation, sanitization, and other security-related functionality
 */

// Allowed domains for embedded video content
const ALLOWED_VIDEO_DOMAINS = [
    'youtube.com',
    'www.youtube.com',
    'youtu.be',
    'vimeo.com',
    'player.vimeo.com',
    'dailymotion.com',
    'www.dailymotion.com',
];

// Allowed domains for audio content
const ALLOWED_AUDIO_DOMAINS = [
    'soundcloud.com',
    'w.soundcloud.com',
    'open.spotify.com',
];

function isSafeRelativeUrl(url: string) {
    return /^\/(?![\\/])[^\u0000-\u001f\u007f]*$/.test(url);
}

function isUnsafeRelativeUrl(url: string) {
    return url.startsWith('/') || url.startsWith('\\') || /[\u0000-\u001f\u007f\\]/.test(url);
}

/**
 * Returns an absolute web URL safe to place in an ordinary link or
 * window.open call. This is intentionally stricter than the embed helpers:
 * persisted legacy project links may contain arbitrary schemes.
 */
export function getSafeHttpUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
        return null;
    }
    if (/[\u0000-\u001f\u007f]/.test(value)) {
        return null;
    }

    try {
        const parsed = new URL(value);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        if (parsed.username || parsed.password) return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

/** Also permit ordinary same-origin paths used by older resource records. */
export function getSafeNavigationUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null;
    if (isSafeRelativeUrl(value) && !value.includes('\\')) return value;
    return getSafeHttpUrl(value);
}

/**
 * Validates if a URL belongs to an allowed domain for video embedding
 */
export function isAllowedVideoUrl(url: string): boolean {
    if (!url) return false;
    if (isUnsafeRelativeUrl(url)) return false;

    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
        return ALLOWED_VIDEO_DOMAINS.includes(parsed.hostname.toLowerCase());
    } catch {
        return false;
    }
}

/**
 * Validates if a URL belongs to an allowed domain for audio embedding
 */
export function isAllowedAudioUrl(url: string): boolean {
    if (!url) return false;
    if (isSafeRelativeUrl(url)) return true;
    if (isUnsafeRelativeUrl(url)) return false;

    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
        return ALLOWED_AUDIO_DOMAINS.includes(parsed.hostname.toLowerCase());
    } catch {
        return false;
    }
}

/**
 * Sanitizes a URL for safe embedding - returns null if invalid/unsafe
 */
export function getSafeEmbedUrl(url: string, type: 'video' | 'audio'): string | null {
    if (!url) return null;

    // Reject protocol-relative URLs and browser-normalized backslash variants.
    if (isSafeRelativeUrl(url)) {
        return url;
    }
    if (isUnsafeRelativeUrl(url)) return null;

    if (type === 'video') {
        if (!isAllowedVideoUrl(url)) {
            console.warn('Blocked unsafe video URL:', url);
            return null;
        }
        return url;
    }

    if (type === 'audio') {
        if (!isAllowedAudioUrl(url)) {
            console.warn('Blocked unsafe audio URL:', url);
            return null;
        }
        return url;
    }

    return null;
}

/**
 * Extracts YouTube video ID and returns embed URL
 */
export function getYouTubeEmbedUrl(url: string): string | null {
    if (!isAllowedVideoUrl(url)) return null;

    try {
        let videoId = '';

        const parsed = new URL(url);
        if (parsed.hostname.toLowerCase() === 'youtu.be') {
            videoId = parsed.pathname.slice(1);
        } else if (parsed.hostname.toLowerCase() === 'youtube.com' || parsed.hostname.toLowerCase() === 'www.youtube.com') {
            videoId = parsed.searchParams.get('v') || '';
        }

        if (!/^[A-Za-z0-9_-]{1,128}$/.test(videoId)) return null;
        return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}`;
    } catch {
        return null;
    }
}

/**
 * Password validation - enforces strong password policy
 */
export function validatePassword(password: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (password.length < 12) {
        errors.push('Passwort muss mindestens 12 Zeichen lang sein');
    }
    if (!/[A-Z]/.test(password)) {
        errors.push('Mindestens ein Großbuchstabe erforderlich');
    }
    if (!/[a-z]/.test(password)) {
        errors.push('Mindestens ein Kleinbuchstabe erforderlich');
    }
    if (!/[0-9]/.test(password)) {
        errors.push('Mindestens eine Zahl erforderlich');
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        errors.push('Mindestens ein Sonderzeichen erforderlich');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}
