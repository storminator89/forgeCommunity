import { NextResponse } from 'next/server';
import { JSDOM } from 'jsdom';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/lib/auth';
import { sanitizeTextServer } from '@/lib/server/sanitize-html';
import { consumeRateLimit, rateLimitHeaders } from '@/lib/server/rate-limit';
import { requestWithBodyLimit, RequestBodyLimitError } from '@/lib/server/request-body';
import {
  assertSafePublicUrl,
  fetchSafePublicUrl,
  HttpUrlValidationError,
} from '@/lib/server/url-security';

const PREVIEW_TIMEOUT_MS = 5000;
const MAX_PREVIEW_BODY_BYTES = 250_000;
const MAX_PREVIEW_REQUEST_BYTES = 8 * 1024;
const MAX_PREVIEW_URL_LENGTH = 2048;
const PREVIEW_RATE_LIMIT = { limit: 30, windowMs: 60 * 1000 } as const;

async function readResponseTextLimited(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return null;
  }

  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = value as Uint8Array;
      if (total + chunk.byteLength > maxBytes) {
        await reader.cancel();
        return null;
      }

      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

const getPdfMetadata = async (url: URL) => {
  try {
    const response = await fetchSafePublicUrl(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS)
    }).catch(e => {
      console.error(`Fetch error for ${url.toString()}:`, e);
      return null;
    });

    if (!response) return null;

    if (response.status >= 300 && response.status < 400) {
      return null; // Weiterleitungen ignorieren
    }

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type');
    const contentLength = response.headers.get('content-length');
    const lastModified = response.headers.get('last-modified');
    const fileName = decodeURIComponent(url.pathname.split('/').pop() || 'document.pdf');

    if (contentType?.includes('application/pdf')) {
      const fileSizeInMB = contentLength ? Math.round(parseInt(contentLength) / (1024 * 1024) * 10) / 10 : null;

      return {
        title: fileName,
        type: 'pdf',
        description: `PDF Dokument${fileSizeInMB ? ` (${fileSizeInMB} MB)` : ''}`,
        lastModified: lastModified || null,
        fileSize: fileSizeInMB ? `${fileSizeInMB} MB` : null,
      };
    }
    return null;
  } catch (e) {
    console.error('Error fetching PDF metadata:', e);
    return null;
  }
};

const getVideoMetadata = async (url: string) => {
  try {
    const urlObj = new URL(url);

    // YouTube
    if (['youtube.com', 'www.youtube.com', 'youtu.be'].includes(urlObj.hostname.toLowerCase())) {
      const videoId = urlObj.hostname.toLowerCase() === 'youtu.be'
        ? urlObj.pathname.slice(1)
        : urlObj.searchParams.get('v');

      const response = await fetchSafePublicUrl(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId || '')}&format=json`, {
        signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS)
      }).catch(e => {
        console.error(`YouTube fetch error for ${videoId}:`, e);
        return null;
      });

      if (!response) return null;

      if (response.status >= 300 && response.status < 400) {
        return null; // Weiterleitungen ignorieren
      }

      if (response.ok) {
        const payload = await readResponseTextLimited(response, 64 * 1024);
        if (!payload) return null;
        const data = JSON.parse(payload);
        return {
          title: data.title,
          description: data.author_name,
          image: data.thumbnail_url,
          type: 'video'
        };
      }
    }

    // Vimeo
    if (['vimeo.com', 'player.vimeo.com'].includes(urlObj.hostname.toLowerCase())) {
      const videoId = urlObj.pathname.split('/')[1];
      const response = await fetchSafePublicUrl(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${encodeURIComponent(videoId || '')}`, {
        signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS)
      }).catch(e => {
        console.error(`Vimeo fetch error for ${videoId}:`, e);
        return null;
      });

      if (!response) return null;

      if (response.status >= 300 && response.status < 400) {
        return null; // Weiterleitungen ignorieren
      }

      if (response.ok) {
        const payload = await readResponseTextLimited(response, 64 * 1024);
        if (!payload) return null;
        const data = JSON.parse(payload);
        return {
          title: data.title,
          description: data.author_name,
          image: data.thumbnail_url,
          type: 'video'
        };
      }
    }

    return null;
  } catch (e) {
    console.error('Error fetching video metadata:', e);
    return null;
  }
};

const getHtmlMetadata = async (url: URL) => {
  try {
    const response = await fetchSafePublicUrl(url, {
      method: 'GET',
      headers: {
        'user-agent': 'forge-community-preview/1.0',
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
    }).catch((error) => {
      console.error(`HTML fetch error for ${url.toString()}:`, error);
      return null;
    });

    if (!response || !response.ok) {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return null;
    }

    const html = await readResponseTextLimited(response, MAX_PREVIEW_BODY_BYTES);
    if (html === null) {
      return null;
    }
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const getMetaContent = (...selectors: string[]) => {
      for (const selector of selectors) {
        const value = document.querySelector(selector)?.getAttribute('content');
        if (value) {
          return sanitizeTextServer(value);
        }
      }

      return '';
    };

    const resolvePreviewUrl = async (value: string) => {
      if (!value) {
        return null;
      }

      try {
        return (await assertSafePublicUrl(new URL(value, url).toString())).toString();
      } catch {
        return null;
      }
    };

    const title =
      getMetaContent('meta[property="og:title"]', 'meta[name="twitter:title"]') ||
      sanitizeTextServer(document.title) ||
      url.hostname;
    const description =
      getMetaContent('meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]') ||
      '';
    const image = await resolvePreviewUrl(
      getMetaContent('meta[property="og:image"]', 'meta[name="twitter:image"]')
    );

    return {
      title,
      description,
      image,
      type: 'link',
    };
  } catch (error) {
    console.error('Error fetching HTML metadata:', error);
    return null;
  }
};

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Nicht autorisiert' }, { status: 401 });
    }

    const rateLimit = consumeRateLimit(`preview:user:${session.user.id}`, PREVIEW_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Zu viele Vorschauanfragen' },
        { status: 429, headers: rateLimitHeaders(rateLimit) },
      );
    }

    const limitedRequest = await requestWithBodyLimit(request, MAX_PREVIEW_REQUEST_BYTES);
    const { url } = await limitedRequest.json();

    if (typeof url !== 'string' || !url.trim() || url.length > MAX_PREVIEW_URL_LENGTH) {
      return NextResponse.json(
        { error: 'URL ist erforderlich' },
        { status: 400 }
      );
    }

    const safeUrl = await assertSafePublicUrl(url);

    if (safeUrl.toString().toLowerCase().endsWith('.pdf')) {
      const pdfMetadata = await getPdfMetadata(safeUrl);
      if (pdfMetadata) {
        return NextResponse.json(pdfMetadata);
      }
    }

    // Dann auf Video prüfen
    const videoMetadata = await getVideoMetadata(url);
    if (videoMetadata) {
      return NextResponse.json(videoMetadata);
    }

    // Fallback auf allgemeine Link-Vorschau
    const previewData = await getHtmlMetadata(safeUrl);

    if (!previewData) {
      return NextResponse.json(
        { error: 'Für diese URL konnte keine Vorschau geladen werden' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      title: previewData.title,
      description: previewData.description,
      image: previewData.image,
      type: previewData.type
    });
  } catch (error) {
    console.error('Preview error:', error);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Vorschau' },
      { status: error instanceof HttpUrlValidationError ? 400 : error instanceof RequestBodyLimitError ? 413 : 500 }
    );
  }
}
