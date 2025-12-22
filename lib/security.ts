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

/**
 * Validates if a URL belongs to an allowed domain for video embedding
 */
export function isAllowedVideoUrl(url: string): boolean {
    if (!url) return false;

    try {
        const parsed = new URL(url);
        return ALLOWED_VIDEO_DOMAINS.some(domain =>
            parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
        );
    } catch {
        return false;
    }
}

/**
 * Validates if a URL belongs to an allowed domain for audio embedding
 */
export function isAllowedAudioUrl(url: string): boolean {
    if (!url) return false;

    try {
        const parsed = new URL(url);
        // Allow relative URLs (local audio files)
        if (url.startsWith('/')) return true;

        return ALLOWED_AUDIO_DOMAINS.some(domain =>
            parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
        );
    } catch {
        // Allow relative URLs
        return url.startsWith('/');
    }
}

/**
 * Sanitizes a URL for safe embedding - returns null if invalid/unsafe
 */
export function getSafeEmbedUrl(url: string, type: 'video' | 'audio'): string | null {
    if (!url) return null;

    // Allow relative URLs (local files)
    if (url.startsWith('/')) {
        return url;
    }

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

        if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split('?')[0];
        } else if (url.includes('youtube.com')) {
            const urlParams = new URLSearchParams(url.split('?')[1]);
            videoId = urlParams.get('v') || '';
        }

        return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
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
